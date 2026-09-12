import { WorkspaceFrame } from "@/components/dashboard/WorkspaceFrame";
import { requireAuthenticatedUser } from "@/lib/auth/session";
import { getLenderDashboardMetrics, presentLenderMetrics } from "@/lib/dashboard/metrics";
import { and, desc, eq } from "drizzle-orm";
import { getDb } from "@/lib/db/client";
import { readMetadata } from "@/lib/db/metadata";
import { getProfile } from "@/lib/db/queries";
import { ledgerToRow, poolToRow, positionToRow } from "@/lib/db/rows";
import { ledgerTransactions, lendingPools, poolPositions } from "@/lib/db/schema";
import { lenderNavLinks } from "@/lib/dashboard/lender-links";
import { formatCurrency, formatXlmPrecise } from "@/lib/utils/formatting";
import { TaxReportExportButton } from "@/components/dashboard/TaxReportExportButton";
import { collectReportYears } from "@/lib/lender/tax-report";
import { calculateLenderYieldAnalytics } from "@/lib/lender/yield-analytics";
import { LenderPortfolioYieldAnalytics } from "@/components/dashboard/LenderPortfolioYieldAnalytics";

export default async function LenderPortfolioPage() {
  const { user } = await requireAuthenticatedUser("lender");
  const metrics = await getLenderDashboardMetrics(user.id);

  const db = getDb();

  // 1. Pool positions, profile, lending pools, and both sides of the P2P ledger
  const [positionRows, profile, poolRows, p2pFundRows, p2pRepayRows] = db
    ? await Promise.all([
        db
          .select()
          .from(poolPositions)
          .where(eq(poolPositions.lenderId, user.id))
          .orderBy(desc(poolPositions.openedAt))
          .limit(20),
        getProfile(db, user.id),
        db.select().from(lendingPools),
        db
          .select()
          .from(ledgerTransactions)
          .where(and(eq(ledgerTransactions.userId, user.id), eq(ledgerTransactions.refType, "loan_fund"))),
        db.select().from(ledgerTransactions).where(eq(ledgerTransactions.refType, "loan_repay")),
      ])
    : [[], null, [], [], []];

  const positions = positionRows.map(positionToRow);
  const pools = poolRows.map(poolToRow);
  const p2pFunds = p2pFundRows.map(ledgerToRow);

  // Repayment rows are written by the borrower; the lender is identified from metadata.
  const lenderRepays = p2pRepayRows.map(ledgerToRow).filter((tx) => {
    const meta = readMetadata(tx.metadata);
    return String(meta.lenderUserId) === user.id || String(meta.lenderAddress) === user.walletAddress;
  });

  // Calculate comprehensive yield analytics & pool breakdown (Issue #256)
  const yieldAnalytics = calculateLenderYieldAnalytics({
    positions,
    pools,
    p2pFunds,
    p2pRepays: lenderRepays,
  });

  // Calculate Marketplace net
  const marketplaceDeployed = (p2pFunds ?? []).reduce((s, t) => s + Number(t.amount), 0);
  const marketplaceReceived = lenderRepays.reduce((s, t) => s + Number(t.amount), 0);
  const marketplaceProfit = Math.max(0, marketplaceReceived - marketplaceDeployed);
  const poolProfit = positions.reduce((s, r) => s + Number(r.earned_interest ?? 0), 0);

  // Years the lender actually has activity in, for the tax-export picker.
  const reportYears = collectReportYears([
    ...positions.flatMap((position) => [
      position.opened_at ? String(position.opened_at) : null,
      position.closed_at ? String(position.closed_at) : null,
    ]),
    ...(p2pFunds ?? []).map((tx) => (tx.created_at ? String(tx.created_at) : null)),
    ...lenderRepays.map((tx) => (tx.created_at ? String(tx.created_at) : null)),
  ]);

  return (
    <WorkspaceFrame
      roleLabel="Lender Dashboard"
      heading="Portfolio & Yield Analytics"
      description="Track historical APY yield, projected future returns, and earnings breakdown across lending pools."
      email={user.email ?? null}
      userName={String(user.fullName ?? profile?.full_name ?? "")}
      metrics={presentLenderMetrics(metrics)}
      currentPath="/dashboard/lender/portfolio"
      links={lenderNavLinks}
    >
      <div className="workspace-stack" style={{ gap: "1.75rem" }}>

        {/* ── Portfolio Yield Analytics & Pool Breakdown (Issue #256) ── */}
        <LenderPortfolioYieldAnalytics analytics={yieldAnalytics} />

        {/* Tax report export (issue #271) */}
        <article className="workspace-card workspace-card--full">
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              gap: "1rem",
              flexWrap: "wrap",
            }}
          >
            <div>
              <h2 className="workspace-card-title" style={{ margin: 0 }}>
                Tax Report Export
              </h2>
              <p className="workspace-card-copy" style={{ margin: "0.35rem 0 0", maxWidth: "44rem" }}>
                Download a CSV of every interest payment you have earned — pool
                interest and direct marketplace loans — with the date, amount and
                asset for each entry.
              </p>
            </div>

            <TaxReportExportButton years={reportYears} />
          </div>
        </article>

        {/* High-level Profit Summary */}
        <section className="workspace-grid workspace-grid--two">
           <article className="workspace-card" style={{ background: "linear-gradient(135deg, var(--primary), var(--primary-hover))", color: "var(--primary-fg)", border: "none" }}>
              <div style={{ display: "flex", alignItems: "center", gap: "0.75rem", marginBottom: "1rem" }}>
                 <div style={{ fontSize: "2rem" }}>🏪</div>
                 <div>
                    <h2 style={{ margin: 0, fontSize: "1.1rem" }}>Marketplace Profits</h2>
                    <p style={{ margin: 0, opacity: 0.8, fontSize: "0.8rem" }}>Direct P2P Lending</p>
                 </div>
              </div>
              <p style={{ fontSize: "2rem", fontWeight: 800, margin: "0 0 0.5rem" }}>
                {marketplaceProfit > 0 ? "+" : ""}{formatCurrency(marketplaceProfit)}
              </p>
              <div style={{ fontSize: "0.85rem", opacity: 0.8, display: "flex", justifyContent: "space-between", borderTop: "1px solid color-mix(in srgb, var(--primary-fg) 25%, transparent)", paddingTop: "0.5rem", marginTop: "0.5rem" }}>
                 <span>Deployed: {formatCurrency(marketplaceDeployed)}</span>
                 <span>Received: {formatCurrency(marketplaceReceived)}</span>
              </div>
           </article>

           <article className="workspace-card" style={{ background: "linear-gradient(135deg, var(--accent), var(--accent-hover))", color: "var(--primary-fg)", border: "none" }}>
              <div style={{ display: "flex", alignItems: "center", gap: "0.75rem", marginBottom: "1rem" }}>
                 <div style={{ fontSize: "2rem" }}>🏦</div>
                 <div>
                    <h2 style={{ margin: 0, fontSize: "1.1rem" }}>Pool Profits</h2>
                    <p style={{ margin: 0, opacity: 0.8, fontSize: "0.8rem" }}>Automated Liquidity Pools</p>
                 </div>
              </div>
              <p style={{ fontSize: "2rem", fontWeight: 800, margin: "0 0 0.5rem" }}>
                {poolProfit > 0 ? "+" : ""}{formatXlmPrecise(poolProfit)}
              </p>
              <div style={{ fontSize: "0.85rem", opacity: 0.8, display: "flex", justifyContent: "space-between", borderTop: "1px solid color-mix(in srgb, var(--primary-fg) 25%, transparent)", paddingTop: "0.5rem", marginTop: "0.5rem" }}>
                 <span>Total Deployed: {formatCurrency(positions.reduce((s,p) => s + Number(p.principal_amount), 0))}</span>
                 <span>Positions: {positions.length}</span>
              </div>
           </article>
        </section>
      </div>
    </WorkspaceFrame>
  );
}
