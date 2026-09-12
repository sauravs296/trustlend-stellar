import { and, asc, eq } from "drizzle-orm";
import type { AnyDb } from "@/lib/db/pools";
import { ledgerTransactions, lendingPools, poolPositions } from "@/lib/db/schema";
import type {
  P2pFundingInput,
  P2pRepaymentInput,
  PoolPositionInput,
} from "./tax-report";

/**
 * Gather everything a lender's tax report is built from (Issue #271).
 *
 * Two income sources, and they come from different places:
 *   * Pool positions live in `pool_positions`.
 *   * P2P activity lives in `ledger_transactions`. The lender's own fundings
 *     are keyed by user_id, but the matching repayments were written by the
 *     *borrower*, so they are found by a metadata match.
 */

export type TaxReportData = {
  poolPositions: PoolPositionInput[];
  fundings: P2pFundingInput[];
  repayments: P2pRepaymentInput[];
};

/** Repayment rows are scanned in bulk; cap the scan so one lender cannot pull the whole ledger. */
const REPAYMENT_SCAN_LIMIT = 2000;

type LedgerMetadata = {
  lenderUserId?: string;
  lenderAddress?: string;
  loanId?: string;
  txHash?: string;
  lenderPayouts?: Array<{ lenderUserId?: string; address?: string; payout?: number }>;
};

function parseMetadata(raw: unknown): LedgerMetadata {
  if (!raw) return {};

  try {
    return (typeof raw === "string" ? JSON.parse(raw) : raw) as LedgerMetadata;
  } catch {
    return {};
  }
}

export async function getLenderTaxReportData(
  db: AnyDb,
  userId: string,
  walletAddress?: string | null
): Promise<TaxReportData> {
  const [positionRows, fundingRows] = await Promise.all([
    db
      .select({
        id: poolPositions.id,
        pool_id: poolPositions.poolId,
        principal_amount: poolPositions.principalAmount,
        earned_interest: poolPositions.earnedInterest,
        opened_at: poolPositions.openedAt,
        closed_at: poolPositions.closedAt,
        pool_name: lendingPools.name,
        pool_currency: lendingPools.currency,
      })
      .from(poolPositions)
      .leftJoin(lendingPools, eq(lendingPools.id, poolPositions.poolId))
      .where(eq(poolPositions.lenderId, userId)),
    db
      .select({
        ref_id: ledgerTransactions.refId,
        amount: ledgerTransactions.amount,
        currency: ledgerTransactions.currency,
        created_at: ledgerTransactions.createdAt,
        metadata: ledgerTransactions.metadata,
      })
      .from(ledgerTransactions)
      .where(and(eq(ledgerTransactions.userId, userId), eq(ledgerTransactions.refType, "loan_fund"))),
  ]);

  const positions: PoolPositionInput[] = positionRows.map((row) => ({
    id: row.id,
    poolId: row.pool_id,
    poolName: row.pool_name ?? null,
    asset: row.pool_currency ?? null,
    principalAmount: row.principal_amount,
    earnedInterest: row.earned_interest,
    openedAt: row.opened_at ? row.opened_at.toISOString() : null,
    closedAt: row.closed_at ? row.closed_at.toISOString() : null,
  }));

  const fundings: P2pFundingInput[] = fundingRows.map((row) => {
    const meta = parseMetadata(row.metadata);

    return {
      loanId: String(meta.loanId ?? row.ref_id ?? ""),
      amount: row.amount,
      asset: row.currency ? String(row.currency) : null,
      date: row.created_at ? row.created_at.toISOString() : null,
    };
  });

  const repayments = await getLenderRepayments(db, userId, walletAddress);

  return { poolPositions: positions, fundings, repayments };
}

/**
 * Repayments that reached this lender.
 *
 * The ledger row is owned by the borrower, so the lender is identified from the
 * metadata the repayment route writes. Both the user id and the wallet address
 * are checked because older rows recorded only one of them.
 */
async function getLenderRepayments(
  db: AnyDb,
  userId: string,
  walletAddress?: string | null
): Promise<P2pRepaymentInput[]> {
  const data = await db
    .select({
      ref_id: ledgerTransactions.refId,
      amount: ledgerTransactions.amount,
      currency: ledgerTransactions.currency,
      created_at: ledgerTransactions.createdAt,
      metadata: ledgerTransactions.metadata,
    })
    .from(ledgerTransactions)
    .where(eq(ledgerTransactions.refType, "loan_repay"))
    .orderBy(asc(ledgerTransactions.createdAt))
    .limit(REPAYMENT_SCAN_LIMIT);

  const repayments: P2pRepaymentInput[] = [];

  for (const row of data) {
    const meta = parseMetadata(row.metadata);

    const matchesUser = meta.lenderUserId != null && String(meta.lenderUserId) === userId;
    const matchesWallet =
      Boolean(walletAddress) &&
      meta.lenderAddress != null &&
      String(meta.lenderAddress) === walletAddress;

    // A loan filled by several lenders (#269) records a per-lender payout
    // breakdown; credit this lender only with their own share.
    const payout = Array.isArray(meta.lenderPayouts)
      ? meta.lenderPayouts.find(
          (entry) =>
            (entry.lenderUserId != null && String(entry.lenderUserId) === userId) ||
            (Boolean(walletAddress) && entry.address === walletAddress)
        )
      : undefined;

    if (!payout && !matchesUser && !matchesWallet) continue;

    repayments.push({
      loanId: String(meta.loanId ?? row.ref_id ?? ""),
      amount: payout?.payout ?? row.amount,
      asset: row.currency ? String(row.currency) : null,
      date: row.created_at ? row.created_at.toISOString() : null,
      txHash: meta.txHash ? String(meta.txHash) : null,
    });
  }

  return repayments;
}
