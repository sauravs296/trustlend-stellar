import { WorkspaceFrame } from "@/components/dashboard/WorkspaceFrame";
import { requireAuthenticatedUser } from "@/lib/auth/session";
import { getLenderDashboardMetrics, presentLenderMetrics } from "@/lib/dashboard/metrics";
import { desc, eq } from "drizzle-orm";
import { getDb } from "@/lib/db/client";
import { readMetadata } from "@/lib/db/metadata";
import { getProfile } from "@/lib/db/queries";
import { ledgerToRow } from "@/lib/db/rows";
import { ledgerTransactions } from "@/lib/db/schema";
import { lenderNavLinks } from "@/lib/dashboard/lender-links";
import { ExportCsvButton } from "@/components/dashboard/ExportCsvButton";
import { LenderHistoryClient } from "./client";

export default async function LenderHistoryPage() {
  const { user } = await requireAuthenticatedUser("lender");
  const metrics = await getLenderDashboardMetrics(user.id);
  const db = getDb();

  // Profile data
  const profile = await getProfile(db, user.id);

  // Fetch initial transactions with limit for server-side rendering
  const PAGE_SIZE = 20;

  const [userTxs, allRepays] = db
    ? await Promise.all([
        db
          .select()
          .from(ledgerTransactions)
          .where(eq(ledgerTransactions.userId, user.id))
          .orderBy(desc(ledgerTransactions.createdAt))
          .limit(PAGE_SIZE + 1),
        // Incoming repayments are written by the borrower; match on metadata.
        db
          .select()
          .from(ledgerTransactions)
          .where(eq(ledgerTransactions.refType, "loan_repay"))
          .orderBy(desc(ledgerTransactions.createdAt))
          .limit(200),
      ])
    : [[], []];

  const hasMore = userTxs.length > PAGE_SIZE;
  const items = userTxs.slice(0, PAGE_SIZE).map(ledgerToRow);

  const incomingRepays = allRepays.map(ledgerToRow).filter((tx) => {
    const meta = readMetadata(tx.metadata);
    return String(meta.lenderUserId) === user.id || String(meta.lenderAddress) === user.walletAddress;
  });

  // Merge and dedup
  const txMap = new Map<string, (typeof items)[number]>();
  for (const t of items) txMap.set(t.id, t);
  for (const t of incomingRepays) txMap.set(t.id, t);

  const transactions = Array.from(txMap.values()).sort(
    (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
  );

  // Format transactions
  const initialTransactions = transactions.map((tx) => {
    const meta = readMetadata(tx.metadata);
    const txHash = String(meta.txHash ?? "");
    let subLabel = "";
    if (meta.loanId) subLabel = `Loan #${String(meta.loanId).slice(0, 8)}`;
    else if (tx.ref_id) subLabel = `Ref #${String(tx.ref_id).slice(0, 8)}`;

    let label = "Transaction";
    if (tx.ref_type === "loan_fund") label = "P2P Loan Deployed";
    else if (tx.ref_type === "loan_repay") label = "Repayment Received";
    else if (tx.category === "pool_deposit") label = "Pool Deposit";
    else if (tx.category === "pool_withdraw") label = "Pool Withdrawal";

    let type: "funding" | "repayment" | "deposit" | "withdrawal" = "funding";
    if (tx.ref_type === "loan_fund") type = "funding";
    else if (tx.ref_type === "loan_repay") type = "repayment";
    else if (tx.category === "pool_deposit") type = "deposit";
    else if (tx.category === "pool_withdraw") type = "withdrawal";

    return {
      id: tx.id,
      label,
      subLabel,
      amount: Number(tx.amount),
      currency: tx.currency || "XLM",
      date: String(tx.created_at),
      status: tx.status || "completed",
      txHash,
      type,
    };
  });

  const exportData = initialTransactions.map((tx) => ({
    "Transaction ID": tx.id,
    "Type": tx.label,
    "Reference": tx.subLabel,
    "Amount": tx.amount.toFixed(2),
    "Currency": tx.currency,
    "Date": tx.date ? new Date(String(tx.date)).toLocaleString() : "",
    "Status": tx.status,
    "Stellar Tx Hash": tx.txHash,
  }));

  return (
    <WorkspaceFrame
      roleLabel="Lender Dashboard"
      heading="Transaction History"
      description="A full chronological record of every investment, pool deposit, and repayment — fully verifiable on-chain."
      email={user.email ?? null}
      userName={String(
        user.fullName ?? profile?.full_name ?? ""
      )}
      metrics={presentLenderMetrics(metrics)}
      currentPath="/dashboard/lender/history"
      links={lenderNavLinks}
    >
      <div className="workspace-stack">
        {/* Transaction stream */}
        <article className="workspace-card workspace-card--full">
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              marginBottom: "1.25rem",
            }}
          >
            <h2 className="workspace-card-title" style={{ margin: 0 }}>
              All Transactions
            </h2>
            <ExportCsvButton
              data={exportData}
              filename={`lender_transactions_${new Date().toISOString().slice(0, 10)}.csv`}
            />
          </div>

          <LenderHistoryClient
            initialTransactions={initialTransactions}
            hasMore={hasMore}
          />
        </article>
      </div>
    </WorkspaceFrame>
  );
}