import { NextRequest, NextResponse } from "next/server";
import { and, desc, eq, gte, notInArray } from "drizzle-orm";
import { requireAuthenticatedUser } from "@/lib/auth/session";
import { enforceRouteRateLimit } from "@/lib/rate-limit";
import { getDb } from "@/lib/db/client";
import { ledgerTransactions, lendingPools, loans, reputationSnapshots } from "@/lib/db/schema";
import { requireKycVerified } from "@/lib/kyc/middleware";
import { isRedirectError } from "next/dist/client/components/redirect-error";

export async function POST(request: NextRequest) {
  try {
    const rateLimitResponse = await enforceRouteRateLimit(request);
    if (rateLimitResponse) {
      return rateLimitResponse;
    }

    const { user } = await requireAuthenticatedUser("borrower");
    const db = getDb();
    if (!db) {
      return NextResponse.json({ error: "Database unavailable" }, { status: 503 });
    }

    // ── KYC guard: regulated pools require verified identity ─────────────────
    const kycCheck = await requireKycVerified(user.id, db);
    if (!kycCheck.allowed) {
      return NextResponse.json(
        { error: kycCheck.reason, kycStatus: kycCheck.kycStatus },
        { status: 403 }
      );
    }

    // ── Parse body ──────────────────────────────────────────────────────────
    const body = await request.json();
    const amount: number = body.amount;
    const durationDays: number = body.durationDays ?? body.duration_days;
    const rateModel: string = (body.rateModel ?? body.rate_model ?? "fixed").toLowerCase();

    const MIN_BORROW_AMOUNT = 1; // Minimum 1 XLM to prevent dust/spam loans

    if (!amount || amount < MIN_BORROW_AMOUNT) {
      return NextResponse.json(
        { error: `Invalid amount: minimum borrow amount is ${MIN_BORROW_AMOUNT} XLM` },
        { status: 400 }
      );
    }

    if (!durationDays || ![30, 60, 90].includes(Number(durationDays))) {
      return NextResponse.json(
        { error: `Invalid duration: must be 30, 60, or 90 days` },
        { status: 400 }
      );
    }

    if (!["fixed", "floating"].includes(rateModel)) {
      return NextResponse.json(
        { error: `Invalid rate model: must be 'fixed' or 'floating'` },
        { status: 400 }
      );
    }

    // ── 1. Anti-scam: only ONE active loan at a time ─────────────────────────
    const existingLoans = await db
      .select({ id: loans.id })
      .from(loans)
      .where(
        and(eq(loans.borrowerId, user.id), notInArray(loans.status, ["repaid", "defaulted", "cancelled"])),
      )
      .limit(1);

    if (existingLoans.length > 0) {
      return NextResponse.json(
        {
          error:
            "You already have an active or pending loan. Repay or close it before applying for a new one.",
        },
        { status: 400 }
      );
    }

    // ── 2. Reputation / credit limit check ───────────────────────────────────
    const [reputation] = await db
      .select({ scoreTotal: reputationSnapshots.scoreTotal })
      .from(reputationSnapshots)
      .where(eq(reputationSnapshots.userId, user.id))
      .limit(1);

    const reputationScore: number = reputation?.scoreTotal ?? 250;
    const maxLoan = reputationScore * 10;

    if (amount > maxLoan) {
      return NextResponse.json(
        { error: `Exceeds your credit limit of ${maxLoan} XLM (trust score: ${reputationScore}).` },
        { status: 400 }
      );
    }

    // ── 3. Calculate APR ─────────────────────────────────────────────────────────
    let aprBps: number;
    if (rateModel === "floating") {
      // Floating rate: base 5% + utilization slope
      // Start lower than fixed — the rate will be updated dynamically
      aprBps = 500; // 5% base floating rate
      if (amount > 2000) aprBps = 400;
      else if (amount > 1000) aprBps = 450;
    } else {
      // Fixed rate: locked at creation (traditional tiered model)
      aprBps = 1500; // 15% default
      if (amount > 2000) aprBps = 1000;       // 10%
      else if (amount > 1000) aprBps = 1200;  // 12%
    }

    // ── 4. Try to auto-assign a pool with enough liquidity and headroom under cap ─
    const availablePools = await db
      .select({
        id: lendingPools.id,
        availableLiquidity: lendingPools.availableLiquidity,
        totalBorrowed: lendingPools.totalBorrowed,
        borrowCap: lendingPools.borrowCap,
      })
      .from(lendingPools)
      .where(and(eq(lendingPools.status, "active"), gte(lendingPools.availableLiquidity, String(amount))))
      .orderBy(desc(lendingPools.availableLiquidity))
      .limit(10); // fetch a few so we can apply cap filtering

    const eligiblePool = availablePools.find((p) => {
      // If a borrow cap is set, ensure there is headroom (#153)
      if (p.borrowCap !== null) {
        return Number(p.totalBorrowed ?? 0) + amount <= Number(p.borrowCap);
      }
      return true; // no cap set — pool is eligible
    });

    const poolId = eligiblePool ? eligiblePool.id : null; // loan will be funded directly by a lender

    // ── 5. Create the loan ───────────────────────────────────────────────────
    const [loan] = await db
      .insert(loans)
      .values({
        borrowerId: user.id,
        poolId,
        principalAmount: String(amount),
        aprBps,
        durationDays: Number(durationDays),
        rateModel,
        status: "requested",
        metadata: { rate_model: rateModel },
      })
      .returning();

    // ── 6. Record request in ledger for traceability ────────────────────────
    try {
      await db.insert(ledgerTransactions).values({
        userId: user.id,
        category: "loan_request",
        amount: String(amount),
        currency: "XLM",
        status: "confirmed",
        refType: "loan_request",
        refId: loan.id,
        metadata: {
          stage: "requested",
          loanId: loan.id,
          durationDays: Number(durationDays),
          aprBps,
          rateModel,
          fundingPath: poolId ? "pool" : "direct",
        },
      });
    } catch (ledgerError) {
      // Roll back the just-created loan to keep invariants strict: every request must have a ledger entry.
      await db.delete(loans).where(and(eq(loans.id, loan.id), eq(loans.borrowerId, user.id)));
      const message = ledgerError instanceof Error ? ledgerError.message : String(ledgerError);
      return NextResponse.json({ error: `Failed to record transaction trail: ${message}` }, { status: 500 });
    }

    // ── Emit notification ──
    const { createNotification } = await import("@/lib/notifications");
    await createNotification({
      userId: user.id,
      title: "Loan Request Submitted",
      message: `Your ${rateModel}-rate request for ${amount} XLM is now live in the marketplace and waiting for lender funding.`,
      type: "loan_requested",
    });

    return NextResponse.json(
      {
        loan,
        rateModel,
        fundingPath: poolId ? "pool" : "direct",
        message: poolId
          ? `Your ${rateModel}-rate loan request has been submitted. A lending pool has been assigned — it will be processed shortly.`
          : `Your ${rateModel}-rate loan request is now open. A lender will fund it directly. You'll receive XLM in your wallet once funded.`,
      },
      { status: 201 }
    );
  } catch (error) {
    if (isRedirectError(error)) {
      throw error;
    }
    console.error("Loan application error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
