import { WorkspaceFrame } from "@/components/dashboard/WorkspaceFrame";
import { WalletCard } from "@/components/dashboard/WalletCard";
import { adminNavLinks } from "@/lib/dashboard/admin-links";
import { requireTradeVaultAdmin } from "@/lib/auth/session";
import {
  getAdminDashboardMetrics,
  presentAdminMetrics,
} from "@/lib/dashboard/metrics";
import { desc, eq } from "drizzle-orm";
import { getDb } from "@/lib/db/client";
import { loanToRow, repaymentToRow } from "@/lib/db/rows";
import { ledgerTransactions, loanRepayments, loans as loansTable } from "@/lib/db/schema";
import { buildStellarTxVerificationUrl, extractPossibleTxHash, isLikelyTxHash } from "@/lib/stellar/explorer";
import { formatCurrency } from "@/lib/utils/formatting";

export default async function AdminLoansPage() {
  const { user } = await requireTradeVaultAdmin();
  const metrics = await getAdminDashboardMetrics();
  const walletAddress = String(user.walletAddress ?? "") || null;
  const walletConnected = Boolean(walletAddress);

  const db = getDb();
  const [loanRows, repaymentRows, ledgerRepays] = db
    ? await Promise.all([
        db.select().from(loansTable).orderBy(desc(loansTable.requestedAt)).limit(40),
        db.select().from(loanRepayments).orderBy(desc(loanRepayments.paidAt)).limit(40),
        db
          .select({ ref_id: ledgerTransactions.refId, metadata: ledgerTransactions.metadata })
          .from(ledgerTransactions)
          .where(eq(ledgerTransactions.refType, "loan_repay")),
      ])
    : [[], [], []];

  const loans = loanRows.map(loanToRow);
  const repayments = repaymentRows.map(repaymentToRow);
  const oldHashesMap: Record<string, string> = {};

  for (const r of ledgerRepays) {
    const extracted = extractPossibleTxHash(r.metadata);
    if (extracted) {
      oldHashesMap[String(r.ref_id)] = extracted;
    }
  }
  const sanctionedAmount = loans
    .filter((loan) => ["approved", "funded", "active", "repaid", "defaulted"].includes(String(loan.status)))
    .reduce((sum, loan) => sum + Number(loan.principal_amount ?? 0), 0);
  const paidAmount = repayments.reduce((sum, row) => sum + Number(row.amount ?? 0), 0);

  return (
    <WorkspaceFrame
      roleLabel="Trade Vault Admin"
      heading="Loan Operations"
      description="Monitor loan lifecycle, exposure, and maturity timelines across the platform."
      email={user.email ?? null}
      userName={String(user.fullName ?? "Admin")}
      metrics={presentAdminMetrics(metrics)}
      links={[...adminNavLinks]}
      currentPath="/dashboard/admin/loans"
      showProfileAlert={false}
      headerWidget={(
        <WalletCard
          address={walletAddress}
          available={0}
          inLoansOrPools={sanctionedAmount}
          pending={paidAmount}
          inLoansLabel="Sanctioned"
          compact
        />
      )}
    >
      <div className="workspace-stack">
        {!walletConnected ? (
          <article className="workspace-card workspace-card--full">
            <h2 className="workspace-card-title">Wallet connection required</h2>
            <p className="workspace-card-copy">Connect wallet first to unlock loan operations data.</p>
          </article>
        ) : (
          <>
            <div className="workspace-table-wrap">
              <table className="workspace-table">
                <thead>
                  <tr>
                    <th>Loan ID</th>
                    <th>Borrower</th>
                    <th>Principal</th>
                    <th>Status</th>
                    <th>Target APR</th>
                    <th>Due At</th>
                  </tr>
                </thead>
                <tbody>
                  {loans.length === 0 ? (
                    <tr><td colSpan={6} style={{ textAlign: "center", padding: "1.5rem", opacity: 0.5 }}>No loans found.</td></tr>
                  ) : loans.map((l) => (
                    <tr key={String(l.id)}>
                      <td style={{ fontFamily: "monospace", fontSize: "0.8rem" }}>{String(l.id).slice(0,8)}</td>
                      <td style={{ fontFamily: "monospace", fontSize: "0.8rem" }}>{String(l.borrower_id).slice(0,8)}...</td>
                      <td><strong>{formatCurrency(Number(l.principal_amount ?? 0))}</strong></td>
                      <td>
                        <span style={{ padding: "0.15rem 0.5rem", borderRadius: "999px", fontSize: "0.75rem", fontWeight: 600, background: l.status === "repaid" ? "color-mix(in srgb, var(--primary) 12%, transparent)" : "color-mix(in srgb, var(--accent) 12%, transparent)", color: l.status === "repaid" ? "var(--primary-muted)" : "var(--accent)" }}>
                          {String(l.status).toUpperCase()}
                        </span>
                      </td>
                      <td style={{ color: "var(--accent)", fontWeight: "bold" }}>{(Number(l.apr_bps ?? 0) / 100).toFixed(2)}%</td>
                      <td>{l.due_at ? new Date(String(l.due_at)).toLocaleDateString() : "-"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <section className="workspace-card workspace-card--full">
              <h2 className="workspace-card-title">Repayment verification links</h2>
              <div className="workspace-table-wrap">
                <table className="workspace-table" aria-label="Repayment verification table">
                  <thead>
                    <tr>
                      <th>Loan</th>
                      <th>Payer</th>
                      <th>Amount</th>
                      <th>Paid</th>
                      <th>Verify</th>
                    </tr>
                  </thead>
                  <tbody>
                    {repayments.length === 0 ? (
                      <tr>
                        <td colSpan={5} className="workspace-empty-row">No repayments found.</td>
                      </tr>
                    ) : (
                      repayments.map((payment) => {
                        let txHash = extractPossibleTxHash(payment.tx_ref) ?? "";
                        if (!txHash || txHash.trim().length < 5) {
                           txHash = oldHashesMap[String(payment.id)] ?? "";
                        }
                        return (
                          <tr key={String(payment.id)}>
                            <td>{String(payment.loan_id).slice(0, 8)}</td>
                            <td>{String(payment.payer_id).slice(0, 8)}</td>
                            <td>{formatCurrency(Number(payment.amount ?? 0))}</td>
                            <td>{payment.paid_at ? new Date(String(payment.paid_at)).toLocaleString() : "-"}</td>
                            <td>
                              {isLikelyTxHash(txHash) ? (
                                <a
                                  href={buildStellarTxVerificationUrl(txHash)}
                                  target="_blank"
                                  rel="noreferrer"
                                  style={{
                                    display: "inline-flex",
                                    alignItems: "center",
                                    gap: "0.35rem",
                                    padding: "0.35rem 0.75rem",
                                    borderRadius: "999px",
                                    border: "1px solid color-mix(in srgb, var(--accent) 35%, transparent)",
                                    background: "color-mix(in srgb, var(--accent) 14%, transparent)",
                                    color: "var(--success-soft-fg)",
                                    fontSize: "0.8rem",
                                    fontWeight: 700,
                                    textDecoration: "none",
                                  }}
                                >
                                  <span aria-hidden="true">✔</span>
                                  Verify
                                </a>
                              ) : (
                                <span
                                  aria-disabled="true"
                                  title="Transaction hash not available yet for this repayment"
                                  style={{
                                    display: "inline-flex",
                                    alignItems: "center",
                                    gap: "0.35rem",
                                    padding: "0.35rem 0.75rem",
                                    borderRadius: "999px",
                                    border: "1px solid color-mix(in srgb, var(--accent) 25%, transparent)",
                                    background: "color-mix(in srgb, var(--accent) 8%, transparent)",
                                    color: "var(--accent)",
                                    fontSize: "0.8rem",
                                    fontWeight: 700,
                                    opacity: 0.65,
                                    cursor: "not-allowed",
                                  }}
                                >
                                  <span aria-hidden="true">✔</span>
                                  Pending
                                </span>
                              )}
                            </td>
                          </tr>
                        );
                      })
                    )}
                  </tbody>
                </table>
              </div>
            </section>
          </>
        )}
      </div>
    </WorkspaceFrame>
  );
}
