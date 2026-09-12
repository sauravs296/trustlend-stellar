import { and, desc, eq } from "drizzle-orm";
import type { AnyDb } from "@/lib/db/pools";
import { ledgerTransactions, loanFundings } from "@/lib/db/schema";
import type { LenderContribution } from "./funding";

/**
 * Everyone who funded a loan, and how much each put in (Issue #269).
 *
 * Reads `loan_fundings`, the per-contribution table. Loans funded before
 * partial fills existed are recorded only in `ledger_transactions`, so those
 * fall back to the ledger — the same place the single-lender code used to look.
 */
export async function getLoanLenders(db: AnyDb, loanId: string): Promise<LenderContribution[]> {
  const fundings = await db
    .select({
      lender_id: loanFundings.lenderId,
      lender_address: loanFundings.lenderAddress,
      amount: loanFundings.amount,
    })
    .from(loanFundings)
    .where(eq(loanFundings.loanId, loanId))
    .orderBy(desc(loanFundings.amount));

  if (fundings.length > 0) {
    return mergeByLender(
      fundings.map((row) => ({
        lenderId: String(row.lender_id ?? ""),
        address: String(row.lender_address ?? ""),
        contribution: Number(row.amount ?? 0),
      }))
    );
  }

  // ── Legacy fallback ────────────────────────────────────────────────────────
  // Pre-#269 loans are recorded only in the ledger.
  const fundTxs = await db
    .select({
      user_id: ledgerTransactions.userId,
      amount: ledgerTransactions.amount,
      metadata: ledgerTransactions.metadata,
    })
    .from(ledgerTransactions)
    .where(and(eq(ledgerTransactions.refType, "loan_fund"), eq(ledgerTransactions.refId, loanId)));

  const legacy = fundTxs.map((row) => {
    let address = "";

    try {
      const meta =
        typeof row.metadata === "string" ? JSON.parse(row.metadata) : row.metadata;
      address = String(meta?.lenderAddress ?? "");
    } catch {
      // Unparseable metadata means no wallet address; the caller filters it out.
    }

    return {
      lenderId: String(row.user_id ?? ""),
      address,
      contribution: Number(row.amount ?? 0),
    };
  });

  return mergeByLender(legacy);
}

/**
 * Collapse repeat contributions from the same wallet into one payout line, so
 * a lender who topped a loan up twice receives a single Stellar payment.
 */
function mergeByLender(entries: LenderContribution[]): LenderContribution[] {
  const merged = new Map<string, LenderContribution>();

  for (const entry of entries) {
    if (!entry.address || entry.contribution <= 0) continue;

    const existing = merged.get(entry.address);

    if (existing) {
      existing.contribution += entry.contribution;
    } else {
      merged.set(entry.address, { ...entry });
    }
  }

  return [...merged.values()].sort((a, b) => b.contribution - a.contribution);
}
