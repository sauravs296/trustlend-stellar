import { WorkspaceFrame } from "@/components/dashboard/WorkspaceFrame";
import { TasksBoard } from "@/components/dashboard/TasksBoard";
import { requireAuthenticatedUser } from "@/lib/auth/session";
import { getBorrowerDashboardMetrics, presentBorrowerMetrics } from "@/lib/dashboard/metrics";
import { borrowerNavLinks } from "@/lib/dashboard/borrower-links";
import { and, eq } from "drizzle-orm";
import { getDb } from "@/lib/db/client";
import { getProfile } from "@/lib/db/queries";
import { reputationEvents } from "@/lib/db/schema";
import { getPlatformTasks } from "@/app/api/tasks/complete/route";

export default async function BorrowerTasksPage() {
  const { user } = await requireAuthenticatedUser("borrower");
  const metrics = await getBorrowerDashboardMetrics(user.id);
  const db = getDb();

  const [profile, completedEvents] = await Promise.all([
    getProfile(db, user.id),
    // Which tasks has this user already completed?
    db
      ? db
          .select({ source_key: reputationEvents.sourceKey, source_id: reputationEvents.sourceId })
          .from(reputationEvents)
          .where(and(eq(reputationEvents.userId, user.id), eq(reputationEvents.sourceType, "task_completion")))
      : Promise.resolve([]),
  ]);

  const completedTaskIds = new Set(
    completedEvents.map((e) => String(e.source_key ?? e.source_id ?? ""))
  );
  const currentScore     = metrics.reputationScore;

  // Merge completion status into the canonical task list
  const platformTasks = getPlatformTasks().map((t) => ({
    ...t,
    learnUrl:  t.learnUrl ?? null,
    completed: completedTaskIds.has(t.id),
  }));

  return (
    <WorkspaceFrame
      roleLabel="Borrower Dashboard"
      heading="Trust Tasks"
      description="Complete these tasks to build your trust score. Higher score = better loan terms and higher limits."
      email={user.email ?? null}
      userName={String(user.fullName ?? profile?.full_name ?? "")}
      metrics={presentBorrowerMetrics(metrics)}
      currentPath="/dashboard/borrower/tasks"
      links={borrowerNavLinks}
    >
      <div className="workspace-stack">
        {/* How the score works */}
        <article
          className="workspace-card workspace-card--full"
          style={{ background: "color-mix(in srgb, var(--primary) 5%, transparent)", border: "1px solid color-mix(in srgb, var(--primary) 15%, transparent)" }}
        >
          <h2 className="workspace-card-title">How Your Trust Score Works</h2>
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))",
              gap: "1rem",
              marginTop: "0.75rem",
            }}
          >
            {[
              { icon: "🪪", event: "KYC Verified",       pts: "+50–110",  note: "One-time, on admin approval" },
              { icon: "📘", event: "Task Completed",     pts: "+25–35",   note: "Up to 90 pts from all tasks" },
              { icon: "💸", event: "Loan Repaid",        pts: "+20",      note: "Per full repayment" },
              { icon: "⚡", event: "Partial Repayment",  pts: "+5",       note: "Per payment made" },
            ].map((row) => (
              <div
                key={row.event}
                style={{
                  display: "flex", gap: "0.65rem", alignItems: "flex-start",
                  padding: "0.75rem", borderRadius: "0.6rem",
                  background: "color-mix(in srgb, var(--fg) 3%, transparent)",
                }}
              >
                <span style={{ fontSize: "1.4rem" }}>{row.icon}</span>
                <div>
                  <p style={{ fontWeight: 600, fontSize: "0.86rem", marginBottom: "0.2rem" }}>{row.event}</p>
                  <p style={{ fontSize: "0.82rem", color: "var(--accent)", fontWeight: 700 }}>{row.pts} pts</p>
                  <p style={{ fontSize: "0.75rem", opacity: 0.5 }}>{row.note}</p>
                </div>
              </div>
            ))}
          </div>
        </article>

        {/* Interactive tasks board */}
        <TasksBoard tasks={platformTasks} currentScore={currentScore} />
      </div>
    </WorkspaceFrame>
  );
}
