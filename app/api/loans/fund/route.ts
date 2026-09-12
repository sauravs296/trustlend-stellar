import { NextRequest, NextResponse } from "next/server";
import { requireAuthenticatedUser } from "@/lib/auth/session";
import { enforceRouteRateLimit } from "@/lib/rate-limit";
import { eq, sql } from "drizzle-orm";
import { getDb } from "@/lib/db/client";
import { ledgerTransactions, loanFundings, loans } from "@/lib/db/schema";
import { sendLoanFundedEmail } from "@/lib/email/resend";
import { getFundingProgress, validateFundingAmount } from "@/lib/loans/funding";
import { qualifyReferralForLoan } from "@/lib/referrals/qualify";
import { isRedirectError } from "next/dist/client/components/redirect-error";

/**
 * POST /api/loans/fund
 *
 * Direct P2P lending with partial fills (Issue #269) — one loan request can be
 * filled by several lenders, each contributing a slice.
 *
 * Flow:
 *   1. Lender signs a Stellar payment to the BORROWER's wallet (client-side)
 *   2. Client sends the confirmed txHash and the amount funded
 *   3. record_loan_funding() atomically records the contribution and, once the
 *      contributions cover the principal, flips the loan to "active"
 *
 * Body: { loanId, txHash, lenderAddress, amount? }
 *   `amount` defaults to the full remaining balance, so a client that predates
 *   partial fills keeps working unchanged.
 */
export async function POST(request: NextRequest) {
  try {
    const rateLimitResponse = await enforceRouteRateLimit(request);
    if (rateLimitResponse) {
      return rateLimitResponse;
    }

    const { user } = await requireAuthenticatedUser("lender");
    const db = getDb();
    if (!db) {
      return NextResponse.json({ error: "Database unavailable" }, { status: 503 });
    }

    const body = await request.json();
    const { loanId, txHash, lenderAddress, amount } = body as {
      loanId: string;
      txHash: string;
      lenderAddress: string;
      amount?: number | string;
    };

    if (!loanId) {
      return NextResponse.json({ error: "loanId is required" }, { status: 400 });
    }
    if (!txHash || txHash.trim().length < 10) {
      return NextResponse.json(
        { error: "A confirmed Stellar transaction hash is required" },
        { status: 400 }
      );
    }

    const normalizedTxHash = txHash.trim();

    // ── Replay guard ─────────────────────────────────────────────────────────
    // Dedupe on the transaction hash, not on the loan: a loan may legitimately
    // receive many contributions, but each Stellar payment is claimable once.
    const [existingFunding] = await db
      .select({ id: loanFundings.id })
      .from(loanFundings)
      .where(eq(loanFundings.txHash, normalizedTxHash))
      .limit(1);

    if (existingFunding) {
      return NextResponse.json(
        { error: "This transaction has already been recorded" },
        { status: 409 }
      );
    }

    // ── Fetch the loan ───────────────────────────────────────────────────────
    const [loanRow] = await db
      .select({
        id: loans.id,
        status: loans.status,
        principalAmount: loans.principalAmount,
        fundedAmount: loans.fundedAmount,
        borrowerId: loans.borrowerId,
        aprBps: loans.aprBps,
        durationDays: loans.durationDays,
      })
      .from(loans)
      .where(eq(loans.id, loanId))
      .limit(1);

    const loan = loanRow
      ? {
          ...loanRow,
          principal_amount: Number(loanRow.principalAmount),
          funded_amount: Number(loanRow.fundedAmount),
          borrower_id: loanRow.borrowerId,
          apr_bps: loanRow.aprBps,
          duration_days: loanRow.durationDays,
        }
      : null;

    if (!loan) {
      return NextResponse.json({ error: "Loan not found" }, { status: 404 });
    }

    const fundableStatuses = ["requested", "approved"];
    if (!fundableStatuses.includes(String(loan.status))) {
      return NextResponse.json(
        { error: `Loan is not available for funding (status: ${loan.status})` },
        { status: 409 }
      );
    }

    // ── Prevent lender from funding their own loan ────────────────────────────
    if (String(loan.borrower_id) === String(user.id)) {
      return NextResponse.json(
        { error: "You cannot fund your own loan" },
        { status: 400 }
      );
    }

    // ── Resolve and validate the contribution ────────────────────────────────
    const progressBefore = getFundingProgress(
      loan.principal_amount,
      loan.funded_amount
    );

    if (progressBefore.isFullyFunded) {
      return NextResponse.json(
        { error: "This loan is already fully funded" },
        { status: 409 }
      );
    }

    // Omitting `amount` means "fill the rest", preserving the pre-#269 contract.
    const requestedAmount = amount ?? progressBefore.remaining;
    const validation = validateFundingAmount(
      requestedAmount,
      progressBefore.remaining
    );

    if (!validation.ok) {
      return NextResponse.json({ error: validation.error }, { status: 400 });
    }

    // Round to Stellar's 7-decimal precision before it reaches Postgres.
    // `principal - funded` in JS floats can land a fraction above the exact
    // numeric(20,6) remainder, which the RPC would reject as overfunding.
    const contribution = Number(validation.amount.toFixed(7));
    const now = new Date().toISOString();

    // ── Record the contribution atomically ───────────────────────────────────
    // The RPC locks the loan row, so concurrent lenders cannot both read the
    // same remaining balance and collectively overfund the loan.
    type FundingResultRow = {
      loan_id: string;
      status: string;
      principal_amount: string | number;
      funded_amount: string | number;
      remaining_amount: string | number;
      is_fully_funded: boolean;
      funding_id: string;
    };
    let fundingRows: FundingResultRow[];
    try {
      const executed = await db.execute(
        sql`select loan_id, status, principal_amount, funded_amount, remaining_amount, is_fully_funded, funding_id
             from public.record_loan_funding(${loanId}::uuid, ${user.id}::uuid, ${contribution}::numeric, ${normalizedTxHash}::text, ${lenderAddress ?? null}::text, ${now}::timestamptz)`,
      );
      fundingRows = executed.rows as FundingResultRow[];
    } catch (rpcErr) {
      const message = rpcErr instanceof Error ? rpcErr.message : String(rpcErr);

      // The tx_hash unique index is the authoritative replay guard against a
      // duplicate that slipped past the pre-check in a concurrent request.
      if (
        message.includes("idx_loan_fundings_tx_hash") ||
        message.includes("duplicate key value")
      ) {
        return NextResponse.json(
          { error: "This transaction has already been recorded" },
          { status: 409 }
        );
      }

      // The RPC raises for the race-condition cases: another lender took the
      // remaining balance between our read and our write.
      if (
        message.includes("already fully funded") ||
        message.includes("exceeds the remaining") ||
        message.includes("not available for funding")
      ) {
        return NextResponse.json({ error: message }, { status: 409 });
      }

      return NextResponse.json({ error: message }, { status: 500 });
    }

    // The function returns a single-row table.
    const result = fundingRows[0];
    const progressAfter = getFundingProgress(
      result?.principal_amount ?? loan.principal_amount,
      result?.funded_amount ?? progressBefore.funded + contribution
    );
    const isFullyFunded = Boolean(result?.is_fully_funded ?? progressAfter.isFullyFunded);

    // ── Record in ledger with full transparency info ──────────────────────────
    await db.insert(ledgerTransactions).values({
      userId: user.id, // the lender
      category: "loan_fund",
      amount: String(contribution),
      currency: "XLM",
      status: "confirmed",
      refType: "loan_fund",
      refId: loanId,
      metadata: {
        txHash: normalizedTxHash,
        lenderAddress,
        lenderUserId: user.id,
        borrowerId: String(loan.borrower_id),
        loanId,
        contributionAmount: contribution,
        principalAmount: loan.principal_amount,
        fundedAmountAfter: progressAfter.funded,
        remainingAfter: progressAfter.remaining,
        isFullyFunded,
        aprBps: loan.apr_bps,
        durationDays: loan.duration_days,
        fundedAt: now,
      },
    });

    // ── Emit notifications ──
    const { createNotification } = await import("@/lib/notifications");
    const percentLabel = `${Math.round(progressAfter.percent)}%`;

    if (isFullyFunded) {
      // Notify Borrower — the loan is live and the money is on its way.
      await createNotification({
        userId: String(loan.borrower_id),
        title: "Loan Fully Funded!",
        message: `Great news! Your loan of ${progressAfter.principal} XLM is now 100% funded and active. The funds have been sent to your wallet.`,
        type: "loan_funded",
      });
      await sendLoanFundedEmail({
        userId: String(loan.borrower_id),
        amount: progressAfter.principal,
        loanId,
      });

      // ── Referral bonus (Issue #266) ──
      // The loan is now Active, which is what qualifies the borrower's
      // referrer. The XLM payout itself is made on-chain by the lending
      // contract during activate_loan; this mirrors it for the dashboard.
      const referral = await qualifyReferralForLoan({
        db,
        refereeId: String(loan.borrower_id),
        loanId,
      });

      if (referral.qualified && referral.referrerId) {
        await createNotification({
          userId: referral.referrerId,
          title: "Referral Bonus Earned!",
          message:
            "Someone you invited just had their first loan funded. Your referral bonus is on its way to your wallet.",
          type: "investment_made",
        });
      }
    } else {
      // Partial fill — tell the borrower how far along the request is.
      await createNotification({
        userId: String(loan.borrower_id),
        title: "Loan Partially Funded",
        message: `A lender contributed ${contribution} XLM to your loan request. It is now ${percentLabel} funded — ${progressAfter.remaining.toFixed(2)} XLM still needed to activate it.`,
        type: "loan_funded",
      });
    }

    // Notify Lender
    await createNotification({
      userId: user.id,
      title: "Funding Successful",
      message: isFullyFunded
        ? `You contributed ${contribution} XLM and completed this loan's funding. View 'Loans You Funded' for details.`
        : `You contributed ${contribution} XLM. The loan is now ${percentLabel} funded.`,
      type: "investment_made",
    });

    return NextResponse.json(
      {
        loanId,
        status: String(result?.status ?? loan.status),
        txHash: normalizedTxHash,
        amountFunded: contribution,
        principalAmount: progressAfter.principal,
        fundedAmount: progressAfter.funded,
        remainingAmount: progressAfter.remaining,
        fundedPercent: progressAfter.percent,
        isFullyFunded,
        explorerUrl: `https://stellar.expert/explorer/testnet/tx/${normalizedTxHash}`,
        message: isFullyFunded
          ? "Loan fully funded and activated. The borrower will receive XLM in their wallet."
          : `Contribution recorded. This loan is now ${percentLabel} funded.`,
      },
      { status: 200 }
    );
  } catch (error) {
    if (isRedirectError(error)) {
      throw error;
    }
    console.error("Loan funding error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
