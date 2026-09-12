import { WorkspaceFrame } from "@/components/dashboard/WorkspaceFrame";
import { ProfileSettingsForm } from "@/components/dashboard/ProfileSettingsForm";
import { KycVerificationWidget } from "@/components/dashboard/KycVerificationWidget";
import { BorrowerReputationCard } from "@/components/dashboard/BorrowerReputationCard";
import { requireAuthenticatedUser } from "@/lib/auth/session";
import {
  getBorrowerDashboardMetrics,
  presentBorrowerMetrics,
} from "@/lib/dashboard/metrics";
import { borrowerNavLinks } from "@/lib/dashboard/borrower-links";
import { eq } from "drizzle-orm";
import { getDb } from "@/lib/db/client";
import { getProfile, getReputationSnapshot } from "@/lib/db/queries";
import { loanToRow, repaymentToRow } from "@/lib/db/rows";
import { loanRepayments, loans as loansTable } from "@/lib/db/schema";
import { computeBorrowerReputationScore, BorrowerRepaymentStats } from "@/lib/reputation/scoring";


// Compliance status config
const KYC_CONFIG: Record<
  string,
  { label: string; color: string; bg: string; icon: string; description: string }
> = {
  pending: {
    label: "Pending Review",
    color: "var(--warning)",
    bg: "color-mix(in srgb, var(--warning) 8%, transparent)",
    icon: "⏳",
    description: "Submit your details and government ID to start the KYC review.",
  },
  submitted: {
    label: "Under Review",
    color: "var(--primary)",
    bg: "color-mix(in srgb, var(--primary) 8%, transparent)",
    icon: "🔍",
    description: "Your documents are being reviewed by our compliance team. Usually takes 1–2 business days.",
  },
  verified: {
    label: "Verified",
    color: "var(--accent-hover)",
    bg: "color-mix(in srgb, var(--accent) 8%, transparent)",
    icon: "✅",
    description: "Your identity is verified. You now have full access to lending pools.",
  },
  rejected: {
    label: "Action Required",
    color: "var(--danger)",
    bg: "color-mix(in srgb, var(--danger) 8%, transparent)",
    icon: "❌",
    description: "Your submission was rejected. Please re-upload a clear, valid government ID.",
  },
};

const RISK_CONFIG: Record<
  string,
  { label: string; color: string; bg: string; dot: string }
> = {
  low:     { label: "Low Risk",     color: "var(--accent-hover)", bg: "color-mix(in srgb, var(--accent) 10%, transparent)",    dot: "var(--accent)" },
  medium:  { label: "Medium Risk",  color: "var(--warning)", bg: "color-mix(in srgb, var(--warning) 10%, transparent)",     dot: "var(--warning)" },
  high:    { label: "High Risk",    color: "var(--danger)", bg: "color-mix(in srgb, var(--danger) 10%, transparent)",      dot: "var(--danger)" },
  blocked: { label: "Blocked",      color: "var(--fg-muted)", bg: "color-mix(in srgb, var(--fg-muted) 10%, transparent)",   dot: "var(--fg-subtle)" },
};

/**
 * Whole days between `createdAt` and now, or 0 when unknown.
 *
 * Kept outside the component so `react-hooks/purity` does not flag `Date.now()`:
 * this is an async server component that renders once per request, but the rule
 * cannot distinguish that from a client re-render.
 */
function daysSince(createdAt: unknown): number {
  if (!createdAt) return 0;
  const started = new Date(String(createdAt)).getTime();
  if (Number.isNaN(started)) return 0;
  return Math.floor((Date.now() - started) / (86400 * 1000));
}

export default async function BorrowerProfilePage() {
  const { user } = await requireAuthenticatedUser("borrower");
  const metrics = await getBorrowerDashboardMetrics(user.id);

  const db = getDb();
  const [profile, loanRows, repaymentRows, snapshot] = await Promise.all([
    getProfile(db, user.id),
    db ? db.select().from(loansTable).where(eq(loansTable.borrowerId, user.id)) : Promise.resolve([]),
    db ? db.select().from(loanRepayments).where(eq(loanRepayments.payerId, user.id)) : Promise.resolve([]),
    getReputationSnapshot(db, user.id),
  ]);

  const userLoans = loanRows.map(loanToRow);
  const userRepayments = repaymentRows.map(repaymentToRow);

  // Compute on-chain repayment history stats
  const completedLoans = userLoans.filter((l) => l.status === "repaid").length;
  const defaultedLoans = userLoans.filter((l) => l.status === "defaulted").length;

  let onTimeCount = 0;
  let earlyCount = 0;
  let lateCount = 0;

  for (const loan of userLoans) {
    if (loan.status === "repaid") {
      const dueTime = loan.due_at ? new Date(loan.due_at).getTime() : 0;
      const creationTime = loan.created_at ? new Date(loan.created_at).getTime() : 0;
      if (loan.metadata && typeof loan.metadata === "object" && (loan.metadata as Record<string, unknown>).is_early) {
        earlyCount++;
      } else if (dueTime > 0) {
        const loanPayments = userRepayments.filter((r) => r.loan_id === loan.id);
        const latestPayment = loanPayments.reduce(
          (latest, r) => Math.max(latest, new Date(r.paid_at).getTime()),
          creationTime
        );
        if (latestPayment <= dueTime) {
          onTimeCount++;
        } else {
          lateCount++;
        }
      } else {
        onTimeCount++;
      }
    }
  }

  const totalBorrowed = userLoans.reduce((sum, l) => sum + Number(l.principal_amount ?? 0), 0);
  const totalRepaid = userRepayments.reduce((sum, r) => sum + Number(r.amount ?? 0), 0);
  const accountAgeDays = daysSince(profile?.created_at);

  const stats: BorrowerRepaymentStats = {
    totalLoans: userLoans.length,
    completedLoans,
    onTimeRepayments: onTimeCount,
    earlyRepayments: earlyCount,
    lateRepayments: lateCount,
    defaultedLoans,
    totalBorrowedXlm: totalBorrowed,
    totalRepaidXlm: totalRepaid,
    kycVerified: profile?.kyc_status === "verified",
    emailVerified: Boolean(user.walletAddress),
    accountAgeDays,
  };

  const reputationResult = computeBorrowerReputationScore(stats);

  // Compute real profile completion based on actual data
  const checks = [
    { label: "Wallet verified",    done: Boolean(user.walletAddress) },
    { label: "Full name",          done: Boolean(profile?.full_name && String(profile.full_name).trim().length > 1) },
    { label: "Phone number",       done: Boolean(profile?.phone && String(profile.phone).trim().length > 4) },
    { label: "Date of birth",      done: Boolean(profile?.date_of_birth) },
    { label: "Government ID",      done: Boolean(profile?.government_id_url || profile?.kyc_submitted_at) },
  ];

  const completedCount = checks.filter((c) => c.done).length;
  const completionPct = Math.round((completedCount / checks.length) * 100);
  const missingItems = checks.filter((c) => !c.done).map((c) => c.label);

  const kycStatusKey = String(profile?.kyc_status ?? "pending") as keyof typeof KYC_CONFIG;
  const riskStatusKey = String(profile?.risk_status ?? "medium") as keyof typeof RISK_CONFIG;
  const kycInfo  = KYC_CONFIG[kycStatusKey]  ?? KYC_CONFIG.pending;
  const riskInfo = RISK_CONFIG[riskStatusKey] ?? RISK_CONFIG.medium;

  const profileIsComplete = completionPct === 100;
  const hasGovId = Boolean(profile?.government_id_url || profile?.kyc_submitted_at);

  return (
    <WorkspaceFrame
      roleLabel="Borrower Dashboard"
      heading="Profile Settings & Verification"
      description="Update your personal details and complete KYC milestones to unlock full platform features."
      email={user.email ?? null}
      userName={String(user.fullName ?? profile?.full_name ?? "")}
      metrics={presentBorrowerMetrics(metrics)}
      currentPath="/dashboard/borrower/profile"
      profilePath="/dashboard/borrower/profile"
      showProfileAlert={!profileIsComplete}
      profileSummary={{
        completion: completionPct,
        kycStatus: kycStatusKey,
        warningText: profileIsComplete
          ? "Your profile is complete. Keep your details up to date."
          : `Complete your profile to unlock borrowing. ${missingItems.length} item${missingItems.length !== 1 ? "s" : ""} remaining.`,
        requiredItems: missingItems,
      }}
      links={borrowerNavLinks}
    >
      <div className="workspace-stack" style={{ gap: "1.5rem" }}>
        {/* ── TOP: Borrower Reputation & Credit Score Card ── */}
        <BorrowerReputationCard
          reputation={reputationResult}
          updatedAt={snapshot?.updated_at}
        />

        <div className="workspace-grid workspace-grid--two">
        {/* ── LEFT: Identity Verification Form ── */}
        <article className="workspace-card">
          <div style={{ marginBottom: "1.25rem" }}>
            <h2 className="workspace-card-title">Identity Verification</h2>
            <p className="workspace-card-copy" style={{ marginTop: "0.35rem" }}>
              Provide accurate details to generate your on-chain KYC certificate.
              Required for all loan applications.
            </p>
          </div>

          {/* Completion progress bar */}
          <div
            style={{
              marginBottom: "1.5rem",
              padding: "0.9rem 1rem",
              borderRadius: "0.6rem",
              background: "linear-gradient(135deg, color-mix(in srgb, var(--primary) 4%, transparent) 0%, color-mix(in srgb, var(--accent) 4%, transparent) 100%)",
              border: "1px solid color-mix(in srgb, var(--primary) 10%, transparent)",
            }}
          >
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                marginBottom: "0.5rem",
              }}
            >
              <span style={{ fontSize: "0.8rem", fontWeight: 600, color: "var(--fg)" }}>
                Profile Completion
              </span>
              <span
                style={{
                  fontSize: "0.8rem",
                  fontWeight: 700,
                  color: completionPct === 100 ? "var(--accent-hover)" : "var(--primary)",
                }}
              >
                {completionPct}%
              </span>
            </div>
            <div
              style={{
                height: "6px",
                borderRadius: "3px",
                background: "var(--border)",
                overflow: "hidden",
              }}
            >
              <div
                style={{
                  height: "100%",
                  width: `${completionPct}%`,
                  background:
                    completionPct === 100
                      ? "linear-gradient(90deg, var(--accent-hover) 0%, var(--accent) 100%)"
                      : "linear-gradient(90deg, var(--primary) 0%, var(--accent) 100%)",
                  transition: "width 0.4s ease",
                  borderRadius: "3px",
                }}
              />
            </div>
            <div
              style={{
                display: "flex",
                flexWrap: "wrap",
                gap: "0.4rem",
                marginTop: "0.65rem",
              }}
            >
              {checks.map((c) => (
                <span
                  key={c.label}
                  style={{
                    fontSize: "0.72rem",
                    padding: "0.2rem 0.5rem",
                    borderRadius: "999px",
                    background: c.done
                      ? "color-mix(in srgb, var(--accent) 10%, transparent)"
                      : "color-mix(in srgb, var(--fg-muted) 8%, transparent)",
                    color: c.done ? "var(--accent-hover)" : "var(--fg-muted)",
                    fontWeight: 500,
                    display: "flex",
                    alignItems: "center",
                    gap: "0.25rem",
                  }}
                >
                  {c.done ? "✓" : "○"} {c.label}
                </span>
              ))}
            </div>
          </div>

          <ProfileSettingsForm
            initialName={String(profile?.full_name ?? "")}
            initialPhone={String(profile?.phone ?? "")}
            initialDob={profile?.date_of_birth ? String(profile.date_of_birth) : ""}
            kycStatus={kycStatusKey}
            hasGovId={hasGovId}
          />

          {/* ── KYC Verification Widget ── */}
          <div style={{ marginTop: "1.5rem", paddingTop: "1.5rem", borderTop: "1px solid color-mix(in srgb, var(--primary) 10%, transparent)" }}>
            <h3
              style={{
                fontSize: "0.85rem",
                fontWeight: 700,
                color: "var(--fg)",
                marginBottom: "0.75rem",
                textTransform: "uppercase",
                letterSpacing: "0.04em",
              }}
            >
              🔐 3rd-Party KYC Verification
            </h3>
            <KycVerificationWidget
              kycStatus={kycStatusKey}
              kycProviderId={profile?.kyc_provider_id ? String(profile.kyc_provider_id) : null}
            />
          </div>
        </article>

        {/* ── RIGHT: Compliance + Security ── */}
        <div className="workspace-stack">
          {/* Compliance State */}
          <article className="workspace-card">
            <h2 className="workspace-card-title" style={{ marginBottom: "1rem" }}>
              Compliance Status
            </h2>

            {/* KYC Status Badge */}
            <div
              style={{
                display: "flex",
                alignItems: "flex-start",
                gap: "0.85rem",
                padding: "1rem",
                borderRadius: "0.75rem",
                background: kycInfo.bg,
                border: `1px solid color-mix(in srgb, ${kycInfo.color} 19%, transparent)`,
              }}
            >
              <span style={{ fontSize: "1.4rem", lineHeight: 1 }}>{kycInfo.icon}</span>
              <div style={{ flex: 1 }}>
                <p
                  style={{
                    fontSize: "0.8rem",
                    fontWeight: 700,
                    textTransform: "uppercase",
                    letterSpacing: "0.06em",
                    color: kycInfo.color,
                    marginBottom: "0.2rem",
                  }}
                >
                  KYC · {kycInfo.label}
                </p>
                <p style={{ fontSize: "0.82rem", color: "var(--fg)", lineHeight: 1.5 }}>
                  {kycInfo.description}
                </p>
                {profile?.kyc_submitted_at && (
                  <p style={{ fontSize: "0.75rem", color: "var(--fg-subtle)", marginTop: "0.35rem" }}>
                    Submitted:{" "}
                    {new Date(String(profile.kyc_submitted_at)).toLocaleDateString("en-US", {
                      month: "short",
                      day: "numeric",
                      year: "numeric",
                    })}
                  </p>
                )}
              </div>
            </div>

            <div style={{ marginTop: "1rem", padding: "0.85rem", borderRadius: "0.5rem", background: "color-mix(in srgb, var(--primary) 4%, transparent)", border: "1px dashed color-mix(in srgb, var(--primary) 30%, transparent)", marginBottom: "1rem" }}>
              <p style={{ fontSize: "0.75rem", fontWeight: 700, color: "var(--primary)", textTransform: "uppercase", marginBottom: "0.2rem" }}>🚀 Upcoming Security Feature</p>
              <p style={{ fontSize: "0.78rem", color: "var(--fg-muted)", lineHeight: 1.5 }}>
                <strong>Live Facial Recognition</strong> is coming soon. Once deployed, biometric hashes will strictly enforce a &quot;one person, one account&quot; rule to dramatically harden network security and prevent identity fraud.
              </p>
            </div>

            {/* Risk Profile */}
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: "0.75rem",
                padding: "0.85rem 1rem",
                borderRadius: "0.75rem",
                background: riskInfo.bg,
                border: `1px solid color-mix(in srgb, ${riskInfo.dot} 19%, transparent)`,
                marginBottom: "1rem",
              }}
            >
              <span
                style={{
                  width: "10px",
                  height: "10px",
                  borderRadius: "50%",
                  background: riskInfo.dot,
                  flexShrink: 0,
                  boxShadow: `0 0 0 3px color-mix(in srgb, ${riskInfo.dot} 19%, transparent)`,
                }}
              />
              <div>
                <p
                  style={{
                    fontSize: "0.8rem",
                    fontWeight: 700,
                    color: riskInfo.color,
                    margin: 0,
                  }}
                >
                  Risk Profile · {riskInfo.label}
                </p>
                <p style={{ fontSize: "0.78rem", color: "var(--fg-muted)", marginTop: "0.2rem" }}>
                  {riskStatusKey === "low"
                    ? "Excellent standing. You qualify for higher loan tiers."
                    : riskStatusKey === "medium"
                    ? "Complete KYC verification to lower your risk profile."
                    : riskStatusKey === "high"
                    ? "High risk flag detected. Review your account history."
                    : "Account access is currently restricted. Contact support."}
                </p>
              </div>
            </div>

            {/* Reputation note */}
            <p
              style={{
                fontSize: "0.78rem",
                color: "var(--fg-subtle)",
                lineHeight: 1.6,
                padding: "0.75rem",
                borderRadius: "0.5rem",
                background: "color-mix(in srgb, var(--primary) 3%, transparent)",
                border: "1px solid color-mix(in srgb, var(--primary) 8%, transparent)",
              }}
            >
              🔗 Your profile data is anchored to an on-chain reputation score on the
              Stellar testnet. Only verified users can access active lending pools.
            </p>
          </article>

          {/* Account Security */}
          <article className="workspace-card">
            <h2 className="workspace-card-title" style={{ marginBottom: "1rem" }}>
              Account Security
            </h2>

            <ul className="workspace-list workspace-list--compact">
              <li>
                <span>Email Address</span>
                <strong style={{ fontSize: "0.85rem", wordBreak: "break-all" }}>
                  {user.email ?? "Unknown"}
                </strong>
              </li>
              <li>
                <span>Role</span>
                <span
                  style={{
                    fontSize: "0.75rem",
                    background: "color-mix(in srgb, var(--primary) 8%, transparent)",
                    color: "var(--primary)",
                    padding: "0.2rem 0.6rem",
                    borderRadius: "999px",
                    fontWeight: 600,
                    textTransform: "capitalize",
                  }}
                >
                  {String(profile?.role ?? "borrower")}
                </span>
              </li>
              <li>
                <span>Wallet Verified</span>
                <span
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: "0.4rem",
                    fontSize: "0.8rem",
                    color: user.walletAddress ? "var(--accent-hover)" : "var(--warning)",
                    fontWeight: 600,
                  }}
                >
                  <span
                    style={{
                      width: "7px",
                      height: "7px",
                      borderRadius: "50%",
                      background: user.walletAddress ? "var(--accent)" : "var(--warning)",
                      display: "inline-block",
                    }}
                  />
                  {user.walletAddress ? "Verified" : "Not verified"}
                </span>
              </li>
              <li>
                <span>Member Since</span>
                <strong style={{ fontSize: "0.82rem" }}>
                  {user.createdAt
                    ? new Date(user.createdAt).toLocaleDateString("en-US", {
                        month: "long",
                        year: "numeric",
                      })
                    : "—"}
                </strong>
              </li>
            </ul>

            <div className="workspace-inline-actions" style={{ marginTop: "1rem" }}>
              <button type="button" className="workspace-nav-link">
                Change Password
              </button>
            </div>
          </article>
        </div>
        </div>
      </div>
    </WorkspaceFrame>
  );
}
