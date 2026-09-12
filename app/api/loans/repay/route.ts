import { NextRequest, NextResponse } from "next/server";
import { requireAuthenticatedUser } from "@/lib/auth/session";
import { enforceRouteRateLimit } from "@/lib/rate-limit";
import { and, eq, sql } from "drizzle-orm";
import { getDb } from "@/lib/db/client";
import { ledgerTransactions, loanRepayments, loans, reputationEvents } from "@/lib/db/schema";
import { getLoanLenders } from "@/lib/loans/lenders";
import { splitRepaymentAcrossLenders } from "@/lib/loans/funding";
import { isRedirectError } from "next/dist/client/components/redirect-error";

interface RepayPayload {
  loanId: string;
  amount: number;       // total amount borrower is paying this time
  txHash: string;       // Stellar confirmed hash
  borrowerAddress: string;
}

export async function POST(request: NextRequest) {
  try {
    const rateLimitResponse = await enforceRouteRateLimit(request);
    if (rateLimitResponse) {
      return rateLimitResponse;
    }

    const { user } = await requireAuthenticatedUser("borrower");
    const { loanId, amount, txHash, borrowerAddress } = (await request.json()) as RepayPayload;

    if (!loanId || !amount || amount <= 0 || !Number.isFinite(amount)) {
      return NextResponse.json({ error: "Invalid request data" }, { status: 400 });
    }
    if (!txHash || txHash.trim().length < 10) {
      return NextResponse.json({ error: "A confirmed Stellar transaction hash is required for on-chain repayment" }, { status: 400 });
    }

    const db = getDb();
    if (!db) {
      return NextResponse.json({ error: "Database unavailable" }, { status: 500 });
    }

    // Double-check borrower & loan
    const [loanRow] = await db
      .select({
        id: loans.id,
        status: loans.status,
        repaidAmount: loans.repaidAmount,
        principalAmount: loans.principalAmount,
        aprBps: loans.aprBps,
        durationDays: loans.durationDays,
      })
      .from(loans)
      .where(and(eq(loans.id, loanId), eq(loans.borrowerId, user.id)))
      .limit(1);

    if (!loanRow) return NextResponse.json({ error: "Loan not found" }, { status: 404 });
    const loan = {
      id: loanRow.id,
      status: loanRow.status as string,
      repaid_amount: Number(loanRow.repaidAmount),
      principal_amount: Number(loanRow.principalAmount),
      apr_bps: loanRow.aprBps,
      duration_days: loanRow.durationDays,
    };
    if (loan.status === "repaid") return NextResponse.json({ error: "Loan is already fully repaid" }, { status: 400 });
    if (loan.status === "defaulted") return NextResponse.json({ error: "Loan is in default" }, { status: 400 });

    // Prevent duplicate txHash
    const [existingTx] = await db
      .select({ id: ledgerTransactions.id })
      .from(ledgerTransactions)
      .where(
        and(
          eq(ledgerTransactions.refType, "loan_repay"),
          sql`lower(${ledgerTransactions.metadata}->>'txHash') = lower(${txHash})`,
        ),
      )
      .limit(1);

    if (existingTx) {
      return NextResponse.json({ error: "This transaction hash has already been recorded" }, { status: 409 });
    }

    // Figure out every lender to notify. A loan can be funded by several
    // lenders (Issue #269), each owed a pro-rata slice of this repayment.
    const lenders = await getLoanLenders(db, loanId);
    const primaryLender = lenders[0];
    const lenderUserId = primaryLender?.lenderId ?? "";
    const lenderAddress = primaryLender?.address ?? "";
    const lenderPayouts = splitRepaymentAcrossLenders(amount, lenders);

    // Create repayment record in DB
    const [repayment] = await db
      .insert(loanRepayments)
      .values({ loanId, payerId: user.id, amount: String(amount), txRef: txHash })
      .returning();

    // Calculate updated balances
    const newRepaidAmount = (loan.repaid_amount || 0) + amount;
    
    // Total due calculation matches preflight
    const principal    = Number(loan.principal_amount ?? 0);
    const durationDays = Number(loan.duration_days ?? 30);
    const aprBps       = Number(loan.apr_bps ?? 0);
    const totalInterest= principal * (aprBps / 10000) * (durationDays / 365);
    const platformFee  = principal * 0.01;
    const totalDue     = principal + totalInterest + platformFee;

    let newStatus = loan.status === "funded" ? "active" : loan.status;
    // adding a small tolerance for floating point rounding issues
    if (newRepaidAmount >= totalDue - 0.0001) {
      newStatus = "repaid";
    } else if (newStatus !== "active") {
      newStatus = "active";
    }

    await db
      .update(loans)
      .set({
        repaidAmount: String(newRepaidAmount),
        status: newStatus as typeof loans.$inferInsert.status,
      })
      .where(eq(loans.id, loanId));

    // Record on Ledger
    await db.insert(ledgerTransactions).values({
      userId: user.id, // the borrower
      category: "loan_repay",
      amount: String(amount),
      currency: "XLM",
      status: "confirmed",
      refType: "loan_repay",
      refId: repayment.id, // link to the repayment record
      metadata: {
        txHash,
        borrowerAddress,
        lenderAddress,
        lenderUserId,
        // Full pro-rata breakdown so each lender's share of this repayment is
        // auditable after the fact (Issue #269).
        lenderPayouts: lenderPayouts.map((entry) => ({
          lenderUserId: entry.lenderId,
          address: entry.address,
          share: +entry.share.toFixed(7),
          payout: entry.payout,
        })),
        loanId,
        repaymentId: repayment.id,
        principalAmount: loan.principal_amount,
        repaidSoFar: newRepaidAmount,
        repaidAt: new Date().toISOString(),
      },
    });

    // Add reputation points
    const repayPoints = newStatus === "repaid" ? 20 : 5;
    await db.insert(reputationEvents).values({
      userId: user.id,
      sourceType: "loan_repayment",
      sourceId: loanId,
      pointsDelta: repayPoints,
      reason: `On-chain repayment of ${amount.toFixed(2)} XLM`,
    });

    // Notifications
    const { createNotification } = await import("@/lib/notifications");
    await createNotification({
      userId: user.id,
      title: "Repayment Successful",
      message: `You successfully repaid ${amount.toFixed(2)} XLM on-chain. Status: ${newStatus}`,
      type: "loan_repaid",
    });

    // Notify every lender with the slice that reached them.
    for (const entry of lenderPayouts) {
      if (!entry.lenderId) continue;

      await createNotification({
        userId: entry.lenderId,
        title: "Loan Repayment Received",
        message:
          lenderPayouts.length > 1
            ? `The borrower repaid ${amount.toFixed(2)} XLM on-chain. Your share (${(entry.share * 100).toFixed(1)}% of this loan) is ${entry.payout.toFixed(2)} XLM.`
            : `The borrower has repaid ${amount.toFixed(2)} XLM towards their loan on-chain!`,
        type: "loan_repaid",
      });
    }

    return NextResponse.json({ repayment, loanStatus: newStatus, txHash }, { status: 201 });
  } catch (error) {
    if (isRedirectError(error)) throw error;
    console.error("Repayment error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
