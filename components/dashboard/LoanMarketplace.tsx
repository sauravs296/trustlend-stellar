"use client";

import { Fragment, useState } from "react";
import { DirectFundForm } from "./DirectFundForm";
import { FundingProgressBar } from "@/components/ui/FundingProgressBar";
import { TermTooltip } from "@/components/ui/TermTooltip";
import { getFundingProgress } from "@/lib/loans/funding";

interface MarketplaceLoan {
  id: string;
  principal_amount: number;
  /** Total contributed by all lenders so far (Issue #269). */
  funded_amount?: number;
  /** Lenders who have already taken a slice of this loan. */
  lender_count?: number;
  apr_bps: number;
  duration_days: number;
  trust_score: number;
  borrower_name: string;
  borrower_wallet: string;
  onchain_loan_id?: number | null;
}

interface LoanMarketplaceProps {
  loans: MarketplaceLoan[];
  lenderWallet: string | null;
  emptyStateTitle?: string;
  emptyStateDescription?: string;
}

function TrustBadge({ score }: { score: number }) {
  const color =
    score >= 200 ? "var(--accent)" :
    score >= 100 ? "var(--warning)" :
    "var(--danger)";
  const label =
    score >= 200 ? "Good" :
    score >= 100 ? "Fair" :
    "Risk";

  return (
    <span
      title={`Trust score: ${score}/750`}
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: "0.3rem",
        padding: "0.2rem 0.6rem",
        borderRadius: "9999px",
        fontSize: "0.75rem",
        fontWeight: 700,
        background: `color-mix(in srgb, ${color} 10%, transparent)`,
        color,
        border: `1px solid color-mix(in srgb, ${color} 27%, transparent)`,
        whiteSpace: "nowrap",
      }}
    >
      {label} {score}
    </span>
  );
}

export function LoanMarketplace({
  loans,
  lenderWallet: _lenderWallet,
  emptyStateTitle = "All loans are funded!",
  emptyStateDescription = "No open loan requests right now. Check back soon.",
}: LoanMarketplaceProps) {
  const [expandedId, setExpandedId] = useState<string | null>(null);

  if (loans.length === 0) {
    return (
      <div
        style={{
          textAlign: "center",
          padding: "2rem",
          opacity: 0.55,
          border: "1px dashed color-mix(in srgb, var(--fg) 10%, transparent)",
          borderRadius: "0.75rem",
        }}
      >
        <p style={{ fontSize: "1.1rem", marginBottom: "0.5rem" }}>{emptyStateTitle}</p>
        <p style={{ fontSize: "0.85rem" }}>{emptyStateDescription}</p>
      </div>
    );
  }

  return (
    <div className="workspace-table-wrap">
      <table className="workspace-table" aria-label="Open loan requests marketplace">
        <thead>
          <tr>
            <th>Loan ID</th>
            <th>Borrower</th>
            <th>
              <span className="term-tooltip">
                Trust Score
                <TermTooltip term="TRUST_SCORE" side="top" />
              </span>
            </th>
            <th>Amount</th>
            <th>Funding Progress</th>
            <th>
              <span className="term-tooltip">
                APR
                <TermTooltip term="APR" side="top" />
              </span>
            </th>
            <th>Duration</th>
            <th>Est. Return (max)</th>
            <th>Action</th>
          </tr>
        </thead>
        <tbody>
          {loans.map((loan) => {
            const progress = getFundingProgress(
              loan.principal_amount,
              loan.funded_amount ?? 0
            );
            // Estimated return is quoted on the slice still available, since
            // that is the most a lender can take on this loan right now.
            const interestXlm = (
              (progress.remaining * (loan.apr_bps / 10000) * loan.duration_days) / 365
            ).toFixed(2);
            const isExpanded = expandedId === loan.id;
            const hasWallet = Boolean(loan.borrower_wallet);

            return (
              <Fragment key={loan.id}>
                <tr
                  style={{
                    background: isExpanded ? "color-mix(in srgb, var(--primary) 6%, transparent)" : undefined,
                    transition: "all 0.25s ease",
                    cursor: hasWallet ? "pointer" : "default",
                  }}
                  onClick={() => hasWallet && setExpandedId(isExpanded ? null : loan.id)}
                >
                  <td style={{ fontFamily: "monospace", fontSize: "0.82rem", color: "var(--fg-muted)" }}>
                    {loan.id.slice(0, 8)}
                  </td>
                  <td style={{ fontWeight: 600, color: "var(--fg)" }}>{loan.borrower_name}</td>
                  <td><TrustBadge score={loan.trust_score} /></td>
                  <td>
                    <strong style={{ fontSize: "1rem", color: "var(--fg)" }}>
                      {loan.principal_amount.toFixed(2)}
                    </strong>{" "}
                    <span style={{ fontSize: "0.75rem", opacity: 0.6, color: "var(--fg)" }}>XLM</span>
                  </td>
                  <td>
                    <FundingProgressBar
                      principalAmount={loan.principal_amount}
                      fundedAmount={loan.funded_amount ?? 0}
                      lenderCount={loan.lender_count}
                      compact
                    />
                  </td>
                  <td style={{ fontWeight: 600, color: "var(--fg)" }}>
                    {(loan.apr_bps / 100).toFixed(2)}%
                  </td>
                  <td style={{ color: "var(--fg)" }}>{loan.duration_days} days</td>
                  <td style={{ color: "var(--accent)", fontWeight: 700 }}>
                    +{interestXlm} <span style={{ fontSize: "0.7rem", opacity: 0.8 }}>XLM</span>
                  </td>
                  <td>
                    {!hasWallet ? (
                      <span
                        style={{ fontSize: "0.75rem", color: "var(--warning)", opacity: 0.9, fontWeight: 600 }}
                        title="Borrower has not connected a Stellar wallet yet"
                      >
                        No wallet
                      </span>
                    ) : (
                      <button
                        className="workspace-button workspace-button--primary"
                        style={{
                          fontSize: "0.75rem",
                          padding: "0.4rem 1rem",
                          height: "auto",
                          whiteSpace: "nowrap",
                        }}
                      >
                        {isExpanded
                          ? "Close"
                          : progress.isPartiallyFunded
                            ? "Top up ->"
                            : "Fund ->"}
                      </button>
                    )}
                  </td>
                </tr>

                {isExpanded && (
                  <tr>
                    <td
                      colSpan={9}
                      style={{
                        padding: "1.5rem 1rem",
                        background: "var(--surface-2)",
                        borderBottom: "1px solid color-mix(in srgb, var(--primary) 15%, transparent)",
                        borderTop: "1px solid color-mix(in srgb, var(--primary) 10%, transparent)",
                      }}
                    >
                      <div style={{ animation: "fadeInUp 0.3s ease-out" }}>
                        <DirectFundForm
                          loan={{
                            id: loan.id,
                            principal_amount: loan.principal_amount,
                            funded_amount: loan.funded_amount ?? 0,
                            lender_count: loan.lender_count,
                            apr_bps: loan.apr_bps,
                            duration_days: loan.duration_days,
                            trust_score: loan.trust_score,
                            borrower_wallet: loan.borrower_wallet,
                            onchain_loan_id: loan.onchain_loan_id ?? null,
                          }}
                          onClose={() => setExpandedId(null)}
                        />
                      </div>
                    </td>
                  </tr>
                )}
              </Fragment>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
