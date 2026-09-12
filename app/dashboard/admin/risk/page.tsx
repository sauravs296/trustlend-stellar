import { WorkspaceFrame } from "@/components/dashboard/WorkspaceFrame";
import { adminNavLinks } from "@/lib/dashboard/admin-links";
import { requireTradeVaultAdmin } from "@/lib/auth/session";
import {
  getAdminDashboardMetrics,
  presentAdminMetrics,
} from "@/lib/dashboard/metrics";
import {
  DEFAULT_ASSET_RISK_CONFIGS,
  DEFAULT_INTEREST_RATE_CURVES,
  DEFAULT_PROTOCOL_FEES,
  INITIAL_RISK_AUDIT_LOG,
  RiskParametersState,
} from "@/lib/risk/parameters";
import { AdminRiskParametersDashboard } from "@/components/dashboard/AdminRiskParametersDashboard";

export const metadata = {
  title: "Risk Parameters Dashboard — TrustLend Admin",
  description: "Configure platform risk limits, collateral LTV parameters, interest rate curves, and protocol fees.",
};

export default async function AdminRiskParametersPage() {
  const { user } = await requireTradeVaultAdmin();
  const metrics = await getAdminDashboardMetrics();

  const initialState: RiskParametersState = {
    assets: DEFAULT_ASSET_RISK_CONFIGS,
    curves: DEFAULT_INTEREST_RATE_CURVES,
    protocolFees: DEFAULT_PROTOCOL_FEES,
    auditHistory: INITIAL_RISK_AUDIT_LOG,
  };

  return (
    <WorkspaceFrame
      roleLabel="Trade Vault Admin"
      heading="Risk Parameters"
      description="View and securely adjust platform risk limits, collateral factors, jump-rate interest curves, and protocol fees."
      email={user.email ?? null}
      userName={String(user.fullName ?? "Admin")}
      metrics={presentAdminMetrics(metrics)}
      links={[...adminNavLinks]}
      currentPath="/dashboard/admin/risk"
      showProfileAlert={false}
    >
      <AdminRiskParametersDashboard
        initialState={initialState}
        adminEmail={user.email || "admin@trustlend.org"}
      />
    </WorkspaceFrame>
  );
}
