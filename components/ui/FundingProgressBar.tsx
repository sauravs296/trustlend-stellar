import { formatFundingPercent, getFundingProgress } from "@/lib/loans/funding";

interface FundingProgressBarProps {
  principalAmount: number | string | null | undefined;
  fundedAmount: number | string | null | undefined;
  /** Number of lenders who have contributed so far. Hidden when omitted. */
  lenderCount?: number;
  /** Renders the "x.xx / y.yy XLM" line under the bar. */
  showAmounts?: boolean;
  /** Compact variant for table cells. */
  compact?: boolean;
}

/**
 * Funding progress for a partially fillable loan (Issue #269).
 *
 * Green once the loan is fully funded and ready to activate, purple while it is
 * still collecting contributions.
 */
export function FundingProgressBar({
  principalAmount,
  fundedAmount,
  lenderCount,
  showAmounts = true,
  compact = false,
}: FundingProgressBarProps) {
  const progress = getFundingProgress(principalAmount, fundedAmount);
  const accent = progress.isFullyFunded ? "var(--accent)" : "var(--primary)";
  const percentLabel = formatFundingPercent(progress.percent);

  return (
    <div style={{ minWidth: compact ? "7rem" : "10rem" }}>
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "baseline",
          gap: "0.5rem",
          marginBottom: "0.3rem",
        }}
      >
        <span
          style={{
            fontSize: compact ? "0.75rem" : "0.8rem",
            fontWeight: 700,
            color: accent,
          }}
        >
          {percentLabel} funded
        </span>
        {typeof lenderCount === "number" && lenderCount > 0 && (
          <span style={{ fontSize: "0.7rem", opacity: 0.6, color: "var(--fg)" }}>
            {lenderCount} lender{lenderCount === 1 ? "" : "s"}
          </span>
        )}
      </div>

      <div
        role="progressbar"
        aria-valuenow={Math.round(progress.percent)}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label={`Loan funding progress: ${percentLabel} funded`}
        style={{
          height: compact ? "0.4rem" : "0.5rem",
          width: "100%",
          borderRadius: "9999px",
          background: "color-mix(in srgb, var(--fg) 8%, transparent)",
          overflow: "hidden",
        }}
      >
        <div
          style={{
            height: "100%",
            width: `${progress.percent}%`,
            borderRadius: "9999px",
            background: progress.isFullyFunded
              ? "linear-gradient(90deg, var(--accent) 0%, var(--accent) 100%)"
              : "linear-gradient(90deg, var(--primary) 0%, var(--primary-muted) 100%)",
            transition: "width 0.4s ease",
          }}
        />
      </div>

      {showAmounts && (
        <p
          style={{
            margin: "0.3rem 0 0",
            fontSize: compact ? "0.68rem" : "0.72rem",
            color: "var(--fg-muted)",
            whiteSpace: "nowrap",
          }}
        >
          {progress.funded.toFixed(2)} / {progress.principal.toFixed(2)} XLM
          {!progress.isFullyFunded && (
            <span style={{ opacity: 0.75 }}>
              {" "}
              &middot; {progress.remaining.toFixed(2)} left
            </span>
          )}
        </p>
      )}
    </div>
  );
}
