import { NextRequest, NextResponse } from "next/server";
import { and, eq, sql } from "drizzle-orm";
import { getDb } from "@/lib/db/client";
import { ledgerTransactions, lendingPools, poolPositions } from "@/lib/db/schema";
import { discoverSep31Anchor, verifyAnchorSignature } from "@/lib/stellar/sep31";

/**
 * POST /api/webhooks/sep31
 *
 * Webhook callback handler from the SEP-31 Anchor.
 * Automatically processes status updates, verifies the signature, and updates pool positions.
 */
export async function POST(request: NextRequest) {
  try {
    const rawBody = await request.text();
    const body = JSON.parse(rawBody);

    const txPayload = body.transaction ?? body;
    const { id: anchorTxId, status, stellar_transaction_id, message } = txPayload as {
      id: string;
      status: string;
      stellar_transaction_id?: string;
      message?: string;
    };

    if (!anchorTxId || !status) {
      return NextResponse.json({ error: "Invalid webhook payload" }, { status: 400 });
    }

    const db = getDb();
    if (!db) {
      return NextResponse.json({ error: "Database unavailable" }, { status: 503 });
    }

    // Find the matching pending transaction in the ledger
    const [ledgerTx] = await db
      .select({
        id: ledgerTransactions.id,
        user_id: ledgerTransactions.userId,
        amount: ledgerTransactions.amount,
        status: ledgerTransactions.status,
        metadata: ledgerTransactions.metadata,
      })
      .from(ledgerTransactions)
      .where(sql`${ledgerTransactions.metadata}->>'anchorTxId' = ${anchorTxId}`)
      .limit(1);

    if (!ledgerTx) {
      return NextResponse.json({ error: "Transaction not found" }, { status: 404 });
    }

    // Webhook signature verification
    const sigHeader =
      request.headers.get("x-stellar-signature") ||
      request.headers.get("signature") ||
      request.headers.get("X-Stellar-Signature");

    const homeDomain = process.env.NEXT_PUBLIC_SEP24_ANCHOR_HOME_DOMAIN ?? "testanchor.stellar.org";
    const isTestnet = (process.env.NEXT_PUBLIC_STELLAR_NETWORK_PASSPHRASE ?? "").includes("Test");

    if (sigHeader) {
      try {
        let signingKey = process.env.SEP31_ANCHOR_SIGNING_KEY;
        if (!signingKey) {
          const endpoints = await discoverSep31Anchor(homeDomain);
          signingKey = endpoints.signingKey;
        }

        const isValid = await verifyAnchorSignature(rawBody, sigHeader, signingKey);
        if (!isValid) {
          return NextResponse.json({ error: "Invalid webhook signature" }, { status: 401 });
        }
      } catch (err) {
        console.error("Webhook signature verification failed:", err);
        return NextResponse.json({ error: "Signature verification processing failed" }, { status: 400 });
      }
    } else if (!isTestnet) {
      // In production/mainnet, require a valid signature
      return NextResponse.json({ error: "Signature header missing" }, { status: 401 });
    }

    // If transaction is already processed, return 200 OK
    if (ledgerTx.status !== "pending") {
      return NextResponse.json({ success: true, message: "Transaction already processed" });
    }

    const metadata = typeof ledgerTx.metadata === "string"
      ? JSON.parse(ledgerTx.metadata)
      : ledgerTx.metadata || {};

    const { poolId } = metadata as { poolId: string };

    // ── Handle Payment Lifecycle ──────────────────────────────────────────────────
    if (status === "completed") {
      // 1. Check if lender already has an active position in this pool
      const [existingPosition] = await db
        .select({ id: poolPositions.id })
        .from(poolPositions)
        .where(
          and(
            eq(poolPositions.poolId, poolId),
            eq(poolPositions.lenderId, ledgerTx.user_id),
            eq(poolPositions.status, "active"),
          ),
        )
        .limit(1);

      let positionId = "";
      const depositAmount = Number(ledgerTx.amount);

      if (existingPosition) {
        // Update existing position amount
        const [updatedPosition] = await db
          .update(poolPositions)
          .set({ principalAmount: sql`${poolPositions.principalAmount} + ${depositAmount}` })
          .where(eq(poolPositions.id, existingPosition.id))
          .returning({ id: poolPositions.id });
        positionId = updatedPosition.id;
      } else {
        // Create new active position
        const [newPosition] = await db
          .insert(poolPositions)
          .values({ poolId, lenderId: ledgerTx.user_id, principalAmount: String(depositAmount), status: "active" })
          .returning({ id: poolPositions.id });
        positionId = newPosition.id;
      }

      // 2. Update pool liquidity (SQL-side increment)
      await db
        .update(lendingPools)
        .set({
          totalLiquidity: sql`${lendingPools.totalLiquidity} + ${depositAmount}`,
          availableLiquidity: sql`${lendingPools.availableLiquidity} + ${depositAmount}`,
        })
        .where(eq(lendingPools.id, poolId));

      // 3. Confirm the ledger transaction and associate with the position
      const updatedMetadata = {
        ...metadata,
        stellarTxHash: stellar_transaction_id ?? null,
        anchorStatus: status,
      };

      await db
        .update(ledgerTransactions)
        .set({ status: "confirmed", refId: positionId, metadata: updatedMetadata })
        .where(eq(ledgerTransactions.id, ledgerTx.id));

    } else if (status === "error" || status === "refunded") {
      // Compliance check failed or transaction was refunded
      const updatedMetadata = {
        ...metadata,
        anchorStatus: status,
        failureMessage: message ?? "Compliance check or payment failed at anchor",
        refunded: status === "refunded",
      };

      await db
        .update(ledgerTransactions)
        .set({ status: "failed", metadata: updatedMetadata })
        .where(eq(ledgerTransactions.id, ledgerTx.id));
    } else {
      // For intermediate statuses (like pending_stellar, pending_sender, hold),
      // we update the anchorStatus in metadata to track live progress.
      const updatedMetadata = {
        ...metadata,
        anchorStatus: status,
      };

      await db
        .update(ledgerTransactions)
        .set({ metadata: updatedMetadata })
        .where(eq(ledgerTransactions.id, ledgerTx.id));
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Failed to process SEP-31 webhook:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
