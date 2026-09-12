"use client";

import { useState, useMemo } from "react";
import {
  AssetRiskConfig,
  InterestRateCurveConfig,
  ProtocolFeeConfig,
  RiskParametersState,
  RiskParameterUpdateAudit,
  RISK_PARAMETER_BOUNDS,
  generateRateCurvePoints,
  computeBorrowRateBps,
  computeSupplyRateBps,
} from "@/lib/risk/parameters";

interface AdminRiskParametersDashboardProps {
  initialState: RiskParametersState;
  adminEmail: string;
}

export function AdminRiskParametersDashboard({
  initialState,
  adminEmail,
}: AdminRiskParametersDashboardProps) {
  const [state, setState] = useState<RiskParametersState>(initialState);
  const [activeTab, setActiveTab] = useState<"collateral" | "curves" | "fees" | "audit">("collateral");
  const [selectedPoolId, setSelectedPoolId] = useState<number>(state.curves[0]?.poolId ?? 1);

  // Edit states for modals
  const [editingAsset, setEditingAsset] = useState<AssetRiskConfig | null>(null);
  const [editingCurve, setEditingCurve] = useState<InterestRateCurveConfig | null>(null);
  const [editingFees, setEditingFees] = useState<ProtocolFeeConfig | null>(null);

  // Form inputs for asset editing
  const [assetForm, setAssetForm] = useState<{
    collateralFactorPct: number;
    volatilityPct: number;
    liquidationThresholdPct: number;
    hasPriceOracle: boolean;
  }>({
    collateralFactorPct: 75,
    volatilityPct: 5,
    liquidationThresholdPct: 80,
    hasPriceOracle: true,
  });

  // Form inputs for curve editing
  const activeCurve = useMemo(
    () => state.curves.find((c) => c.poolId === selectedPoolId) ?? state.curves[0],
    [state.curves, selectedPoolId]
  );

  const [curveForm, setCurveForm] = useState<{
    baseRatePct: number;
    multiplierPct: number;
    kinkPct: number;
    jumpMultiplierPct: number;
    reserveFactorPct: number;
  }>({
    baseRatePct: activeCurve.baseRateBps / 100,
    multiplierPct: activeCurve.multiplierPerSlopeBps / 100,
    kinkPct: activeCurve.kinkBps / 100,
    jumpMultiplierPct: activeCurve.jumpMultiplierBps / 100,
    reserveFactorPct: activeCurve.reserveFactorBps / 100,
  });

  // Form inputs for fees
  const [feesForm, setFeesForm] = useState<{
    flashLoanFeePct: number;
    platformFeePct: number;
    isPaused: boolean;
  }>({
    flashLoanFeePct: state.protocolFees.flashLoanFeeBps / 100,
    platformFeePct: state.protocolFees.platformFeeBps / 100,
    isPaused: state.protocolFees.isPaused,
  });

  // Confirmation modal state
  const [pendingUpdate, setPendingUpdate] = useState<{
    category: "collateral_ltv" | "interest_curve" | "protocol_fees";
    targetId: string | number;
    title: string;
    diffs: Array<{ label: string; oldVal: string; newVal: string }>;
    payload: Record<string, unknown>;
  } | null>(null);

  const [reason, setReason] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [actionSuccess, setActionSuccess] = useState<string | null>(null);

  // Computed curve preview points for visualizer
  const previewCurveConfig: InterestRateCurveConfig = useMemo(() => {
    return {
      poolId: activeCurve.poolId,
      poolName: activeCurve.poolName,
      baseRateBps: Math.round(curveForm.baseRatePct * 100),
      multiplierPerSlopeBps: Math.round(curveForm.multiplierPct * 100),
      kinkBps: Math.round(curveForm.kinkPct * 100),
      jumpMultiplierBps: Math.round(curveForm.jumpMultiplierPct * 100),
      reserveFactorBps: Math.round(curveForm.reserveFactorPct * 100),
    };
  }, [activeCurve, curveForm]);

  const rateCurvePoints = useMemo(
    () => generateRateCurvePoints(previewCurveConfig),
    [previewCurveConfig]
  );

  // Handle opening Asset Edit Modal
  const openEditAsset = (asset: AssetRiskConfig) => {
    setEditingAsset(asset);
    setAssetForm({
      collateralFactorPct: asset.collateralFactorBps / 100,
      volatilityPct: asset.volatilityBps / 100,
      liquidationThresholdPct: asset.liquidationThresholdBps / 100,
      hasPriceOracle: asset.hasPriceOracle,
    });
    setActionError(null);
  };

  // Stage Asset Update
  const handleStageAssetUpdate = () => {
    if (!editingAsset) return;
    setActionError(null);

    const newLtvBps = Math.round(assetForm.collateralFactorPct * 100);
    const newVolBps = Math.round(assetForm.volatilityPct * 100);
    const newThreshBps = Math.round(assetForm.liquidationThresholdPct * 100);

    if (
      newLtvBps < RISK_PARAMETER_BOUNDS.MIN_COLLATERAL_FACTOR_BPS ||
      newLtvBps > RISK_PARAMETER_BOUNDS.MAX_COLLATERAL_FACTOR_BPS
    ) {
      setActionError(
        `LTV must be between ${RISK_PARAMETER_BOUNDS.MIN_COLLATERAL_FACTOR_BPS / 100}% and ${
          RISK_PARAMETER_BOUNDS.MAX_COLLATERAL_FACTOR_BPS / 100
        }%`
      );
      return;
    }

    if (newThreshBps < newLtvBps) {
      setActionError("Liquidation threshold cannot be lower than the max LTV");
      return;
    }

    setPendingUpdate({
      category: "collateral_ltv",
      targetId: editingAsset.assetSymbol,
      title: `Update ${editingAsset.assetSymbol} Collateral Risk Parameters`,
      diffs: [
        {
          label: "Max LTV (Collateral Factor)",
          oldVal: `${(editingAsset.collateralFactorBps / 100).toFixed(2)}%`,
          newVal: `${assetForm.collateralFactorPct.toFixed(2)}%`,
        },
        {
          label: "Volatility Buffer",
          oldVal: `${(editingAsset.volatilityBps / 100).toFixed(2)}%`,
          newVal: `${assetForm.volatilityPct.toFixed(2)}%`,
        },
        {
          label: "Liquidation Threshold",
          oldVal: `${(editingAsset.liquidationThresholdBps / 100).toFixed(2)}%`,
          newVal: `${assetForm.liquidationThresholdPct.toFixed(2)}%`,
        },
        {
          label: "Price Oracle Active",
          oldVal: editingAsset.hasPriceOracle ? "Yes" : "No",
          newVal: assetForm.hasPriceOracle ? "Yes" : "No",
        },
      ],
      payload: {
        collateralFactorBps: newLtvBps,
        volatilityBps: newVolBps,
        liquidationThresholdBps: newThreshBps,
        hasPriceOracle: assetForm.hasPriceOracle,
      },
    });
    setEditingAsset(null);
    setReason("");
  };

  // Stage Curve Update
  const handleStageCurveUpdate = () => {
    setActionError(null);
    const newBaseBps = Math.round(curveForm.baseRatePct * 100);
    const newMultBps = Math.round(curveForm.multiplierPct * 100);
    const newKinkBps = Math.round(curveForm.kinkPct * 100);
    const newJumpBps = Math.round(curveForm.jumpMultiplierPct * 100);
    const newReserveBps = Math.round(curveForm.reserveFactorPct * 100);

    if (newKinkBps < 1000 || newKinkBps > 9000) {
      setActionError("Kink must be between 10% and 90%");
      return;
    }

    setPendingUpdate({
      category: "interest_curve",
      targetId: activeCurve.poolId,
      title: `Update ${activeCurve.poolName} Interest Rate Curve`,
      diffs: [
        {
          label: "Base Rate (at 0% util)",
          oldVal: `${(activeCurve.baseRateBps / 100).toFixed(2)}%`,
          newVal: `${curveForm.baseRatePct.toFixed(2)}%`,
        },
        {
          label: "Slope 1 Multiplier",
          oldVal: `${(activeCurve.multiplierPerSlopeBps / 100).toFixed(2)}%`,
          newVal: `${curveForm.multiplierPct.toFixed(2)}%`,
        },
        {
          label: "Optimal Utilization Kink",
          oldVal: `${(activeCurve.kinkBps / 100).toFixed(2)}%`,
          newVal: `${curveForm.kinkPct.toFixed(2)}%`,
        },
        {
          label: "Jump Multiplier (Slope 2)",
          oldVal: `${(activeCurve.jumpMultiplierBps / 100).toFixed(2)}%`,
          newVal: `${curveForm.jumpMultiplierPct.toFixed(2)}%`,
        },
        {
          label: "Reserve Factor",
          oldVal: `${(activeCurve.reserveFactorBps / 100).toFixed(2)}%`,
          newVal: `${curveForm.reserveFactorPct.toFixed(2)}%`,
        },
      ],
      payload: {
        baseRateBps: newBaseBps,
        multiplierPerSlopeBps: newMultBps,
        kinkBps: newKinkBps,
        jumpMultiplierBps: newJumpBps,
        reserveFactorBps: newReserveBps,
      },
    });
    setReason("");
  };

  // Stage Protocol Fees Update
  const handleStageFeesUpdate = () => {
    setActionError(null);
    const newFlashBps = Math.round(feesForm.flashLoanFeePct * 100);
    const newPlatformBps = Math.round(feesForm.platformFeePct * 100);

    if (newFlashBps > 500) {
      setActionError("Flash loan fee cannot exceed 5.00%");
      return;
    }
    if (newPlatformBps > 1000) {
      setActionError("Platform fee cannot exceed 10.00%");
      return;
    }

    setPendingUpdate({
      category: "protocol_fees",
      targetId: "protocol_fees",
      title: "Update Protocol Fee & Circuit Breaker Settings",
      diffs: [
        {
          label: "Flash Loan Fee",
          oldVal: `${(state.protocolFees.flashLoanFeeBps / 100).toFixed(2)}%`,
          newVal: `${feesForm.flashLoanFeePct.toFixed(2)}%`,
        },
        {
          label: "Platform Protocol Fee",
          oldVal: `${(state.protocolFees.platformFeeBps / 100).toFixed(2)}%`,
          newVal: `${feesForm.platformFeePct.toFixed(2)}%`,
        },
        {
          label: "Circuit Breaker (Emergency Pause)",
          oldVal: state.protocolFees.isPaused ? "PAUSED" : "ACTIVE",
          newVal: feesForm.isPaused ? "PAUSED" : "ACTIVE",
        },
      ],
      payload: {
        flashLoanFeeBps: newFlashBps,
        platformFeeBps: newPlatformBps,
        isPaused: feesForm.isPaused,
      },
    });
    setReason("");
  };

  // Execute staged update securely
  const handleExecuteUpdate = async () => {
    if (!pendingUpdate) return;
    if (!reason || reason.trim().length < 5) {
      setActionError("Please provide an administrative reason (min 5 chars)");
      return;
    }

    setSubmitting(true);
    setActionError(null);

    try {
      const response = await fetch("/api/admin/risk-parameters", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          category: pendingUpdate.category,
          targetId: pendingUpdate.targetId,
          updates: pendingUpdate.payload,
          reason: reason.trim(),
        }),
      });

      const resJson = await response.json();
      if (!response.ok || !resJson.success) {
        throw new Error(resJson.error || "Failed to update risk parameters");
      }

      setState(resJson.data);
      setActionSuccess(`Successfully executed: ${pendingUpdate.title}`);
      setPendingUpdate(null);
      setReason("");

      setTimeout(() => setActionSuccess(null), 5000);
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "Execution failed");
    } finally {
      setSubmitting(false);
    }
  };

  // Summary Metrics
  const avgLtv = (
    state.assets.reduce((sum, a) => sum + a.collateralFactorBps, 0) /
    (state.assets.length || 1) /
    100
  ).toFixed(1);

  return (
    <div className="workspace-stack" style={{ gap: "1.5rem" }}>
      {/* ── Top Alert / Feedback ── */}
      {actionSuccess && (
        <div
          style={{
            padding: "0.85rem 1.25rem",
            background: "color-mix(in srgb, var(--accent) 12%, transparent)",
            border: "1px solid color-mix(in srgb, var(--accent) 35%, transparent)",
            borderRadius: "0.75rem",
            color: "var(--accent-hover)",
            fontWeight: 600,
            fontSize: "0.9rem",
          }}
        >
          ✅ {actionSuccess}
        </div>
      )}

      {actionError && (
        <div
          style={{
            padding: "0.85rem 1.25rem",
            background: "color-mix(in srgb, var(--danger) 12%, transparent)",
            border: "1px solid color-mix(in srgb, var(--danger) 35%, transparent)",
            borderRadius: "0.75rem",
            color: "var(--danger)",
            fontWeight: 600,
            fontSize: "0.9rem",
          }}
        >
          ⚠️ {actionError}
        </div>
      )}

      {/* ── Executive Metric Cards ── */}
      <section className="workspace-grid workspace-grid--four">
        <div className="workspace-card">
          <span style={{ fontSize: "0.75rem", textTransform: "uppercase", letterSpacing: "0.05em", color: "var(--primary)", fontWeight: 700 }}>
            Average Max LTV
          </span>
          <p style={{ fontSize: "1.75rem", fontWeight: 800, margin: "0.3rem 0 0", color: "var(--fg)" }}>
            {avgLtv}%
          </p>
          <span style={{ fontSize: "0.78rem", color: "var(--fg-muted)" }}>
            Across {state.assets.length} whitelisted assets
          </span>
        </div>

        <div className="workspace-card">
          <span style={{ fontSize: "0.75rem", textTransform: "uppercase", letterSpacing: "0.05em", color: "var(--accent)", fontWeight: 700 }}>
            Target Kink Util
          </span>
          <p style={{ fontSize: "1.75rem", fontWeight: 800, margin: "0.3rem 0 0", color: "var(--fg)" }}>
            {(activeCurve.kinkBps / 100).toFixed(1)}%
          </p>
          <span style={{ fontSize: "0.78rem", color: "var(--fg-muted)" }}>
            Optimal efficiency threshold
          </span>
        </div>

        <div className="workspace-card">
          <span style={{ fontSize: "0.75rem", textTransform: "uppercase", letterSpacing: "0.05em", color: "var(--warning)", fontWeight: 700 }}>
            Base Borrow APY
          </span>
          <p style={{ fontSize: "1.75rem", fontWeight: 800, margin: "0.3rem 0 0", color: "var(--fg)" }}>
            {(activeCurve.baseRateBps / 100).toFixed(2)}%
          </p>
          <span style={{ fontSize: "0.78rem", color: "var(--fg-muted)" }}>
            At 0% pool utilization
          </span>
        </div>

        <div className="workspace-card">
          <span style={{ fontSize: "0.75rem", textTransform: "uppercase", letterSpacing: "0.05em", color: "var(--primary)", fontWeight: 700 }}>
            Circuit Breaker
          </span>
          <p
            style={{
              fontSize: "1.25rem",
              fontWeight: 800,
              margin: "0.5rem 0 0",
              color: state.protocolFees.isPaused ? "var(--danger)" : "var(--accent)",
            }}
          >
            {state.protocolFees.isPaused ? "🔴 PAUSED" : "🟢 ACTIVE"}
          </p>
          <span style={{ fontSize: "0.78rem", color: "var(--fg-muted)" }}>
            Protocol operations status
          </span>
        </div>
      </section>

      {/* ── Tab Navigation ── */}
      <div style={{ display: "flex", gap: "0.5rem", borderBottom: "1px solid color-mix(in srgb, var(--fg) 8%, transparent)", paddingBottom: "0.5rem" }}>
        {([
          { id: "collateral", label: "Collateral & LTV Limits", emoji: "🛡️" },
          { id: "curves", label: "Interest Rate Curves", emoji: "📈" },
          { id: "fees", label: "Protocol Fees & Security", emoji: "⚙️" },
          { id: "audit", label: "Audit & Adjustment Log", emoji: "📋" },
        ] as const).map((tab) => (
          <button
            key={tab.id}
            type="button"
            onClick={() => setActiveTab(tab.id)}
            style={{
              padding: "0.6rem 1rem",
              borderRadius: "0.5rem",
              border: "none",
              background: activeTab === tab.id ? "color-mix(in srgb, var(--primary) 12%, transparent)" : "transparent",
              color: activeTab === tab.id ? "var(--primary)" : "var(--fg)",
              fontWeight: activeTab === tab.id ? 700 : 500,
              fontSize: "0.88rem",
              cursor: "pointer",
              display: "flex",
              alignItems: "center",
              gap: "0.4rem",
            }}
          >
            <span>{tab.emoji}</span>
            <span>{tab.label}</span>
          </button>
        ))}
      </div>

      {/* ── TAB 1: Collateral & LTV Limits ── */}
      {activeTab === "collateral" && (
        <section className="workspace-stack" style={{ gap: "1rem" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <div>
              <h2 style={{ fontSize: "1.2rem", fontWeight: 800, margin: 0, color: "var(--fg)" }}>
                Whitelisted Collateral Assets &amp; LTV Limits
              </h2>
              <p style={{ fontSize: "0.85rem", color: "var(--fg-muted)", margin: "0.2rem 0 0" }}>
                Adjust max borrow limits, volatility buffers, and liquidation thresholds per supported collateral asset.
              </p>
            </div>
          </div>

          <div className="workspace-grid workspace-grid--three" style={{ marginTop: "0.5rem" }}>
            {state.assets.map((asset) => (
              <div
                key={asset.assetSymbol}
                className="workspace-card"
                style={{
                  border: "1px solid color-mix(in srgb, var(--primary) 18%, transparent)",
                  borderRadius: "1rem",
                  padding: "1.25rem",
                  display: "flex",
                  flexDirection: "column",
                  justifyContent: "space-between",
                }}
              >
                <div>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                    <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
                      <span style={{ fontSize: "1.5rem" }}>
                        {asset.assetSymbol === "XLM" ? "🪙" : asset.assetSymbol === "USDC" ? "💵" : "₿"}
                      </span>
                      <div>
                        <strong style={{ fontSize: "1.1rem", color: "var(--fg)" }}>{asset.assetSymbol}</strong>
                        <p style={{ margin: 0, fontSize: "0.75rem", color: "var(--fg-muted)" }}>{asset.assetName}</p>
                      </div>
                    </div>
                    <span
                      style={{
                        fontSize: "0.68rem",
                        fontWeight: 700,
                        padding: "0.2rem 0.5rem",
                        borderRadius: "9999px",
                        background: asset.isWhitelisted ? "color-mix(in srgb, var(--accent) 15%, transparent)" : "color-mix(in srgb, var(--danger) 15%, transparent)",
                        color: asset.isWhitelisted ? "var(--accent-hover)" : "var(--danger)",
                        textTransform: "uppercase",
                      }}
                    >
                      {asset.isWhitelisted ? "Whitelisted" : "Disabled"}
                    </span>
                  </div>

                  <hr style={{ margin: "1rem 0", borderColor: "color-mix(in srgb, var(--fg) 6%, transparent)" }} />

                  <div style={{ display: "grid", gap: "0.6rem", fontSize: "0.85rem" }}>
                    <div style={{ display: "flex", justifyContent: "space-between" }}>
                      <span style={{ color: "var(--fg-muted)" }}>Max LTV (Collateral Factor):</span>
                      <strong style={{ color: "var(--primary)" }}>{(asset.collateralFactorBps / 100).toFixed(2)}%</strong>
                    </div>
                    <div style={{ display: "flex", justifyContent: "space-between" }}>
                      <span style={{ color: "var(--fg-muted)" }}>Volatility Buffer:</span>
                      <strong style={{ color: "var(--fg)" }}>{(asset.volatilityBps / 100).toFixed(2)}%</strong>
                    </div>
                    <div style={{ display: "flex", justifyContent: "space-between" }}>
                      <span style={{ color: "var(--fg-muted)" }}>Liquidation Threshold:</span>
                      <strong style={{ color: "var(--warning)" }}>{(asset.liquidationThresholdBps / 100).toFixed(2)}%</strong>
                    </div>
                    <div style={{ display: "flex", justifyContent: "space-between" }}>
                      <span style={{ color: "var(--fg-muted)" }}>Liquidation Penalty/Bonus:</span>
                      <strong style={{ color: "var(--fg)" }}>{(asset.liquidationBonusBps / 100).toFixed(2)}%</strong>
                    </div>
                    <div style={{ display: "flex", justifyContent: "space-between" }}>
                      <span style={{ color: "var(--fg-muted)" }}>Price Oracle Feed:</span>
                      <strong style={{ color: asset.hasPriceOracle ? "var(--accent)" : "var(--fg-muted)" }}>
                        {asset.hasPriceOracle ? "Active (Oracle)" : "Manual/Off"}
                      </strong>
                    </div>
                  </div>
                </div>

                <button
                  type="button"
                  onClick={() => openEditAsset(asset)}
                  style={{
                    marginTop: "1.25rem",
                    width: "100%",
                    padding: "0.6rem",
                    background: "color-mix(in srgb, var(--primary) 8%, transparent)",
                    border: "1px solid color-mix(in srgb, var(--primary) 25%, transparent)",
                    borderRadius: "0.5rem",
                    color: "var(--primary)",
                    fontWeight: 700,
                    fontSize: "0.82rem",
                    cursor: "pointer",
                  }}
                >
                  Edit Risk Parameters ⚙️
                </button>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* ── TAB 2: Interest Rate Curves ── */}
      {activeTab === "curves" && (
        <section className="workspace-stack" style={{ gap: "1.25rem" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: "1rem" }}>
            <div>
              <h2 style={{ fontSize: "1.2rem", fontWeight: 800, margin: 0, color: "var(--fg)" }}>
                Interest Rate Curve &amp; Jump-Rate Model
              </h2>
              <p style={{ fontSize: "0.85rem", color: "var(--fg-muted)", margin: "0.2rem 0 0" }}>
                Dynamic interest rate models with two-slope jump-rate math protecting liquidity reserves.
              </p>
            </div>

            <div style={{ display: "flex", gap: "0.5rem" }}>
              {state.curves.map((c) => (
                <button
                  key={c.poolId}
                  type="button"
                  onClick={() => {
                    setSelectedPoolId(c.poolId);
                    setCurveForm({
                      baseRatePct: c.baseRateBps / 100,
                      multiplierPct: c.multiplierPerSlopeBps / 100,
                      kinkPct: c.kinkBps / 100,
                      jumpMultiplierPct: c.jumpMultiplierBps / 100,
                      reserveFactorPct: c.reserveFactorBps / 100,
                    });
                  }}
                  style={{
                    padding: "0.45rem 0.85rem",
                    borderRadius: "0.45rem",
                    border: selectedPoolId === c.poolId ? "1px solid var(--primary)" : "1px solid color-mix(in srgb, var(--fg) 12%, transparent)",
                    background: selectedPoolId === c.poolId ? "color-mix(in srgb, var(--primary) 10%, transparent)" : "var(--surface-2)",
                    color: selectedPoolId === c.poolId ? "var(--primary)" : "var(--fg)",
                    fontWeight: 600,
                    fontSize: "0.82rem",
                    cursor: "pointer",
                  }}
                >
                  {c.poolName}
                </button>
              ))}
            </div>
          </div>

          <div className="workspace-grid workspace-grid--two" style={{ gap: "1.5rem" }}>
            {/* Interactive Curve Visualizer */}
            <div className="workspace-card" style={{ padding: "1.25rem" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "1rem" }}>
                <strong style={{ fontSize: "0.95rem", color: "var(--fg)" }}>
                  Curve Simulation: {previewCurveConfig.poolName}
                </strong>
                <span style={{ fontSize: "0.75rem", color: "var(--fg-muted)" }}>
                  Kink at <strong>{curveForm.kinkPct}%</strong> utilization
                </span>
              </div>

              {/* Visual Curve Chart (SVG) */}
              <div
                style={{
                  height: "220px",
                  background: "var(--surface-2)",
                  borderRadius: "0.75rem",
                  padding: "1rem",
                  position: "relative",
                  display: "flex",
                  flexDirection: "column",
                  justifyContent: "space-between",
                }}
              >
                <svg viewBox="0 0 400 180" style={{ width: "100%", height: "100%", overflow: "visible" }}>
                  {/* Grid Lines */}
                  <line x1="40" y1="20" x2="380" y2="20" stroke="color-mix(in srgb, var(--fg) 7%, transparent)" strokeDasharray="3" />
                  <line x1="40" y1="70" x2="380" y2="70" stroke="color-mix(in srgb, var(--fg) 7%, transparent)" strokeDasharray="3" />
                  <line x1="40" y1="120" x2="380" y2="120" stroke="color-mix(in srgb, var(--fg) 7%, transparent)" strokeDasharray="3" />
                  <line x1="40" y1="160" x2="380" y2="160" stroke="color-mix(in srgb, var(--fg) 20%, transparent)" />

                  {/* Kink line marker */}
                  {(() => {
                    const kinkX = 40 + (curveForm.kinkPct / 100) * 340;
                    return (
                      <>
                        <line x1={kinkX} y1="10" x2={kinkX} y2="160" stroke="var(--warning)" strokeDasharray="4" strokeWidth="1.5" />
                        <text x={kinkX} y="15" fill="var(--warning)" fontSize="9" textAnchor="middle" fontWeight="bold">
                          KINK ({curveForm.kinkPct}%)
                        </text>
                      </>
                    );
                  })()}

                  {/* Borrow APY Path */}
                  {(() => {
                    const maxApy = 80;
                    const pointsStr = rateCurvePoints
                      .map((pt) => {
                        const x = 40 + (pt.utilizationPct / 100) * 340;
                        const y = 160 - Math.min(150, (pt.borrowApyPct / maxApy) * 140);
                        return `${x},${y}`;
                      })
                      .join(" ");
                    return (
                      <polyline
                        fill="none"
                        stroke="var(--primary)"
                        strokeWidth="3"
                        points={pointsStr}
                      />
                    );
                  })()}

                  {/* Supply APY Path */}
                  {(() => {
                    const maxApy = 80;
                    const pointsStr = rateCurvePoints
                      .map((pt) => {
                        const x = 40 + (pt.utilizationPct / 100) * 340;
                        const y = 160 - Math.min(150, (pt.supplyApyPct / maxApy) * 140);
                        return `${x},${y}`;
                      })
                      .join(" ");
                    return (
                      <polyline
                        fill="none"
                        stroke="var(--accent)"
                        strokeWidth="2.5"
                        points={pointsStr}
                      />
                    );
                  })()}

                  {/* Axes labels */}
                  <text x="40" y="175" fill="color-mix(in srgb, var(--fg) 50%, transparent)" fontSize="9">0% Util</text>
                  <text x="380" y="175" fill="color-mix(in srgb, var(--fg) 50%, transparent)" fontSize="9" textAnchor="end">100% Util</text>
                </svg>

                {/* Legend */}
                <div style={{ display: "flex", justifyContent: "center", gap: "1.5rem", marginTop: "0.25rem", fontSize: "0.75rem" }}>
                  <span style={{ color: "var(--primary-muted)", display: "flex", alignItems: "center", gap: "0.3rem" }}>
                    <span style={{ width: "10px", height: "3px", background: "var(--primary)", display: "inline-block" }} /> Borrow APY (Slope 1 + Jump)
                  </span>
                  <span style={{ color: "var(--accent)", display: "flex", alignItems: "center", gap: "0.3rem" }}>
                    <span style={{ width: "10px", height: "3px", background: "var(--accent)", display: "inline-block" }} /> Supply APY (Lender Return)
                  </span>
                </div>
              </div>

              {/* Sample Checkpoints Table */}
              <div style={{ marginTop: "1rem", overflowX: "auto" }}>
                <table style={{ width: "100%", fontSize: "0.78rem", textAlign: "left", borderCollapse: "collapse" }}>
                  <thead>
                    <tr style={{ color: "var(--fg-muted)", borderBottom: "1px solid color-mix(in srgb, var(--fg) 8%, transparent)" }}>
                      <th style={{ padding: "0.4rem" }}>Utilization</th>
                      <th style={{ padding: "0.4rem" }}>Borrow APY</th>
                      <th style={{ padding: "0.4rem" }}>Supply APY</th>
                      <th style={{ padding: "0.4rem" }}>State</th>
                    </tr>
                  </thead>
                  <tbody>
                    {[0, 50, Math.round(curveForm.kinkPct), 90, 100].map((u) => {
                      const bBps = computeBorrowRateBps(previewCurveConfig, u * 100);
                      const sBps = computeSupplyRateBps(previewCurveConfig, u * 100, bBps);
                      const isKink = u === Math.round(curveForm.kinkPct);
                      return (
                        <tr key={u} style={{ borderBottom: "1px solid color-mix(in srgb, var(--fg) 4%, transparent)", background: isKink ? "color-mix(in srgb, var(--warning) 6%, transparent)" : undefined }}>
                          <td style={{ padding: "0.4rem", fontWeight: isKink ? 700 : 500 }}>{u}%</td>
                          <td style={{ padding: "0.4rem", color: "var(--primary)", fontWeight: 700 }}>{(bBps / 100).toFixed(2)}%</td>
                          <td style={{ padding: "0.4rem", color: "var(--accent)", fontWeight: 700 }}>{(sBps / 100).toFixed(2)}%</td>
                          <td style={{ padding: "0.4rem", fontSize: "0.7rem", color: isKink ? "var(--warning)" : "var(--fg-muted)" }}>
                            {isKink ? "⭐ Target Kink" : u > curveForm.kinkPct ? "⚡ Jump Slope" : "Base Slope"}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>

            {/* Curve Parameters Adjustment Controls */}
            <div className="workspace-card" style={{ padding: "1.25rem" }}>
              <strong style={{ fontSize: "0.95rem", color: "var(--fg)" }}>
                Adjust Curve Parameters: {activeCurve.poolName}
              </strong>
              <p style={{ fontSize: "0.78rem", color: "var(--fg-muted)", margin: "0.2rem 0 1rem" }}>
                Modify base rates, multipliers, and jump thresholds with immediate preview.
              </p>

              <div style={{ display: "grid", gap: "1rem" }}>
                <div>
                  <div style={{ display: "flex", justifyContent: "space-between", fontSize: "0.82rem", marginBottom: "0.25rem" }}>
                    <span>Base Borrow Rate:</span>
                    <strong>{curveForm.baseRatePct.toFixed(2)}%</strong>
                  </div>
                  <input
                    type="range"
                    min="0"
                    max="20"
                    step="0.25"
                    value={curveForm.baseRatePct}
                    onChange={(e) => setCurveForm((prev) => ({ ...prev, baseRatePct: parseFloat(e.target.value) }))}
                    style={{ width: "100%" }}
                  />
                </div>

                <div>
                  <div style={{ display: "flex", justifyContent: "space-between", fontSize: "0.82rem", marginBottom: "0.25rem" }}>
                    <span>Slope 1 Rate Multiplier (up to kink):</span>
                    <strong>{curveForm.multiplierPct.toFixed(2)}%</strong>
                  </div>
                  <input
                    type="range"
                    min="1"
                    max="50"
                    step="0.5"
                    value={curveForm.multiplierPct}
                    onChange={(e) => setCurveForm((prev) => ({ ...prev, multiplierPct: parseFloat(e.target.value) }))}
                    style={{ width: "100%" }}
                  />
                </div>

                <div>
                  <div style={{ display: "flex", justifyContent: "space-between", fontSize: "0.82rem", marginBottom: "0.25rem" }}>
                    <span>Optimal Utilization (Kink):</span>
                    <strong style={{ color: "var(--warning)" }}>{curveForm.kinkPct.toFixed(0)}%</strong>
                  </div>
                  <input
                    type="range"
                    min="20"
                    max="90"
                    step="1"
                    value={curveForm.kinkPct}
                    onChange={(e) => setCurveForm((prev) => ({ ...prev, kinkPct: parseFloat(e.target.value) }))}
                    style={{ width: "100%" }}
                  />
                </div>

                <div>
                  <div style={{ display: "flex", justifyContent: "space-between", fontSize: "0.82rem", marginBottom: "0.25rem" }}>
                    <span>Jump Multiplier (Slope 2 past kink):</span>
                    <strong style={{ color: "var(--danger)" }}>{curveForm.jumpMultiplierPct.toFixed(2)}%</strong>
                  </div>
                  <input
                    type="range"
                    min="10"
                    max="150"
                    step="5"
                    value={curveForm.jumpMultiplierPct}
                    onChange={(e) => setCurveForm((prev) => ({ ...prev, jumpMultiplierPct: parseFloat(e.target.value) }))}
                    style={{ width: "100%" }}
                  />
                </div>

                <div>
                  <div style={{ display: "flex", justifyContent: "space-between", fontSize: "0.82rem", marginBottom: "0.25rem" }}>
                    <span>Reserve Factor (Platform Cut):</span>
                    <strong>{curveForm.reserveFactorPct.toFixed(2)}%</strong>
                  </div>
                  <input
                    type="range"
                    min="0"
                    max="30"
                    step="1"
                    value={curveForm.reserveFactorPct}
                    onChange={(e) => setCurveForm((prev) => ({ ...prev, reserveFactorPct: parseFloat(e.target.value) }))}
                    style={{ width: "100%" }}
                  />
                </div>

                <button
                  type="button"
                  onClick={handleStageCurveUpdate}
                  className="workspace-button workspace-button--primary"
                  style={{ width: "100%", marginTop: "0.5rem" }}
                >
                  Review &amp; Apply Curve Updates 🛡️
                </button>
              </div>
            </div>
          </div>
        </section>
      )}

      {/* ── TAB 3: Protocol Fees & Security ── */}
      {activeTab === "fees" && (
        <section className="workspace-stack" style={{ gap: "1rem" }}>
          <div>
            <h2 style={{ fontSize: "1.2rem", fontWeight: 800, margin: 0, color: "var(--fg)" }}>
              Protocol Fees &amp; Security Controls
            </h2>
            <p style={{ fontSize: "0.85rem", color: "var(--fg-muted)", margin: "0.2rem 0 0" }}>
              Configure platform revenue share, flash loan charges, and emergency circuit breakers.
            </p>
          </div>

          <div className="workspace-grid workspace-grid--two" style={{ gap: "1.5rem" }}>
            <div className="workspace-card" style={{ padding: "1.25rem" }}>
              <strong style={{ fontSize: "0.95rem", color: "var(--fg)" }}>Fee Parameters</strong>
              <div style={{ display: "grid", gap: "1rem", marginTop: "1rem" }}>
                <div>
                  <label className="workspace-label">Flash Loan Fee (%)</label>
                  <input
                    type="number"
                    step="0.01"
                    min="0"
                    max="5"
                    value={feesForm.flashLoanFeePct}
                    onChange={(e) => setFeesForm((prev) => ({ ...prev, flashLoanFeePct: parseFloat(e.target.value) || 0 }))}
                    className="workspace-input"
                  />
                  <p className="workspace-hint">Standard DeFi rate is 0.09% (9 bps). Max ceiling: 5.00%</p>
                </div>

                <div>
                  <label className="workspace-label">Platform Fee on Interest (%)</label>
                  <input
                    type="number"
                    step="0.1"
                    min="0"
                    max="10"
                    value={feesForm.platformFeePct}
                    onChange={(e) => setFeesForm((prev) => ({ ...prev, platformFeePct: parseFloat(e.target.value) || 0 }))}
                    className="workspace-input"
                  />
                  <p className="workspace-hint">Portion of loan interest diverted to treasury. Max ceiling: 10.00%</p>
                </div>

                <div>
                  <label className="workspace-label">Price Oracle Address</label>
                  <input
                    type="text"
                    value={state.protocolFees.priceOracleAddress}
                    disabled
                    className="workspace-input"
                    style={{ fontFamily: "monospace", opacity: 0.7 }}
                  />
                </div>
              </div>
            </div>

            <div className="workspace-card" style={{ padding: "1.25rem" }}>
              <strong style={{ fontSize: "0.95rem", color: "var(--fg)" }}>Emergency Circuit Breaker</strong>
              <p style={{ fontSize: "0.82rem", color: "var(--fg-muted)", margin: "0.2rem 0 1rem" }}>
                Instantly pauses all deposit and borrow disbursements on-chain in the event of an anomaly.
              </p>

              <div
                style={{
                  padding: "1rem",
                  borderRadius: "0.75rem",
                  background: feesForm.isPaused ? "color-mix(in srgb, var(--danger) 10%, transparent)" : "color-mix(in srgb, var(--accent) 10%, transparent)",
                  border: feesForm.isPaused ? "1px solid color-mix(in srgb, var(--danger) 30%, transparent)" : "1px solid color-mix(in srgb, var(--accent) 30%, transparent)",
                  marginBottom: "1rem",
                }}
              >
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <div>
                    <strong style={{ color: feesForm.isPaused ? "var(--danger)" : "var(--accent-hover)" }}>
                      {feesForm.isPaused ? "Protocol is Paused" : "Protocol is Active"}
                    </strong>
                    <p style={{ margin: 0, fontSize: "0.75rem", color: "var(--fg-muted)" }}>
                      {feesForm.isPaused ? "New borrowings and withdrawals are frozen" : "Normal loan operations ongoing"}
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => setFeesForm((prev) => ({ ...prev, isPaused: !prev.isPaused }))}
                    style={{
                      padding: "0.4rem 0.8rem",
                      borderRadius: "0.4rem",
                      background: feesForm.isPaused ? "var(--accent)" : "var(--danger)",
                      color: "var(--fg)",
                      border: "none",
                      fontWeight: 700,
                      fontSize: "0.8rem",
                      cursor: "pointer",
                    }}
                  >
                    {feesForm.isPaused ? "Unpause Protocol" : "Trigger Emergency Pause"}
                  </button>
                </div>
              </div>

              <button
                type="button"
                onClick={handleStageFeesUpdate}
                className="workspace-button workspace-button--primary"
                style={{ width: "100%" }}
              >
                Apply Fee &amp; Security Settings 🛡️
              </button>
            </div>
          </div>
        </section>
      )}

      {/* ── TAB 4: Audit & Adjustment Log ── */}
      {activeTab === "audit" && (
        <section className="workspace-stack" style={{ gap: "1rem" }}>
          <div>
            <h2 style={{ fontSize: "1.2rem", fontWeight: 800, margin: 0, color: "var(--fg)" }}>
              Risk Parameters Audit Trail
            </h2>
            <p style={{ fontSize: "0.85rem", color: "var(--fg-muted)", margin: "0.2rem 0 0" }}>
              Immutable record of all risk parameter modifications, administrator signatures, and justifications.
            </p>
          </div>

          <div className="workspace-card" style={{ padding: "0" }}>
            <table style={{ width: "100%", fontSize: "0.85rem", textAlign: "left", borderCollapse: "collapse" }}>
              <thead>
                <tr style={{ color: "var(--fg-muted)", borderBottom: "1px solid color-mix(in srgb, var(--fg) 8%, transparent)", background: "var(--surface-2)" }}>
                  <th style={{ padding: "0.75rem 1rem" }}>Timestamp</th>
                  <th style={{ padding: "0.75rem 1rem" }}>Category</th>
                  <th style={{ padding: "0.75rem 1rem" }}>Target Parameter</th>
                  <th style={{ padding: "0.75rem 1rem" }}>Change (Before → After)</th>
                  <th style={{ padding: "0.75rem 1rem" }}>Admin</th>
                  <th style={{ padding: "0.75rem 1rem" }}>Rationale</th>
                </tr>
              </thead>
              <tbody>
                {state.auditHistory.map((item) => (
                  <tr key={item.id} style={{ borderBottom: "1px solid color-mix(in srgb, var(--fg) 4%, transparent)" }}>
                    <td style={{ padding: "0.75rem 1rem", whiteSpace: "nowrap", color: "var(--fg-muted)", fontSize: "0.78rem" }}>
                      {new Date(item.timestamp).toLocaleString()}
                    </td>
                    <td style={{ padding: "0.75rem 1rem" }}>
                      <span
                        style={{
                          fontSize: "0.7rem",
                          fontWeight: 700,
                          padding: "0.2rem 0.45rem",
                          borderRadius: "9999px",
                          background: "color-mix(in srgb, var(--primary) 10%, transparent)",
                          color: "var(--primary)",
                          textTransform: "uppercase",
                        }}
                      >
                        {item.category.replace("_", " ")}
                      </span>
                    </td>
                    <td style={{ padding: "0.75rem 1rem", fontWeight: 600, color: "var(--fg)" }}>
                      {item.targetName}
                    </td>
                    <td style={{ padding: "0.75rem 1rem", fontSize: "0.8rem", color: "var(--fg)" }}>
                      <span style={{ textDecoration: "line-through", color: "var(--fg-subtle)" }}>{item.previousValue}</span>
                      {" → "}
                      <strong style={{ color: "var(--accent)" }}>{item.newValue}</strong>
                    </td>
                    <td style={{ padding: "0.75rem 1rem", color: "var(--fg-muted)", fontSize: "0.78rem" }}>
                      {item.updatedBy}
                    </td>
                    <td style={{ padding: "0.75rem 1rem", color: "var(--fg)", fontSize: "0.8rem", maxWidth: "250px" }}>
                      {item.reason}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {/* ── MODAL 1: Edit Asset Modal ── */}
      {editingAsset && (
        <div
          role="presentation"
          style={{
            position: "fixed",
            inset: 0,
            zIndex: 1000,
            background: "color-mix(in srgb, var(--fg) 50%, transparent)",
            backdropFilter: "blur(6px)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            padding: "1rem",
          }}
        >
          <div
            className="workspace-card"
            style={{
              maxWidth: "28rem",
              width: "100%",
              boxShadow: "0 25px 60px rgba(0,0,0,0.3)",
            }}
          >
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <h3 style={{ margin: 0, fontSize: "1.15rem", fontWeight: 800 }}>
                Edit {editingAsset.assetSymbol} Risk Parameters
              </h3>
              <button
                type="button"
                onClick={() => setEditingAsset(null)}
                style={{ background: "transparent", border: "none", fontSize: "1.25rem", cursor: "pointer" }}
              >
                ×
              </button>
            </div>

            <div style={{ display: "grid", gap: "0.85rem", marginTop: "1rem" }}>
              <div>
                <label className="workspace-label">Max LTV / Collateral Factor (%)</label>
                <input
                  type="number"
                  step="0.5"
                  min="10"
                  max="95"
                  value={assetForm.collateralFactorPct}
                  onChange={(e) => setAssetForm((prev) => ({ ...prev, collateralFactorPct: parseFloat(e.target.value) || 0 }))}
                  className="workspace-input"
                />
                <p className="workspace-hint">Allowed range: 10.00% to 95.00%</p>
              </div>

              <div>
                <label className="workspace-label">Volatility Buffer (%)</label>
                <input
                  type="number"
                  step="0.5"
                  min="0"
                  max="50"
                  value={assetForm.volatilityPct}
                  onChange={(e) => setAssetForm((prev) => ({ ...prev, volatilityPct: parseFloat(e.target.value) || 0 }))}
                  className="workspace-input"
                />
              </div>

              <div>
                <label className="workspace-label">Liquidation Threshold (%)</label>
                <input
                  type="number"
                  step="0.5"
                  min="10"
                  max="98"
                  value={assetForm.liquidationThresholdPct}
                  onChange={(e) => setAssetForm((prev) => ({ ...prev, liquidationThresholdPct: parseFloat(e.target.value) || 0 }))}
                  className="workspace-input"
                />
                <p className="workspace-hint">Must be greater than or equal to Max LTV</p>
              </div>

              <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", marginTop: "0.25rem" }}>
                <input
                  type="checkbox"
                  id="oracle-check"
                  checked={assetForm.hasPriceOracle}
                  onChange={(e) => setAssetForm((prev) => ({ ...prev, hasPriceOracle: e.target.checked }))}
                />
                <label htmlFor="oracle-check" style={{ fontSize: "0.85rem", color: "var(--fg)", cursor: "pointer" }}>
                  Active Decentralized Price Oracle Feed
                </label>
              </div>

              <div style={{ display: "flex", gap: "0.6rem", marginTop: "0.8rem" }}>
                <button
                  type="button"
                  onClick={() => setEditingAsset(null)}
                  className="workspace-button workspace-button--secondary"
                  style={{ flex: 1 }}
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={handleStageAssetUpdate}
                  className="workspace-button workspace-button--primary"
                  style={{ flex: 1 }}
                >
                  Stage Updates
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── MODAL 2: Secure Execution Confirmation Diff Modal ── */}
      {pendingUpdate && (
        <div
          role="presentation"
          style={{
            position: "fixed",
            inset: 0,
            zIndex: 1000,
            background: "color-mix(in srgb, var(--fg) 55%, transparent)",
            backdropFilter: "blur(6px)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            padding: "1rem",
          }}
        >
          <div
            className="workspace-card"
            style={{
              maxWidth: "34rem",
              width: "100%",
              border: "1px solid color-mix(in srgb, var(--primary) 30%, transparent)",
              boxShadow: "0 30px 80px rgba(0,0,0,0.4)",
            }}
          >
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <div>
                <span style={{ fontSize: "0.75rem", textTransform: "uppercase", letterSpacing: "0.08em", color: "var(--primary)", fontWeight: 700 }}>
                  Security &amp; Authorization Guard
                </span>
                <h3 style={{ margin: "0.2rem 0 0", fontSize: "1.15rem", fontWeight: 800 }}>
                  {pendingUpdate.title}
                </h3>
              </div>
              <button
                type="button"
                onClick={() => setPendingUpdate(null)}
                style={{ background: "transparent", border: "none", fontSize: "1.25rem", cursor: "pointer" }}
              >
                ×
              </button>
            </div>

            <p style={{ fontSize: "0.85rem", color: "var(--fg-muted)", margin: "0.5rem 0 1rem" }}>
              Review the proposed parameter changes below. This action updates protocol risk rules and will be logged permanently in the audit trail.
            </p>

            {/* Parameter Diff Table */}
            <div style={{ background: "var(--surface-2)", borderRadius: "0.75rem", padding: "0.75rem 1rem", border: "1px solid color-mix(in srgb, var(--fg) 6%, transparent)" }}>
              <table style={{ width: "100%", fontSize: "0.82rem", borderCollapse: "collapse" }}>
                <thead>
                  <tr style={{ color: "var(--fg-muted)", borderBottom: "1px solid color-mix(in srgb, var(--fg) 6%, transparent)" }}>
                    <th style={{ textAlign: "left", padding: "0.35rem 0" }}>Parameter</th>
                    <th style={{ textAlign: "left", padding: "0.35rem 0" }}>Current</th>
                    <th style={{ textAlign: "left", padding: "0.35rem 0" }}>New Value</th>
                  </tr>
                </thead>
                <tbody>
                  {pendingUpdate.diffs.map((d, i) => (
                    <tr key={i} style={{ borderBottom: "1px solid color-mix(in srgb, var(--fg) 4%, transparent)" }}>
                      <td style={{ padding: "0.35rem 0", color: "var(--fg)" }}>{d.label}</td>
                      <td style={{ padding: "0.35rem 0", textDecoration: "line-through", color: "var(--fg-subtle)" }}>{d.oldVal}</td>
                      <td style={{ padding: "0.35rem 0", color: "var(--accent)", fontWeight: 700 }}>{d.newVal}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Mandatory Reason Input */}
            <div style={{ marginTop: "1rem" }}>
              <label className="workspace-label">
                Administrative Rationale / Reason <span style={{ color: "var(--danger)" }}>*</span>
              </label>
              <textarea
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder="E.g., Quarterly parameter adjustment based on market volatility analysis..."
                rows={2}
                className="workspace-input"
                style={{ resize: "vertical", fontFamily: "inherit" }}
              />
            </div>

            <div style={{ display: "flex", gap: "0.6rem", marginTop: "1rem" }}>
              <button
                type="button"
                onClick={() => setPendingUpdate(null)}
                disabled={submitting}
                className="workspace-button workspace-button--secondary"
                style={{ flex: 1 }}
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleExecuteUpdate}
                disabled={submitting || reason.trim().length < 5}
                className="workspace-button workspace-button--primary"
                style={{ flex: 1 }}
              >
                {submitting ? "Signing & Executing..." : "Authorize & Execute 🛡️"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
