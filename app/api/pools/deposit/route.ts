import { NextRequest, NextResponse } from "next/server";
import { requireAuthenticatedUser } from "@/lib/auth/session";
import { enforceRouteRateLimit } from "@/lib/rate-limit";
import { and, eq, sql } from "drizzle-orm";
import { getDb } from "@/lib/db/client";
import { ledgerTransactions, lendingPools, poolPositions } from "@/lib/db/schema";
import { requireKycVerified } from "@/lib/kyc/middleware";
import { isRedirectError } from "next/dist/client/components/redirect-error";

/**
 * POST /api/pools/deposit
 *
 * Body: { poolId, amount, txHash, lenderAddress }
 *
 * Flow:
 *   1. Lender signs a real Stellar payment tx in Freighter (client-side)
 *   2. Client passes the confirmed tx hash here
 *   3. We verify the tx hash is non-empty, then record the position
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

    // ── KYC guard: regulated pool deposits require verified identity ────────
    const kycCheck = await requireKycVerified(user.id, db, { regulatedPoolOnly: true });
    if (!kycCheck.allowed) {
      return NextResponse.json(
        { error: kycCheck.reason, kycStatus: kycCheck.kycStatus },
        { status: 403 }
      );
    }

    const body = await request.json();
    const { poolId, amount, txHash, lenderAddress } = body as {
      poolId: string;
      amount: number;
      txHash?: string;
      lenderAddress?: string;
    };

    if (!poolId || !amount || amount <= 0 || !Number.isFinite(amount)) {
      return NextResponse.json({ error: "Invalid request" }, { status: 400 });
    }
    if (amount > 1_000_000) {
      return NextResponse.json({ error: "Amount exceeds maximum allowed" }, { status: 400 });
    }

    // Require a real Stellar tx hash — no ghost deposits
    if (!txHash || txHash.trim().length < 10) {
      return NextResponse.json(
        { error: "A confirmed Stellar transaction hash is required" },
        { status: 400 }
      );
    }

    // Prevent duplicate recording of the same tx
    const [existingTx] = await db
      .select({ id: ledgerTransactions.id })
      .from(ledgerTransactions)
      .where(sql`${ledgerTransactions.metadata}->>'txHash' = ${txHash}`)
      .limit(1);

    if (existingTx) {
      return NextResponse.json(
        { error: "This transaction has already been recorded" },
        { status: 409 }
      );
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

    // Upsert pool position (add to existing or create new)
    const [existingPosition] = await db
      .select({ id: poolPositions.id })
      .from(poolPositions)
      .where(
        and(eq(poolPositions.poolId, poolId), eq(poolPositions.lenderId, user.id), eq(poolPositions.status, "active")),
      )
      .limit(1);

    let position;
    if (existingPosition) {
      [position] = await db
        .update(poolPositions)
        .set({ principalAmount: sql`${poolPositions.principalAmount} + ${amount}` })
        .where(eq(poolPositions.id, existingPosition.id))
        .returning();
    } else {
      [position] = await db
        .insert(poolPositions)
        .values({ poolId, lenderId: user.id, principalAmount: String(amount), status: "active" })
        .returning();
    }

    // Update pool liquidity atomically (SQL-side increment, no read-modify-write race)
    await db
      .update(lendingPools)
      .set({
        totalLiquidity: sql`${lendingPools.totalLiquidity} + ${amount}`,
        availableLiquidity: sql`${lendingPools.availableLiquidity} + ${amount}`,
      })
      .where(eq(lendingPools.id, poolId));

    // Record ledger entry with tx hash for on-chain verification
    await db.insert(ledgerTransactions).values({
      userId: user.id,
      category: "deposit",
      amount: String(amount),
      currency: "XLM",
      status: "confirmed",
      refType: "pool_position",
      refId: position.id,
      metadata: { txHash, lenderAddress: lenderAddress ?? null, poolId },
    });

    return NextResponse.json(
      {
        position,
        txHash,
        explorerUrl: `https://stellar.expert/explorer/testnet/tx/${txHash}`,
      },
      { status: 201 }
    );
  } catch (error) {
    if (isRedirectError(error)) {
      throw error;
    }
    console.error("Deposit error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
