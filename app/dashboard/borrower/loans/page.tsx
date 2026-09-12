import { WorkspaceFrame } from "@/components/dashboard/WorkspaceFrame";
import { BorrowerForms } from "@/components/dashboard/BorrowerForms";
import { requireAuthenticatedUser } from "@/lib/auth/session";
import { getBorrowerDashboardMetrics, presentBorrowerMetrics } from "@/lib/dashboard/metrics";
import { borrowerNavLinks } from "@/lib/dashboard/borrower-links";
import { getDb } from "@/lib/db/client";
import { getBorrowerLoans, getProfile } from "@/lib/db/queries";
import { getFundingProgress } from "@/lib/loans/funding";

export default async function BorrowerLoansPage() {
  const { user } = await requireAuthenticatedUser("borrower");
  const metrics  = await getBorrowerDashboardMetrics(user.id);

  const db = getDb();
  const [loans, profile] = await Promise.all([getBorrowerLoans(db, user.id, 20), getProfile(db, user.id)]);

  // Funding progress drives the status shown to the borrower (Issue #269).
  // A request is only "funded" once contributions cover the full principal —
  // a partially filled loan stays "requested" and is NOT repayable yet.
  const normalizedLoans = loans.map((loan) => {
    const status = String(loan.status ?? "requested");
    const progress = getFundingProgress(loan.principal_amount, loan.funded_amount);
    const effectiveStatus =
      status === "requested" && progress.isFullyFunded ? "funded" : status;

    return { ...loan, status: effectiveStatus, funded_amount: progress.funded };
  });

  const isKycVerified = profile?.kyc_status === "verified";
  const canApplyLoan  = isKycVerified;
  const maxLoanAmount = canApplyLoan ? metrics.availableCredit : 0;

  const REPAYABLE_STATUSES = ["active", "funded", "approved"];
  const activeLoans = normalizedLoans.filter((l) => REPAYABLE_STATUSES.includes(String(l.status)));
  const repayableLoan = activeLoans[0] ?? null;
  const dueAmount = repayableLoan
    ? Math.max(0, Number(repayableLoan.principal_amount ?? 0) - Number(repayableLoan.repaid_amount ?? 0))
    : 0;

  return (
    <WorkspaceFrame
      roleLabel="Borrower Dashboard"
      heading="Apply for a Loan"
      description="Submit a new loan request or make a repayment on your active loan."
      email={user.email ?? null}
      userName={String(user.fullName ?? profile?.full_name ?? "")}
      metrics={presentBorrowerMetrics(metrics)}
      currentPath="/dashboard/borrower/loans"
      links={borrowerNavLinks}
    >
      <div className="workspace-stack">
        {!canApplyLoan && (
          <article className="workspace-card workspace-card--full" style={{ background: "rgba(245,166,35,0.04)", borderColor: "rgba(245,166,35,0.25)" }}>
            <h2 className="workspace-card-title">⚠️ KYC Required</h2>
            <p className="workspace-card-copy" style={{ marginTop: "0.4rem" }}>
              Your KYC status is currently <strong>{profile?.kyc_status ?? "pending"}</strong>.{" "}
              {profile?.kyc_status === "submitted"
                ? "Your documents are under admin review. You'll be notified once approved."
                : "Please complete your profile and submit government ID to apply for loans."}
            </p>
            <a href="/dashboard/borrower/profile" style={{ display: "inline-block", marginTop: "0.75rem", fontSize: "0.82rem", color: "#7e2fd0", fontWeight: 600 }}>
              Go to Profile →
            </a>
          </article>
        )}

        <BorrowerForms
          canApplyLoan={canApplyLoan}
          maxLoanAmount={maxLoanAmount}
          loans={normalizedLoans as unknown as { id: string; status: string; due_at: string | null; principal_amount: number; funded_amount?: number; repaid_amount: number; apr_bps?: number; duration_days?: number; created_at?: string | null; }[]}
          selectedRepaymentLoan={repayableLoan as unknown as { id: string; status: string; due_at: string | null; principal_amount: number; repaid_amount: number } | null}
          dueAmount={dueAmount}
        />
      </div>
    </WorkspaceFrame>
  );
}
