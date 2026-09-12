import { WorkspaceFrame } from "@/components/dashboard/WorkspaceFrame";
import { requireAuthenticatedUser } from "@/lib/auth/session";
import {
  getLenderDashboardMetrics,
  presentLenderMetrics,
} from "@/lib/dashboard/metrics";
import { lenderNavLinks } from "@/lib/dashboard/lender-links";
import { asc } from "drizzle-orm";
import { getDb } from "@/lib/db/client";
import { getProfile } from "@/lib/db/queries";
import { loanToRow } from "@/lib/db/rows";
import { loans as loansTable } from "@/lib/db/schema";

export default async function LenderRiskPage() {
  const { user } = await requireAuthenticatedUser("lender");
  const metrics = await getLenderDashboardMetrics(user.id);

  const db = getDb();
  const [loanRows, profile] = await Promise.all([
    db ? db.select().from(loansTable).orderBy(asc(loansTable.dueAt)).limit(12) : Promise.resolve([]),
    getProfile(db, user.id),
  ]);
  const loans = loanRows.map(loanToRow);

  return (
    <WorkspaceFrame
      roleLabel="Lender Dashboard"
      heading="Risk Monitor"
      description="Monitor loan maturity and defaults to keep portfolio risk within target bounds."
      email={user.email ?? null}
      userName={String(user.fullName ?? profile?.full_name ?? "")}
      metrics={presentLenderMetrics(metrics)}
      currentPath="/dashboard/lender/risk"
      links={lenderNavLinks}
    >
      <div className="workspace-table-wrap">
        <table className="workspace-table" aria-label="Risk monitor loans table">
          <thead>
            <tr>
              <th>Loan</th>
              <th>Status</th>
              <th>Principal</th>
              <th>Due date</th>
            </tr>
          </thead>
          <tbody>
            {(loans ?? []).length === 0 ? (
              <tr>
                <td colSpan={4} className="workspace-empty-row">No loan risk data available yet.</td>
              </tr>
            ) : (
              (loans ?? []).map((loan) => (
                <tr key={String(loan.id)}>
                  <td>{String(loan.id).slice(0, 8)}</td>
                  <td>{String(loan.status)}</td>
                  <td>{Number(loan.principal_amount ?? 0).toFixed(2)}</td>
                  <td>{loan.due_at ? new Date(String(loan.due_at)).toLocaleDateString() : "-"}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </WorkspaceFrame>
  );
}
