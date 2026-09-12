import { WorkspaceFrame } from "@/components/dashboard/WorkspaceFrame";
import { requireAuthenticatedUser } from "@/lib/auth/session";
import { getBorrowerDashboardMetrics, presentBorrowerMetrics } from "@/lib/dashboard/metrics";
import { getDb } from "@/lib/db/client";
import { metaString } from "@/lib/db/metadata";
import { getBorrowerLoans, getLedgerByRef, getProfile, getRepaymentsForLoans } from "@/lib/db/queries";
import { borrowerNavLinks } from "@/lib/dashboard/borrower-links";
import { ExportCsvButton } from "@/components/dashboard/ExportCsvButton";
import { formatCurrency } from "@/lib/utils/formatting";
import { BorrowerHistoryClient } from "./client";

export default async function BorrowerHistoryPage() {
  const { user } = await requireAuthenticatedUser("borrower");
  const metrics = await getBorrowerDashboardMetrics(user.id);

  const db = getDb();

  // Fetch initial data for summary stats and first page
  const [profile, loans] = await Promise.all([getProfile(db, user.id), getBorrowerLoans(db, user.id, 20)]);
  const loanIds = loans.map((l) => l.id);

  // Ledger events (funding + request stage) and repayments for these loans
  const [fundLedger, requestLedger, repayments] = await Promise.all([
    getLedgerByRef(db, "loan_fund", loanIds),
    getLedgerByRef(db, "loan_request", loanIds),
    getRepaymentsForLoans(db, loanIds, 100),
  ]);

  const loanTxMap: Record<string, { hash: string; amount: number; date: string }> = {};
  for (const entry of fundLedger) {
    if (!entry.ref_id) continue;
    loanTxMap[entry.ref_id] = {
      hash: metaString(entry.metadata, "txHash"),
      amount: Number(entry.amount ?? 0),
      date: entry.created_at,
    };
  }

  const requestTxMap: Record<string, { date: string; amount: number }> = {};
  for (const entry of requestLedger) {
    if (!entry.ref_id) continue;
    requestTxMap[entry.ref_id] = { date: entry.created_at, amount: Number(entry.amount ?? 0) };
  }

  // Repayment ledger rows carry the tx hash (one query instead of one per repayment).
  const repayLedger = await getLedgerByRef(db, "loan_repay", repayments.map((r) => r.id));
  const repayHashById: Record<string, string> = {};
  for (const entry of repayLedger) {
    if (entry.ref_id) repayHashById[entry.ref_id] = metaString(entry.metadata, "txHash");
  }

  // Build initial transaction feed
  const initialTransactions: Array<{
    id: string;
    type: "loan_requested" | "funding_received" | "repayment_made";
    loanId: string;
    amount: number;
    date: string;
    txHash: string;
    loanStatus: string;
  }> = [];

  // Request events
  for (const loan of loans) {
    const loanId = String(loan.id);
    const requestTx = requestTxMap[loanId];
    const amount = requestTx?.amount ?? Number(loan.principal_amount ?? 0);
    const date = requestTx?.date || String(loan.created_at ?? "");

    initialTransactions.push({
      id: `request-${loanId}`,
      type: "loan_requested",
      loanId,
      amount,
      date,
      txHash: "",
      loanStatus: String(loan.status),
    });
  }

  // Funding events
  for (const loan of loans) {
    const loanId = String(loan.id);
    const ledger = loanTxMap[loanId];
    if (ledger && ledger.amount > 0) {
      initialTransactions.push({
        id: `fund-${loanId}`,
        type: "funding_received",
        loanId,
        amount: ledger.amount,
        date: ledger.date || String(loan.created_at ?? ""),
        txHash: ledger.hash,
        loanStatus: String(loan.status),
      });
    }
  }

  // Repayment events
  for (const r of repayments) {
    const loan = loans.find((l) => l.id === r.loan_id);
    if (!loan) continue;

    const txHash = repayHashById[r.id] ?? "";

    initialTransactions.push({
      id: `repay-${r.id}`,
      type: "repayment_made",
      loanId: String(r.loan_id),
      amount: Number(r.amount),
      date: String(r.created_at ?? ""),
      txHash,
      loanStatus: String(loan.status),
    });
  }

  // Sort by date descending
  initialTransactions.sort(
    (a, b) => new Date(b.date).getTime() - new Date(a.date).getTime()
  );

  // Calculate summary stats from initial data
  const totalFunded = initialTransactions
    .filter((t) => t.type === "funding_received")
    .reduce((sum, t) => sum + t.amount, 0);
  const totalRepaid = initialTransactions
    .filter((t) => t.type === "repayment_made")
    .reduce((sum, t) => sum + t.amount, 0);

  const exportData = initialTransactions.map((tx) => {
    const isRequested = tx.type === "loan_requested";
    const isFunding = tx.type === "funding_received";

    const label = isRequested
      ? "Loan Request Created"
      : isFunding
        ? "Funding Received"
        : "Repayment Made";

    return {
      "Transaction ID": tx.id,
      "Type": label,
      "Loan ID": tx.loanId,
      "Amount": tx.amount.toFixed(2),
      "Currency": "XLM",
      "Date": tx.date ? new Date(tx.date).toLocaleString() : "",
      "Loan Status": tx.loanStatus || "—",
      "Stellar Tx Hash": tx.txHash,
    };
  });

  return (
    <WorkspaceFrame
      roleLabel="Borrower Dashboard"
      heading="Transaction History"
      description="Every funding received and repayment made — with on-chain verification links."
      email={user.email ?? null}
      userName={String(
        user.fullName ?? profile?.full_name ?? ""
      )}
      metrics={presentBorrowerMetrics(metrics)}
      currentPath="/dashboard/borrower/history"
      links={borrowerNavLinks}
    >
      <div className="workspace-stack">
        {/* Summary cards */}
        <section
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))",
            gap: "1rem",
          }}
        >
          {[
            {
              label: "Total Received",
              value: formatCurrency(totalFunded),
              icon: "📥",
              color: "#7e2fd0",
            },
            {
              label: "Total Repaid",
              value: formatCurrency(totalRepaid),
              icon: "📤",
              color: "#22cf9d",
            },
            {
              label: "Transactions",
              value: String(initialTransactions.length),
              icon: "🔢",
              color: "#6b7280",
            },
          ].map((s) => (
            <article
              key={s.label}
              style={{
                padding: "1.1rem 1.25rem",
                borderRadius: "0.9rem",
                background: "#fff",
                border: "1px solid #eef0f8",
                boxShadow: "0 1px 4px rgba(0,0,0,0.04)",
              }}
            >
              <div style={{ fontSize: "1.5rem", marginBottom: "0.35rem" }}>
                {s.icon}
              </div>
              <p
                style={{
                  fontSize: "1.2rem",
                  fontWeight: 800,
                  color: s.color,
                  margin: "0 0 0.2rem",
                  fontFamily: "system-ui",
                }}
              >
                {s.value}
              </p>
              <p
                style={{
                  fontSize: "0.75rem",
                  color: "#9ca3af",
                  fontWeight: 600,
                  textTransform: "uppercase",
                  letterSpacing: "0.04em",
                  margin: 0,
                }}
              >
                {s.label}
              </p>
            </article>
          ))}
        </section>

        {/* Transaction feed with infinite scroll */}
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
              filename={`borrower_transactions_${new Date().toISOString().slice(0, 10)}.csv`}
            />
          </div>

          <BorrowerHistoryClient
            initialTransactions={initialTransactions}
            hasMore={loans.length >= 20}
            nextCursor={
              initialTransactions.length > 0
                ? initialTransactions[initialTransactions.length - 1].date
                : null
            }
          />
        </article>
      </div>
    </WorkspaceFrame>
  );
}