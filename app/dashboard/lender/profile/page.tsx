import { WorkspaceFrame } from "@/components/dashboard/WorkspaceFrame";
import { ProfileSettingsForm } from "@/components/dashboard/ProfileSettingsForm";
import { KycVerificationWidget } from "@/components/dashboard/KycVerificationWidget";
import { requireAuthenticatedUser } from "@/lib/auth/session";
import {
  getLenderDashboardMetrics,
  presentLenderMetrics,
} from "@/lib/dashboard/metrics";
import { lenderNavLinks } from "@/lib/dashboard/lender-links";
import { getDb } from "@/lib/db/client";
import { getProfile } from "@/lib/db/queries";

const KYC_CONFIG: Record<
  string,
  { label: string; color: string; bg: string; icon: string; description: string }
> = {
  pending:   { label: "Pending",       color: "var(--warning)", bg: "color-mix(in srgb, var(--warning) 8%, transparent)",     icon: "⏳", description: "Submit your details to begin lender compliance review." },
  submitted: { label: "Under Review",  color: "var(--primary)", bg: "color-mix(in srgb, var(--primary) 8%, transparent)",    icon: "🔍", description: "Documents under review. Usually takes 1–2 business days." },
  verified:  { label: "Verified",      color: "var(--accent-hover)", bg: "color-mix(in srgb, var(--accent) 8%, transparent)",    icon: "✅", description: "Fully verified. You can create and manage lending pools." },
  rejected:  { label: "Action Needed", color: "var(--danger)", bg: "color-mix(in srgb, var(--danger) 8%, transparent)",     icon: "❌", description: "Submission rejected. Re-upload a clear government ID." },
};

export default async function LenderProfilePage() {
  const { user } = await requireAuthenticatedUser("lender");
  const metrics = await getLenderDashboardMetrics(user.id);

  const profile = await getProfile(getDb(), user.id);

  const kycStatusKey = String(profile?.kyc_status ?? "pending") as keyof typeof KYC_CONFIG;
  const kycInfo = KYC_CONFIG[kycStatusKey] ?? KYC_CONFIG.pending;
  const hasGovId = Boolean(profile?.government_id_url || profile?.kyc_submitted_at);

  return (
    <WorkspaceFrame
      roleLabel="Lender Dashboard"
      heading="Profile Settings & Security"
      description="Update your personal details and complete required compliance checks to manage lending pools."
      email={user.email ?? null}
      userName={String(user.fullName ?? profile?.full_name ?? "")}
      metrics={presentLenderMetrics(metrics)}
      currentPath="/dashboard/lender/profile"
      links={lenderNavLinks}
    >
      <div className="workspace-grid workspace-grid--two">
        <article className="workspace-card">
          <h2 className="workspace-card-title">Identity Verification</h2>
          <p className="workspace-card-copy" style={{ marginTop: "0.35rem", marginBottom: "1rem" }}>
            Provide accurate details to generate your on-chain KYC certificate for lender compliance.
          </p>
          <ProfileSettingsForm
            initialName={String(profile?.full_name ?? "")}
            initialPhone={String(profile?.phone ?? "")}
            initialDob={profile?.date_of_birth ? String(profile.date_of_birth) : ""}
            kycStatus={kycStatusKey}
            hasGovId={hasGovId}
          />

          {/* ── KYC Verification Widget (SumSub) ── */}
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

        <div className="workspace-stack">
          {/* Compliance State */}
          <article className="workspace-card">
            <h2 className="workspace-card-title" style={{ marginBottom: "1rem" }}>
              Compliance Status
            </h2>
            <div
              style={{
                display: "flex",
                alignItems: "flex-start",
                gap: "0.85rem",
                padding: "1rem",
                borderRadius: "0.75rem",
                background: kycInfo.bg,
                border: `1px solid color-mix(in srgb, ${kycInfo.color} 19%, transparent)`,
                marginBottom: "1rem",
              }}
            >
              <span style={{ fontSize: "1.4rem", lineHeight: 1 }}>{kycInfo.icon}</span>
              <div>
                <p style={{ fontSize: "0.8rem", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.06em", color: kycInfo.color, marginBottom: "0.2rem" }}>
                  KYC · {kycInfo.label}
                </p>
                <p style={{ fontSize: "0.82rem", color: "var(--fg)", lineHeight: 1.5 }}>
                  {kycInfo.description}
                </p>
                {profile?.kyc_submitted_at && (
                  <p style={{ fontSize: "0.75rem", color: "var(--fg-subtle)", marginTop: "0.35rem" }}>
                    Submitted: {new Date(String(profile.kyc_submitted_at)).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}
                  </p>
                )}
              </div>
            </div>
            
            <div style={{ padding: "0.85rem", borderRadius: "0.5rem", background: "color-mix(in srgb, var(--primary) 4%, transparent)", border: "1px dashed color-mix(in srgb, var(--primary) 30%, transparent)", marginBottom: "1rem" }}>
              <p style={{ fontSize: "0.75rem", fontWeight: 700, color: "var(--primary)", textTransform: "uppercase", marginBottom: "0.2rem" }}>🚀 Upcoming Security Feature</p>
              <p style={{ fontSize: "0.78rem", color: "var(--fg-muted)", lineHeight: 1.5 }}>
                <strong>Live Facial Recognition</strong> is coming soon. Once deployed, biometric hashes will strictly enforce a &quot;one person, one account&quot; rule to dramatically harden network security and prevent identity fraud.
              </p>
            </div>

            <p style={{ fontSize: "0.78rem", color: "var(--fg-subtle)", lineHeight: 1.6, padding: "0.75rem", borderRadius: "0.5rem", background: "color-mix(in srgb, var(--accent) 3%, transparent)", border: "1px solid color-mix(in srgb, var(--accent) 10%, transparent)" }}>
              🔗 Lender reputation is anchored on the Stellar testnet. Verified lenders unlock higher pool deposit limits.
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
                <strong style={{ fontSize: "0.85rem", wordBreak: "break-all" }}>{user.email ?? "Unknown"}</strong>
              </li>
              <li>
                <span>Role</span>
                <span style={{ fontSize: "0.75rem", background: "color-mix(in srgb, var(--accent) 8%, transparent)", color: "var(--accent-hover)", padding: "0.2rem 0.6rem", borderRadius: "999px", fontWeight: 600, textTransform: "capitalize" }}>
                  {String(profile?.role ?? "lender")}
                </span>
              </li>
              <li>
                <span>Wallet Verified</span>
                <span style={{ display: "flex", alignItems: "center", gap: "0.4rem", fontSize: "0.8rem", color: user.walletAddress ? "var(--accent-hover)" : "var(--warning)", fontWeight: 600 }}>
                  <span style={{ width: "7px", height: "7px", borderRadius: "50%", background: user.walletAddress ? "var(--accent)" : "var(--warning)", display: "inline-block" }} />
                  {user.walletAddress ? "Verified" : "Not verified"}
                </span>
              </li>
              <li>
                <span>Member Since</span>
                <strong style={{ fontSize: "0.82rem" }}>
                  {user.createdAt ? new Date(user.createdAt).toLocaleDateString("en-US", { month: "long", year: "numeric" }) : "—"}
                </strong>
              </li>
            </ul>
            <div className="workspace-inline-actions" style={{ marginTop: "1rem" }}>
              <button type="button" className="workspace-nav-link">Change Password</button>
            </div>
          </article>
        </div>
      </div>
    </WorkspaceFrame>
  );
}
