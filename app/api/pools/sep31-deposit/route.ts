import { NextRequest, NextResponse } from "next/server";
import { requireAuthenticatedUser } from "@/lib/auth/session";
import { enforceRouteRateLimit } from "@/lib/rate-limit";
import { and, eq, sql } from "drizzle-orm";
import { getDb } from "@/lib/db/client";
import { ledgerTransactions, lendingPools } from "@/lib/db/schema";
import { requireKycVerified } from "@/lib/kyc/middleware";

/**
 * POST /api/pools/sep31-deposit
 *
 * Body: { poolId, amount, currency, anchorTxId, instructions, lenderAddress }
 *
 * Records an initiated SEP-31 deposit as a 'pending' transaction in the ledger.
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

    // Require KYC verification for lenders using fiat rails
    const kycCheck = await requireKycVerified(user.id, db, { regulatedPoolOnly: true });
    if (!kycCheck.allowed) {
      return NextResponse.json(
        { error: kycCheck.reason, kycStatus: kycCheck.kycStatus },
        { status: 403 }
      );
    }

    const body = await request.json();
    const { poolId, amount, currency, anchorTxId, instructions, lenderAddress } = body as {
      poolId: string;
      amount: number;
      currency: string;
      anchorTxId: string;
      instructions: Record<string, unknown>;
      lenderAddress?: string;
    };

    if (!poolId || !amount || amount <= 0 || !currency || !anchorTxId || !instructions) {
      return NextResponse.json({ error: "Invalid request parameters" }, { status: 400 });
    }

    // Verify pool exists and is active
    const [pool] = await db
      .select({ id: lendingPools.id })
      .from(lendingPools)
      .where(and(eq(lendingPools.id, poolId), eq(lendingPools.status, "active")))
      .limit(1);

    if (!pool) {
      return NextResponse.json({ error: "Pool not found or inactive" }, { status: 404 });
    }

    // Prevent duplicate recording of the same anchor transaction
    const [existingTx] = await db
      .select({ id: ledgerTransactions.id })
      .from(ledgerTransactions)
      .where(sql`${ledgerTransactions.metadata}->>'anchorTxId' = ${anchorTxId}`)
      .limit(1);

    if (existingTx) {
      return NextResponse.json(
        { error: "This transaction has already been recorded" },
        { status: 409 }
      );
    }

    // Record the pending deposit ledger entry
    const [transaction] = await db
      .insert(ledgerTransactions)
      .values({
        userId: user.id,
        category: "deposit",
        amount: String(amount),
        currency,
        status: "pending",
        refType: "pool_position",
        refId: null, // pool_position is created asynchronously upon webhook confirmation
        metadata: { anchorTxId, instructions, poolId, lenderAddress: lenderAddress ?? null, isSep31: true },
      })
      .returning();

    return NextResponse.json({ success: true, transaction });
  } catch (error) {
    console.error("Failed to record SEP-31 deposit:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
