"use server";

/**
 * Admin Pools Server Actions
 *
 * Creating pools, approving loans against pool liquidity, and the auto-match
 * pass that funds pending loans from whichever active pool can cover them.
 */

import { asc, eq, sql } from "drizzle-orm";
import { requireApiAdmin } from "@/lib/auth/session";
import { getDb, type Db } from "@/lib/db/client";
import { fetchActivePoolsWithLiquidity, fetchPoolById } from "@/lib/db/pools";
import { lendingPools, loans } from "@/lib/db/schema";
import { sendLoanApprovedEmail } from "@/lib/email/resend";

async function requireAdmin(): Promise<{ db: Db }> {
  await requireApiAdmin();
  const db = getDb();
  if (!db) throw new Error("Database unavailable");
  return { db };
}

// ── Create a new lending pool ──────────────────────────────────────────────────
export async function createLendingPool(
  formData: FormData
): Promise<{ success: boolean; error?: string }> {
  try {
    const { db } = await requireAdmin();

    const name = String(formData.get("name") ?? "").trim();
    const aprBps = parseInt(String(formData.get("apr_bps") ?? "0"), 10);
    const description = String(formData.get("description") ?? "").trim();
    const borrowCapRaw = formData.get("borrow_cap");
    const borrowCap =
      borrowCapRaw !== null && borrowCapRaw !== "" ? parseFloat(String(borrowCapRaw)) : null;

    if (borrowCap !== null && (borrowCap <= 0 || !Number.isFinite(borrowCap))) {
      return { success: false, error: "Borrow cap must be a positive number" };
    }
    if (!name) return { success: false, error: "Pool name is required" };
    if (!aprBps || aprBps <= 0 || aprBps > 10000)
      return { success: false, error: "APR must be between 0.01% and 100%" };

    await db.insert(lendingPools).values({
      name,
      description: description || null,
      status: "active",
      aprBps,
      totalLiquidity: "0",
      availableLiquidity: "0",
      borrowCap: borrowCap === null ? null : String(borrowCap),
    });

    return { success: true };
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : "Failed" };
  }
}

// ── Toggle pool active/paused ──────────────────────────────────────────────────
export async function togglePoolStatus(
  poolId: string,
  newStatus: "active" | "paused"
): Promise<{ success: boolean; error?: string }> {
  try {
    const { db } = await requireAdmin();
    await db.update(lendingPools).set({ status: newStatus }).where(eq(lendingPools.id, poolId));
    return { success: true };
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : "Failed" };
  }
}

/** Approve a pending loan and reserve its principal from the pool. */
export async function approveLoan(
  loanId: string,
  poolId: string
): Promise<{ success: boolean; error?: string }> {
  try {
    const { db } = await requireAdmin();

    const [loan] = await db
      .select({
        id: loans.id,
        borrowerId: loans.borrowerId,
        status: loans.status,
        principalAmount: loans.principalAmount,
      })
      .from(loans)
      .where(eq(loans.id, loanId))
      .limit(1);

    if (!loan) return { success: false, error: "Loan not found" };
    if (loan.status !== "requested")
      return { success: false, error: `Loan is already ${loan.status}` };

    const pool = await fetchPoolById(db, poolId);
    if (!pool) return { success: false, error: "Pool not found" };
    if (pool.status !== "active") return { success: false, error: "Pool is not active" };

    const loanAmount = Number(loan.principalAmount ?? 0);
    const available = pool.available_liquidity;

    if (loanAmount > available) {
      return {
        success: false,
        error: `Insufficient pool liquidity: need ${loanAmount} XLM, pool has ${available} XLM`,
      };
    }

    // Borrow cap enforcement (#153)
    if (pool.borrow_cap !== null && pool.total_borrowed + loanAmount > pool.borrow_cap) {
      return {
        success: false,
        error: `Pool borrow cap exceeded: pool has borrowed ${pool.total_borrowed} XLM, cap is ${pool.borrow_cap} XLM, loan needs ${loanAmount} XLM`,
      };
    }

    const now = new Date();
    await db
      .update(loans)
      .set({ status: "approved", poolId, approvedAt: now })
      .where(eq(loans.id, loanId));
    await db
      .update(lendingPools)
      .set({ availableLiquidity: sql`${lendingPools.availableLiquidity} - ${loanAmount}` })
      .where(eq(lendingPools.id, poolId));

    await sendLoanApprovedEmail({ userId: loan.borrowerId, amount: loanAmount, loanId });

    return { success: true };
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : "Failed" };
  }
}

/** Run auto-matching: approve every pending loan an active pool can cover. */
export async function runAutoMatch(): Promise<{
  success: boolean;
  matched: number;
  skipped: number;
  error?: string;
}> {
  try {
    const { db } = await requireAdmin();

    const pendingLoans = await db
      .select({
        id: loans.id,
        borrowerId: loans.borrowerId,
        principalAmount: loans.principalAmount,
        poolId: loans.poolId,
      })
      .from(loans)
      .where(eq(loans.status, "requested"))
      .orderBy(asc(loans.requestedAt));

    if (pendingLoans.length === 0) {
      return { success: true, matched: 0, skipped: 0 };
    }

    const activePools = await fetchActivePoolsWithLiquidity(db, 0);
    if (activePools.length === 0) {
      return { success: true, matched: 0, skipped: pendingLoans.length };
    }

    // Mutable liquidity map so several loans can draw on one pool in a pass.
    const poolLiquidity = new Map<string, number>(
      activePools.map((p) => [p.id, p.available_liquidity])
    );

    let matched = 0;
    let skipped = 0;
    const now = new Date();

    for (const loan of pendingLoans) {
      const amount = Number(loan.principalAmount ?? 0);

      let targetPoolId: string | null = null;
      const assignedPool = loan.poolId ?? null;
      if (assignedPool && (poolLiquidity.get(assignedPool) ?? 0) >= amount) {
        targetPoolId = assignedPool;
      } else {
        // Pools are already sorted by available liquidity (desc).
        for (const pool of activePools) {
          if ((poolLiquidity.get(pool.id) ?? 0) >= amount) {
            targetPoolId = pool.id;
            break;
          }
        }
      }

      if (!targetPoolId) {
        skipped++;
        continue;
      }

      // Borrow cap enforcement (#153)
      const targetPool = activePools.find((p) => p.id === targetPoolId);
      if (targetPool && targetPool.borrow_cap !== null && targetPool.total_borrowed + amount > targetPool.borrow_cap) {
        skipped++;
        continue;
      }

      try {
        await db
          .update(loans)
          .set({ status: "approved", poolId: targetPoolId, approvedAt: now })
          .where(eq(loans.id, loan.id));
        await db
          .update(lendingPools)
          .set({ availableLiquidity: sql`${lendingPools.availableLiquidity} - ${amount}` })
          .where(eq(lendingPools.id, targetPoolId));
      } catch {
        skipped++;
        continue;
      }

      poolLiquidity.set(targetPoolId, (poolLiquidity.get(targetPoolId) ?? 0) - amount);
      await sendLoanApprovedEmail({ userId: loan.borrowerId, amount, loanId: loan.id });
      matched++;
    }

    return { success: true, matched, skipped };
  } catch (err) {
    return {
      success: false,
      matched: 0,
      skipped: 0,
      error: err instanceof Error ? err.message : "Auto-match failed",
    };
  }
}

// ── Set pool borrow cap ──────────────────────────────────────────────────────
/** Set or clear the borrow cap for a lending pool (null = unlimited). */
export async function setPoolBorrowCap(
  poolId: string,
  borrowCap: number | null
): Promise<{ success: boolean; error?: string }> {
  try {
    const { db } = await requireAdmin();

    if (borrowCap !== null && (borrowCap <= 0 || !Number.isFinite(borrowCap))) {
      return { success: false, error: "Borrow cap must be a positive number or null" };
    }

    await db
      .update(lendingPools)
      .set({ borrowCap: borrowCap === null ? null : String(borrowCap) })
      .where(eq(lendingPools.id, poolId));

    return { success: true };
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : "Failed" };
  }
}
