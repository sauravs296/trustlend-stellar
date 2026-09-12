/**
 * lib/db/pools.ts
 *
 * Lending-pool queries. Every function takes the Drizzle handle explicitly so
 * callers decide whether they are on the HTTP or pooled driver, and so tests
 * can inject a fake.
 *
 * Numeric columns come back from Postgres as strings; they are coerced to
 * numbers at this boundary so the rest of the app never has to.
 */

import { asc, desc, eq, gt, sql, type SQL } from "drizzle-orm";
import type { Db, PooledDb } from "@/lib/db/client";
import { lendingPools, loans, profiles } from "@/lib/db/schema";

export type AnyDb = Db | PooledDb;

// ─────────────────────────────────────────────────────────────────────────────
// TYPE DEFINITIONS
// ─────────────────────────────────────────────────────────────────────────────

export interface Pool {
  id: string;
  name: string;
  description: string | null;
  status: "active" | "paused" | "closed";
  apr_bps: number;
  total_liquidity: number;
  available_liquidity: number;
  total_borrowed: number;
  borrow_cap: number | null;
  created_at: string;
  updated_at: string;
}

export interface PoolFetchOptions {
  status?: "active" | "paused" | "closed";
  limit?: number;
  offset?: number;
  orderBy?: "created_at" | "available_liquidity";
  orderDirection?: "asc" | "desc";
}

export interface PoolFetchResult {
  pools: Pool[];
  totalCount: number;
  estimatedTotalCount: number;
  hasMore: boolean;
}

const POOL_COLUMNS = {
  id: lendingPools.id,
  name: lendingPools.name,
  description: lendingPools.description,
  status: lendingPools.status,
  apr_bps: lendingPools.aprBps,
  total_liquidity: lendingPools.totalLiquidity,
  available_liquidity: lendingPools.availableLiquidity,
  total_borrowed: lendingPools.totalBorrowed,
  borrow_cap: lendingPools.borrowCap,
  created_at: lendingPools.createdAt,
  updated_at: lendingPools.updatedAt,
};

// ─────────────────────────────────────────────────────────────────────────────
// FETCH FUNCTIONS
// ─────────────────────────────────────────────────────────────────────────────

/** Fetch pools with optional filtering and pagination. */
export async function fetchPools(db: AnyDb, options: PoolFetchOptions = {}): Promise<PoolFetchResult> {
  const { status, limit = 10, offset = 0, orderBy = "created_at", orderDirection = "desc" } = options;

  const validLimit = Math.min(Math.max(Math.floor(limit) || 10, 1), 100);
  const validOffset = Math.max(Math.floor(offset) || 0, 0);

  const where: SQL | undefined = status ? eq(lendingPools.status, status) : undefined;
  const orderColumn = orderBy === "available_liquidity" ? lendingPools.availableLiquidity : lendingPools.createdAt;
  const order = orderDirection === "asc" ? asc(orderColumn) : desc(orderColumn);

  const [rows, [{ count }]] = await Promise.all([
    db.select(POOL_COLUMNS).from(lendingPools).where(where).orderBy(order).limit(validLimit).offset(validOffset),
    db.select({ count: sql<number>`count(*)::int` }).from(lendingPools).where(where),
  ]);

  const pools = rows.map(mapRawPoolToPool);
  return {
    pools,
    totalCount: count,
    estimatedTotalCount: count,
    hasMore: validOffset + pools.length < count,
  };
}

/** Fetch a single pool by ID. */
export async function fetchPoolById(db: AnyDb, poolId: string): Promise<Pool | null> {
  const [row] = await db.select(POOL_COLUMNS).from(lendingPools).where(eq(lendingPools.id, poolId)).limit(1);
  return row ? mapRawPoolToPool(row) : null;
}

/**
 * Active pools ordered by available liquidity (desc). Used for auto-matching
 * and loan approval.
 */
export async function fetchActivePoolsWithLiquidity(db: AnyDb, minimumLiquidity: number = 0): Promise<Pool[]> {
  const conditions = [eq(lendingPools.status, "active")];
  if (minimumLiquidity > 0) {
    conditions.push(gt(lendingPools.availableLiquidity, String(minimumLiquidity)));
  }
  const rows = await db
    .select(POOL_COLUMNS)
    .from(lendingPools)
    .where(sql.join(conditions, sql` and `))
    .orderBy(desc(lendingPools.availableLiquidity));
  return rows.map(mapRawPoolToPool);
}

export interface PendingLoanSummary {
  id: string;
  status: string;
  principal_amount: number;
  apr_bps: number;
  duration_days: number;
  requested_at: string;
  borrower_id: string;
  borrower_profile: { full_name: string | null } | null;
}

/** Pools + pending loans (with borrower name) for the admin pool dashboard. */
export async function fetchAdminDashboardPools(db: AnyDb): Promise<{
  pools: Pool[];
  pendingLoans: PendingLoanSummary[];
}> {
  const [poolRows, loanRows] = await Promise.all([
    db.select(POOL_COLUMNS).from(lendingPools).orderBy(desc(lendingPools.createdAt)),
    db
      .select({
        id: loans.id,
        status: loans.status,
        principal_amount: loans.principalAmount,
        apr_bps: loans.aprBps,
        duration_days: loans.durationDays,
        requested_at: loans.requestedAt,
        borrower_id: loans.borrowerId,
        borrower_name: profiles.fullName,
      })
      .from(loans)
      .leftJoin(profiles, eq(profiles.id, loans.borrowerId))
      .where(eq(loans.status, "requested"))
      .orderBy(asc(loans.requestedAt)),
  ]);

  return {
    pools: poolRows.map(mapRawPoolToPool),
    pendingLoans: loanRows.map((loan) => ({
      id: loan.id,
      status: loan.status,
      principal_amount: Number(loan.principal_amount ?? 0),
      apr_bps: loan.apr_bps,
      duration_days: loan.duration_days,
      requested_at: loan.requested_at.toISOString(),
      borrower_id: loan.borrower_id,
      borrower_profile: loan.borrower_name !== null ? { full_name: loan.borrower_name } : null,
    })),
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// HELPERS
// ─────────────────────────────────────────────────────────────────────────────

interface RawPool {
  id: string;
  name: string;
  description: string | null;
  status: "active" | "paused" | "closed";
  apr_bps: number;
  total_liquidity: string | number;
  available_liquidity: string | number;
  total_borrowed: string | number;
  borrow_cap: string | number | null;
  created_at: Date | string;
  updated_at: Date | string;
}

function toIso(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : String(value);
}

/** Coerce a raw row to a typed Pool (numeric → number, timestamps → ISO). */
export function mapRawPoolToPool(raw: RawPool): Pool {
  return {
    id: raw.id,
    name: raw.name,
    description: raw.description,
    status: raw.status,
    apr_bps: Number(raw.apr_bps),
    total_liquidity: Number(raw.total_liquidity ?? 0),
    available_liquidity: Number(raw.available_liquidity ?? 0),
    total_borrowed: Number(raw.total_borrowed ?? 0),
    borrow_cap: raw.borrow_cap !== null && raw.borrow_cap !== undefined ? Number(raw.borrow_cap) : null,
    created_at: toIso(raw.created_at),
    updated_at: toIso(raw.updated_at),
  };
}
