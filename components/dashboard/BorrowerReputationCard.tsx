"use client";

import { BorrowerReputationResult } from "@/lib/reputation/scoring";
import { formatTokenBalance } from "@/lib/utils/formatting";

interface BorrowerReputationCardProps {
  reputation: BorrowerReputationResult;
  updatedAt?: string | null;
}

const TIER_COLORS: Record<string, { primary: string; bg: string; border: string; glow: string }> = {
  None: {
    primary: "var(--fg-muted)",
    bg: "color-mix(in srgb, var(--fg-muted) 8%, transparent)",
    border: "color-mix(in srgb, var(--fg-muted) 25%, transparent)",
    glow: "color-mix(in srgb, var(--fg-muted) 15%, transparent)",
  },
  Beginner: {
    primary: "var(--warning)",
    bg: "color-mix(in srgb, var(--warning) 8%, transparent)",
    border: "color-mix(in srgb, var(--warning) 25%, transparent)",
    glow: "color-mix(in srgb, var(--warning) 15%, transparent)",
  },
  Silver: {
    primary: "var(--fg-subtle)",
    bg: "color-mix(in srgb, var(--fg-muted) 12%, transparent)",
    border: "color-mix(in srgb, var(--fg-muted) 30%, transparent)",
    glow: "color-mix(in srgb, var(--fg-muted) 20%, transparent)",
  },
  Gold: {
    primary: "var(--warning)",
    bg: "color-mix(in srgb, var(--warning) 10%, transparent)",
    border: "color-mix(in srgb, var(--warning) 35%, transparent)",
    glow: "color-mix(in srgb, var(--warning) 25%, transparent)",
  },
  Platinum: {
    primary: "var(--primary)",
    bg: "color-mix(in srgb, var(--primary) 12%, transparent)",
    border: "color-mix(in srgb, var(--primary) 35%, transparent)",
    glow: "color-mix(in srgb, var(--primary) 25%, transparent)",
  },
};

export function BorrowerReputationCard({
  reputation,
  updatedAt,
}: BorrowerReputationCardProps) {
  const {
    score,
    tier,
    tierLabel,
    interestRatePct,
    rateDiscountPct,
    maxLoanXlm,
    onTimePercentage,
    breakdown,
    nextTier,
  } = reputation;

  const colors = TIER_COLORS[tierLabel] ?? TIER_COLORS.None;
  const scorePct = Math.min(100, Math.max(0, (score / 1000) * 100));

  // Circular gauge parameters
  const radius = 54;
  const circumference = 2 * Math.PI * radius;
  const strokeDashoffset = circumference - (scorePct / 100) * circumference;

  return (
    <article
      className="workspace-card workspace-card--full"
      style={{
        background: "linear-gradient(135deg, color-mix(in srgb, var(--fg) 95%, transparent) 0%, color-mix(in srgb, var(--surface-2) 95%, transparent) 100%)",
        border: `1px solid ${colors.border}`,
        borderRadius: "1rem",
        boxShadow: `0 8px 30px ${colors.glow}`,
        padding: "1.5rem",
      }}
    >
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", flexWrap: "wrap", gap: "1rem" }}>
        <div>
          <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
            <span
              style={{
                fontSize: "0.75rem",
                fontWeight: 700,
                padding: "0.2rem 0.6rem",
                borderRadius: "9999px",
                background: colors.bg,
                color: colors.primary,
                border: `1px solid ${colors.border}`,
                textTransform: "uppercase",
                letterSpacing: "0.05em",
              }}
            >
              ⭐ {tierLabel} Tier
            </span>
            <span
              style={{
                fontSize: "0.72rem",
                color: "var(--accent)",
                background: "var(--success-soft)",
                padding: "0.2rem 0.5rem",
                borderRadius: "9999px",
                fontWeight: 600,
              }}
            >
              🔄 Calculated Daily
            </span>
          </div>
          <h2 style={{ fontSize: "1.35rem", fontWeight: 800, margin: "0.4rem 0 0", color: "var(--fg)" }}>
            Borrower Reputation Score
          </h2>
          <p style={{ fontSize: "0.85rem", color: "var(--fg-muted)", margin: "0.2rem 0 0" }}>
            Your credit score is calculated daily based on on-chain Stellar repayments to unlock better loan rates.
          </p>
        </div>

        {updatedAt && (
          <span style={{ fontSize: "0.75rem", color: "var(--fg-subtle)" }}>
            Last computed: {new Date(updatedAt).toLocaleDateString()}
          </span>
        )}
      </div>

      <hr style={{ margin: "1.25rem 0", borderColor: "color-mix(in srgb, var(--fg) 6%, transparent)" }} />

      {/* ── Main Score & Benefits Section ── */}
      <div style={{ display: "grid", gridTemplateColumns: "auto 1fr", gap: "2rem", alignItems: "center" }}>
        {/* Circular Score Gauge */}
        <div style={{ position: "relative", width: "130px", height: "130px", display: "flex", alignItems: "center", justifyContent: "center" }}>
          <svg width="130" height="130" viewBox="0 0 130 130" style={{ transform: "rotate(-90deg)" }}>
            {/* Background Track */}
            <circle
              cx="65"
              cy="65"
              r={radius}
              fill="transparent"
              stroke="var(--border)"
              strokeWidth="10"
            />
            {/* Progress Stroke */}
            <circle
              cx="65"
              cy="65"
              r={radius}
              fill="transparent"
              stroke={colors.primary}
              strokeWidth="10"
              strokeDasharray={circumference}
              strokeDashoffset={strokeDashoffset}
              strokeLinecap="round"
              style={{ transition: "stroke-dashoffset 0.8s ease" }}
            />
          </svg>
          <div style={{ position: "absolute", textAlign: "center" }}>
            <span style={{ fontSize: "1.85rem", fontWeight: 900, color: "var(--fg)", lineHeight: 1 }}>
              {score}
            </span>
            <span style={{ display: "block", fontSize: "0.68rem", color: "var(--fg-muted)", fontWeight: 600, marginTop: "0.1rem" }}>
              / 1000 PTS
            </span>
          </div>
        </div>

        {/* Unlocked Rate & Credit Limit */}
        <div style={{ display: "grid", gap: "0.75rem" }}>
          {/* Rate Discount Highlight Box */}
          <div
            style={{
              padding: "0.85rem 1.1rem",
              borderRadius: "0.75rem",
              background: "linear-gradient(135deg, color-mix(in srgb, var(--accent) 10%, transparent) 0%, color-mix(in srgb, var(--primary) 8%, transparent) 100%)",
              border: "1px solid color-mix(in srgb, var(--accent) 30%, transparent)",
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              flexWrap: "wrap",
              gap: "0.5rem",
            }}
          >
            <div>
              <div style={{ display: "flex", alignItems: "center", gap: "0.4rem" }}>
                <span style={{ fontSize: "1.1rem" }}>🎉</span>
                <strong style={{ fontSize: "0.95rem", color: "var(--fg)" }}>
                  Your Unlocked Borrow Rate: {interestRatePct.toFixed(2)}% APR
                </strong>
              </div>
              <p style={{ margin: "0.15rem 0 0 1.5rem", fontSize: "0.78rem", color: "var(--accent-hover)", fontWeight: 600 }}>
                {rateDiscountPct > 0
                  ? `⚡ Includes ${rateDiscountPct.toFixed(2)}% APR Repayment Discount (Standard: 15.00%)`
                  : "Maintain on-time repayments to unlock up to 7.00% APR interest discount"}
              </p>
            </div>

            <div style={{ textAlign: "right" }}>
              <span style={{ fontSize: "0.7rem", color: "var(--fg-muted)", textTransform: "uppercase", fontWeight: 600 }}>
                Max Credit Limit
              </span>
              <p style={{ margin: 0, fontSize: "1.1rem", fontWeight: 800, color: "var(--primary)" }}>
                {formatTokenBalance(maxLoanXlm)}
              </p>
            </div>
          </div>

          {/* Next Tier Upgrade Milestone */}
          {nextTier && (
            <div
              style={{
                padding: "0.65rem 0.9rem",
                borderRadius: "0.6rem",
                background: "color-mix(in srgb, var(--primary) 4%, transparent)",
                border: "1px solid color-mix(in srgb, var(--primary) 15%, transparent)",
                fontSize: "0.8rem",
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
              }}
            >
              <span style={{ color: "var(--fg)" }}>
                🎯 Earn <strong>{nextTier.pointsNeeded} more points</strong> to unlock <strong>{nextTier.tier} Tier</strong> ({nextTier.unlockedRatePct.toFixed(2)}% APR rate).
              </span>
              <span style={{ fontWeight: 700, color: "var(--primary)", whiteSpace: "nowrap" }}>
                {nextTier.minScore} pts needed
              </span>
            </div>
          )}
        </div>
      </div>

      {/* ── Score Performance & Breakdown Matrix ── */}
      <div
        style={{
          marginTop: "1.25rem",
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))",
          gap: "0.75rem",
        }}
      >
        <div style={{ padding: "0.75rem", borderRadius: "0.6rem", background: "color-mix(in srgb, var(--fg) 2%, transparent)", border: "1px solid color-mix(in srgb, var(--fg) 6%, transparent)" }}>
          <span style={{ fontSize: "0.72rem", color: "var(--fg-muted)", textTransform: "uppercase", fontWeight: 600 }}>
            On-Time Settlement Rate
          </span>
          <p style={{ margin: "0.2rem 0 0", fontSize: "1.1rem", fontWeight: 800, color: onTimePercentage >= 90 ? "var(--accent)" : "var(--warning)" }}>
            {onTimePercentage}%
          </p>
          <span style={{ fontSize: "0.72rem", color: "var(--accent)", fontWeight: 600 }}>
            +{breakdown.onTimeBonus + breakdown.earlyPayoffBonus} pts earned
          </span>
        </div>

        <div style={{ padding: "0.75rem", borderRadius: "0.6rem", background: "color-mix(in srgb, var(--fg) 2%, transparent)", border: "1px solid color-mix(in srgb, var(--fg) 6%, transparent)" }}>
          <span style={{ fontSize: "0.72rem", color: "var(--fg-muted)", textTransform: "uppercase", fontWeight: 600 }}>
            Repaid Volume Bonus
          </span>
          <p style={{ margin: "0.2rem 0 0", fontSize: "1.1rem", fontWeight: 800, color: "var(--primary)" }}>
            +{breakdown.volumeBonus} pts
          </p>
          <span style={{ fontSize: "0.72rem", color: "var(--fg-muted)" }}>
            Based on settled loan volume
          </span>
        </div>

        <div style={{ padding: "0.75rem", borderRadius: "0.6rem", background: "color-mix(in srgb, var(--fg) 2%, transparent)", border: "1px solid color-mix(in srgb, var(--fg) 6%, transparent)" }}>
          <span style={{ fontSize: "0.72rem", color: "var(--fg-muted)", textTransform: "uppercase", fontWeight: 600 }}>
            KYC &amp; Identity Standing
          </span>
          <p style={{ margin: "0.2rem 0 0", fontSize: "1.1rem", fontWeight: 800, color: breakdown.kycBonus > 0 ? "var(--accent)" : "var(--fg-muted)" }}>
            +{breakdown.kycBonus} pts
          </p>
          <span style={{ fontSize: "0.72rem", color: "var(--fg-muted)" }}>
            Government ID &amp; Email verified
          </span>
        </div>

        <div style={{ padding: "0.75rem", borderRadius: "0.6rem", background: "color-mix(in srgb, var(--fg) 2%, transparent)", border: "1px solid color-mix(in srgb, var(--fg) 6%, transparent)" }}>
          <span style={{ fontSize: "0.72rem", color: "var(--fg-muted)", textTransform: "uppercase", fontWeight: 600 }}>
            Deductions &amp; Penalties
          </span>
          <p style={{ margin: "0.2rem 0 0", fontSize: "1.1rem", fontWeight: 800, color: breakdown.latePenalty + breakdown.defaultPenalty > 0 ? "var(--danger)" : "var(--accent)" }}>
            -{breakdown.latePenalty + breakdown.defaultPenalty} pts
          </p>
          <span style={{ fontSize: "0.72rem", color: "var(--fg-muted)" }}>
            {breakdown.latePenalty + breakdown.defaultPenalty === 0 ? "Clean track record" : "Late payments / defaults"}
          </span>
        </div>
      </div>
    </article>
  );
}
