import { WorkspaceFrame } from "@/components/dashboard/WorkspaceFrame";
import { BorrowerRepayWidget } from "@/components/dashboard/BorrowerRepayWidget";
import { requireAuthenticatedUser } from "@/lib/auth/session";
import { getBorrowerDashboardMetrics, presentBorrowerMetrics } from "@/lib/dashboard/metrics";
import { borrowerNavLinks } from "@/lib/dashboard/borrower-links";
import { getDb } from "@/lib/db/client";
import { getBorrowerLoans, getProfile } from "@/lib/db/queries";
import { Badge } from "@/components/ui/Badge";
import { formatCurrency } from "@/lib/utils/formatting";
import { getFundingProgress } from "@/lib/loans/funding";

export default async function BorrowerRepayPage({
  searchParams,
}: {
  searchParams?: Promise<{ loanId?: string }> | { loanId?: string };
}) {
  const resolvedParams = searchParams ? await searchParams : {};
  const targetLoanId = resolvedParams?.loanId;

  const { user } = await requireAuthenticatedUser("borrower");
  const metrics  = await getBorrowerDashboardMetrics(user.id);

  const db = getDb();
  const [loans, profile] = await Promise.all([getBorrowerLoans(db, user.id, 20), getProfile(db, user.id)]);

  // A loan is only repayable once lenders have covered the full principal —
  // a partially filled request is not yet active (Issue #269).
  const normalizedLoans = loans.map((loan) => {
    const status = String(loan.status ?? "requested");
    const progress = getFundingProgress(loan.principal_amount, loan.funded_amount);
    const effectiveStatus =
      status === "requested" && progress.isFullyFunded ? "funded" : status;

    return { ...loan, status: effectiveStatus };
  });

  // Repayable = any loan that has been funded/disbursed (not yet repaid or defaulted)
  // Statuses: "funded" (just funded by lender), "active" (repayment in progress)
  const REPAYABLE_STATUSES = ["active", "funded", "approved"];
  const repayableLoans = normalizedLoans.filter((l) => REPAYABLE_STATUSES.includes(String(l.status)));
  const repayableLoan = targetLoanId
    ? repayableLoans.find((l) => String(l.id) === targetLoanId) ?? repayableLoans[0] ?? null
    : repayableLoans[0] ?? null;
  const pendingLoans = normalizedLoans.filter((l) => String(l.status) === "requested");
  const dueAmount = repayableLoan
    ? Math.max(0, Number(repayableLoan.principal_amount ?? 0) - Number(repayableLoan.repaid_amount ?? 0))
    : 0;

  return (
    <WorkspaceFrame
      roleLabel="Borrower Dashboard"
      heading="Repay Loan"
      description="Make an early repayment on your active loan to save on interest and boost your Trust Score."
      email={user.email ?? null}
      userName={String(user.fullName ?? profile?.full_name ?? "")}
      metrics={presentBorrowerMetrics(metrics)}
      currentPath="/dashboard/borrower/repay"
      links={borrowerNavLinks}
    >
      <div className="workspace-stack">
        {!repayableLoan ? (
          <article className="workspace-card workspace-card--full" style={{ textAlign: "center", padding: "2.5rem 1.5rem" }}>
            <div style={{ fontSize: "2rem", marginBottom: "0.75rem" }}>✅</div>
            <h2 className="workspace-card-title">No Active Loans</h2>
            <p className="workspace-card-copy" style={{ marginTop: "0.4rem" }}>
              {loans.some((l) => ["requested"].includes(String(l.status)))
                ? "Your loan request is pending lender funding. Repayment will be available once a lender funds it."
                : "You have no loans to repay. Apply for a new loan using the 'Apply for Loan' section."}
            </p>
            <a href="/dashboard/borrower/loans" style={{ display: "inline-block", marginTop: "1rem", padding: "0.6rem 1.5rem", background: "#7e2fd0", color: "#fff", borderRadius: "0.5rem", fontSize: "0.875rem", fontWeight: 700, textDecoration: "none" }}>
              Apply for a Loan →
            </a>
          </article>
        ) : (
          <>
            {/* Trust score incentive */}
            <article className="workspace-card workspace-card--full" style={{ background: "rgba(34,207,157,0.04)", borderColor: "rgba(34,207,157,0.2)" }}>
              <p style={{ fontSize: "0.875rem", color: "#20bd8e", fontWeight: 600, margin: 0 }}>
                💡 Each on-time repayment earns you <strong>+5 Trust Points</strong>. Early repayment earns <strong>+30 points</strong>, saves adjusted interest, and increases your credit limit.
              </p>
            </article>

            {/* Multiple active loans switcher */}
            {repayableLoans.length > 1 && (
              <article className="workspace-card workspace-card--full" style={{ padding: "1rem" }}>
                <h3 style={{ fontSize: "0.85rem", fontWeight: 700, color: "#4b5563", marginBottom: "0.6rem", textTransform: "uppercase", letterSpacing: "0.04em" }}>
                  Select Active Loan to Repay ({repayableLoans.length} active)
                </h3>
                <div style={{ display: "flex", gap: "0.6rem", flexWrap: "wrap" }}>
                  {repayableLoans.map((l) => {
                    const isSelected = String(l.id) === String(repayableLoan.id);
                    return (
                      <a
                        key={String(l.id)}
                        href={`/dashboard/borrower/repay?loanId=${l.id}`}
                        style={{
                          display: "inline-flex",
                          alignItems: "center",
                          gap: "0.4rem",
                          padding: "0.5rem 0.85rem",
                          borderRadius: "0.5rem",
                          textDecoration: "none",
                          fontSize: "0.82rem",
                          fontWeight: 700,
                          border: isSelected ? "2px solid #7e2fd0" : "1px solid #e5e7eb",
                          background: isSelected ? "rgba(126,47,208,0.08)" : "#fff",
                          color: isSelected ? "#7e2fd0" : "#4b5563",
                          transition: "all 0.15s ease",
                        }}
                      >
                        <span>Loan #{String(l.id).slice(0, 8)}</span>
                        <span style={{ fontWeight: 800 }}>{formatCurrency(Number(l.principal_amount))}</span>
                        {isSelected && <span style={{ color: "#7e2fd0" }}>✓</span>}
                      </a>
                    );
                  })}
                </div>
              </article>
            )}

            <BorrowerRepayWidget
              loan={{
                id: String(repayableLoan.id),
                principal_amount: Number(repayableLoan.principal_amount),
                repaid_amount: Number(repayableLoan.repaid_amount ?? 0),
                due_at: repayableLoan.due_at ? String(repayableLoan.due_at) : null,
                created_at: repayableLoan.created_at ? String(repayableLoan.created_at) : null,
                apr_bps: Number(repayableLoan.apr_bps ?? 1200),
                duration_days: Number(repayableLoan.duration_days ?? 30),
              }}
              dueAmount={dueAmount}
            />

            {/* All loans history */}
            {normalizedLoans.length > 1 && (
              <article className="workspace-card workspace-card--full">
                <h2 className="workspace-card-title" style={{ marginBottom: "1rem" }}>Loan History</h2>
                <div style={{ overflowX: "auto" }}>
                  <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.875rem" }}>
                    <thead>
                      <tr style={{ borderBottom: "1px solid #eef0f8" }}>
                        {["Loan ID", "Amount", "Status", "Repaid", "Due Date", "Action"].map((h) => (
                          <th key={h} style={{ textAlign: "left", padding: "0.6rem 0.75rem", fontSize: "0.72rem", fontWeight: 700, color: "#9ca3af", textTransform: "uppercase", letterSpacing: "0.05em" }}>{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {normalizedLoans.map((loan) => {
                        const isLoanRepayable = REPAYABLE_STATUSES.includes(String(loan.status));
                        return (
                          <tr key={String(loan.id)} style={{ borderBottom: "1px solid #f9fafb" }}>
                            <td style={{ padding: "0.75rem", fontFamily: "monospace", fontSize: "0.8rem", color: "#6b7280" }}>{String(loan.id).slice(0, 8)}</td>
                            <td style={{ padding: "0.75rem", fontWeight: 700 }}>{formatCurrency(Number(loan.principal_amount))}</td>
                            <td style={{ padding: "0.75rem" }}>
                              <Badge variant={
                                (loan.status === "active" || loan.status === "funded") ? "green"  :
                                loan.status === "repaid"    ? "gold"   :
                                loan.status === "requested" ? "yellow" : "blue"
                              }>
                                {String(loan.status).toUpperCase()}
                              </Badge>
                            </td>
                            <td style={{ padding: "0.75rem" }}>{formatCurrency(Number(loan.repaid_amount ?? 0))}</td>
                            <td style={{ padding: "0.75rem" }}>{loan.due_at ? new Date(String(loan.due_at)).toLocaleDateString() : "—"}</td>
                            <td style={{ padding: "0.75rem" }}>
                              {isLoanRepayable ? (
                                <a
                                  href={`/dashboard/borrower/repay?loanId=${loan.id}`}
                                  style={{
                                    display: "inline-flex",
                                    alignItems: "center",
                                    padding: "0.3rem 0.65rem",
                                    borderRadius: "0.4rem",
                                    background: String(loan.id) === String(repayableLoan.id) ? "rgba(126,47,208,0.12)" : "linear-gradient(135deg,#7e2fd0,#5a1fad)",
                                    color: String(loan.id) === String(repayableLoan.id) ? "#7e2fd0" : "#fff",
                                    fontSize: "0.75rem",
                                    fontWeight: 700,
                                    textDecoration: "none",
                                    border: String(loan.id) === String(repayableLoan.id) ? "1px solid rgba(126,47,208,0.3)" : "none",
                                  }}
                                >
                                  {String(loan.id) === String(repayableLoan.id) ? "Current Loan" : "⚡ Repay Early"}
                                </a>
                              ) : loan.status === "repaid" ? (
                                <span style={{ fontSize: "0.75rem", color: "#22cf9d", fontWeight: 700 }}>Settled ✅</span>
                              ) : (
                                <span style={{ fontSize: "0.75rem", color: "#9ca3af" }}>—</span>
                              )}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </article>
            )}
          </>
        )}

        {pendingLoans.length > 0 && (
          <article className="workspace-card workspace-card--full" style={{ borderColor: "rgba(245,166,35,0.25)", background: "rgba(245,166,35,0.04)" }}>
            <h2 className="workspace-card-title">Pending Loan Request{pendingLoans.length > 1 ? "s" : ""}</h2>
            <p className="workspace-card-copy" style={{ marginTop: "0.35rem" }}>
              You have {pendingLoans.length} submitted request{pendingLoans.length > 1 ? "s" : ""} waiting for funding.
            </p>
            <div style={{ display: "grid", gap: "0.75rem", marginTop: "1rem" }}>
              {pendingLoans.slice(0, 3).map((loan) => (
                <div
                  key={String(loan.id)}
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    gap: "1rem",
                    alignItems: "center",
                    padding: "0.85rem 1rem",
                    borderRadius: "0.7rem",
                    background: "rgba(255,255,255,0.75)",
                    border: "1px solid rgba(245,166,35,0.18)",
                    flexWrap: "wrap",
                  }}
                >
                  <div>
                    <p style={{ fontWeight: 700, margin: 0 }}>Loan #{String(loan.id).slice(0, 8)}</p>
                    <p style={{ fontSize: "0.8rem", color: "#6b7280", margin: "0.15rem 0 0" }}>
                      Requested {loan.created_at ? new Date(String(loan.created_at)).toLocaleDateString() : "recently"}
                    </p>
                  </div>
                  <div style={{ textAlign: "right" }}>
                    <p style={{ margin: 0, fontWeight: 800, color: "#7e2fd0" }}>{formatCurrency(Number(loan.principal_amount ?? 0))}</p>
                    <p style={{ fontSize: "0.75rem", color: "#f59e0b", fontWeight: 700, margin: "0.15rem 0 0" }}>REQUESTED</p>
                  </div>
                </div>
              ))}
            </div>
          </article>
        )}
      </div>
    </WorkspaceFrame>
  );
}
