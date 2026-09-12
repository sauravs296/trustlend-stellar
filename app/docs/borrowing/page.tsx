import Link from "next/link";
import type { Metadata } from "next";
import { TermTooltip } from "@/components/ui/TermTooltip";
import {
  borrowingSteps,
  healthFactorBands,
  liquidationFacts,
  liquidationThresholdRules,
  liquidationExample,
  avoidLiquidationTips,
  borrowingFaq,
  faqCategories,
  HF_SAFE_THRESHOLD,
  HF_WARNING_THRESHOLD,
} from "@/lib/content/borrowing-guide";

export const metadata: Metadata = {
  title: "Borrowing Guide & FAQ | TrustLend",
  description:
    "How collateralized borrowing works on TrustLend: the step-by-step process, how liquidation is triggered, and answers to the questions borrowers ask most.",
};

/**
 * /docs/borrowing — User guide and FAQ for collateralized borrowing (Issue #265).
 *
 * A public page (no auth), because prospective borrowers need to understand the
 * risks *before* they sign up. All copy lives in `lib/content/borrowing-guide`
 * so the numbers can be kept in step with the contract and unit-tested.
 */
export default function BorrowingGuidePage() {
  return (
    <main className="docs-page">
      {/* ── Header ─────────────────────────────────────────────────── */}
      <header className="docs-hero">
        <div className="docs-container">
          <nav aria-label="Breadcrumb" className="docs-breadcrumb">
            <Link href="/">Home</Link>
            <span aria-hidden="true">/</span>
            <span>Borrowing Guide</span>
          </nav>
          <p className="docs-eyebrow">User Guide</p>
          <h1 className="docs-title">How borrowing works on TrustLend</h1>
          <p className="docs-lede">
            TrustLend lets you borrow against collateral you lock up front. This guide
            walks through the whole process, explains exactly how liquidation is
            triggered, and answers the questions borrowers ask most.
          </p>

          {/* Risk callout, deliberately above the fold. */}
          <aside className="docs-callout docs-callout--warning" role="note">
            <p className="docs-callout__title">
              <span aria-hidden="true">⚠️</span> Read this before you borrow
            </p>
            <p>
              Borrowing against collateral means you can lose that collateral. If the
              value of your collateral falls far enough relative to your debt, an
              automated keeper liquidates your position — without warning, and
              regardless of whether your payments are up to date.{" "}
              <a href="#liquidation">Jump to the liquidation section.</a>
            </p>
          </aside>
        </div>
      </header>

      <div className="docs-container docs-body">
        {/* ── Table of contents ───────────────────────────────────── */}
        <nav className="docs-toc" aria-label="On this page">
          <p className="docs-toc__title">On this page</p>
          <ol>
            <li><a href="#process">The borrowing process</a></li>
            <li><a href="#liquidation">Liquidation: how it works</a></li>
            <li><a href="#health-factor">Reading your Health Factor</a></li>
            <li><a href="#avoiding">Avoiding liquidation</a></li>
            <li><a href="#faq">Frequently asked questions</a></li>
          </ol>
        </nav>

        {/* ── Step-by-step process ────────────────────────────────── */}
        <section id="process" className="docs-section" aria-labelledby="process-heading">
          <h2 id="process-heading" className="docs-h2">The borrowing process</h2>
          <p className="docs-intro">
            Six stages, from creating an account to releasing your collateral.
          </p>

          <ol className="docs-steps">
            {borrowingSteps.map((item) => (
              <li key={item.step} className="docs-step">
                <div className="docs-step__marker" aria-hidden="true">{item.step}</div>
                <div className="docs-step__content">
                  <h3 className="docs-step__title">{item.title}</h3>
                  <p className="docs-step__desc">{item.description}</p>
                  <ul className="docs-step__details">
                    {item.details.map((detail) => (
                      <li key={detail}>{detail}</li>
                    ))}
                  </ul>
                  {item.href && (
                    <Link href={item.href} className="docs-step__link">
                      {item.hrefLabel} <span aria-hidden="true">→</span>
                    </Link>
                  )}
                </div>
              </li>
            ))}
          </ol>
        </section>

        {/* ── Liquidation ─────────────────────────────────────────── */}
        <section id="liquidation" className="docs-section" aria-labelledby="liquidation-heading">
          <h2 id="liquidation-heading" className="docs-h2">Liquidation: how it works</h2>
          <p className="docs-intro">
            Liquidation is the single biggest risk of collateralized borrowing. This
            is exactly how it is triggered on TrustLend.
          </p>

          <div className="docs-facts">
            {liquidationFacts.map((fact) => (
              <p key={fact} className="docs-fact">
                <span className="docs-fact__bullet" aria-hidden="true" />
                {fact}
              </p>
            ))}
          </div>

          {/* Threshold rules */}
          <h3 className="docs-h3">How your liquidation threshold is set</h3>
          <p className="docs-intro">
            Your threshold is not a flat number — the contract calculates one for you
            from your reputation and the volatility of your collateral.
          </p>
          <ul className="docs-list">
            {liquidationThresholdRules.map((rule) => (
              <li key={rule}>{rule}</li>
            ))}
          </ul>

          {/* Worked example */}
          <h3 className="docs-h3">A worked example</h3>
          <div className="docs-example">
            <dl className="docs-example__figures">
              <div>
                <dt>{liquidationExample.collateralLabel}</dt>
                <dd>{liquidationExample.collateralValue}</dd>
              </div>
              <div>
                <dt>{liquidationExample.borrowedLabel}</dt>
                <dd>{liquidationExample.borrowedValue}</dd>
              </div>
              <div>
                <dt>
                  <span className="term-tooltip">
                    {liquidationExample.ltvLabel}
                    <TermTooltip term="LTV" side="top" />
                  </span>
                </dt>
                <dd>{liquidationExample.ltvValue}</dd>
              </div>
              <div>
                <dt>
                  <span className="term-tooltip">
                    {liquidationExample.thresholdLabel}
                    <TermTooltip term="LIQUIDATION_THRESHOLD" side="top" />
                  </span>
                </dt>
                <dd className="docs-example__threshold">
                  {liquidationExample.thresholdValue}
                </dd>
              </div>
            </dl>
            <p className="docs-example__narrative">{liquidationExample.narrative}</p>
            <p className="docs-example__takeaway">
              <strong>The point:</strong> {liquidationExample.takeaway}
            </p>
          </div>
        </section>

        {/* ── Health factor bands ─────────────────────────────────── */}
        <section id="health-factor" className="docs-section" aria-labelledby="hf-heading">
          <h2 id="hf-heading" className="docs-h2">Reading your Health Factor</h2>
          <p className="docs-intro">
            Your borrower dashboard shows a{" "}
            <span className="term-tooltip">
              Health Factor
              <TermTooltip term="HEALTH_FACTOR" side="top" />
            </span>{" "}
            gauge. It is the fastest way to see how close you are to liquidation:
            collateral value divided by outstanding debt. Below 1.0 your position is
            under-collateralized.
          </p>

          <div className="docs-table-wrap">
            <table className="docs-table">
              <caption className="docs-table__caption">
                Health Factor bands and what to do in each
              </caption>
              <thead>
                <tr>
                  <th scope="col">Health Factor</th>
                  <th scope="col">Status</th>
                  <th scope="col">What it means</th>
                  <th scope="col">What to do</th>
                </tr>
              </thead>
              <tbody>
                {healthFactorBands.map((band) => (
                  <tr key={band.status}>
                    <th scope="row" className="docs-table__range">{band.range}</th>
                    <td>
                      <span
                        className="docs-status"
                        style={{
                          color: band.color,
                          background: `color-mix(in srgb, ${band.color} 10%, transparent)`,
                          borderColor: `color-mix(in srgb, ${band.color} 27%, transparent)`,
                        }}
                      >
                        {band.status}
                      </span>
                    </td>
                    <td>{band.meaning}</td>
                    <td>{band.action}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <p className="docs-note">
            Aim to stay above {HF_SAFE_THRESHOLD}. Anything between{" "}
            {HF_WARNING_THRESHOLD} and {HF_SAFE_THRESHOLD} means your buffer is thin
            enough that a single bad day in the market could liquidate you.
          </p>
        </section>

        {/* ── Avoiding liquidation ────────────────────────────────── */}
        <section id="avoiding" className="docs-section" aria-labelledby="avoiding-heading">
          <h2 id="avoiding-heading" className="docs-h2">Avoiding liquidation</h2>
          <ul className="docs-tips">
            {avoidLiquidationTips.map((tip) => (
              <li key={tip}>
                <span className="docs-tips__check" aria-hidden="true">✓</span>
                {tip}
              </li>
            ))}
          </ul>
        </section>

        {/* ── FAQ ─────────────────────────────────────────────────── */}
        <section id="faq" className="docs-section" aria-labelledby="faq-heading">
          <h2 id="faq-heading" className="docs-h2">Frequently asked questions</h2>

          {faqCategories.map((category) => {
            const entries = borrowingFaq.filter((f) => f.category === category);
            if (entries.length === 0) return null;
            return (
              <div key={category} className="docs-faq-group">
                <h3 className="docs-h3">{category}</h3>
                {entries.map((entry) => (
                  // <details> gives native keyboard support and works without JS.
                  <details key={entry.question} className="docs-faq">
                    <summary className="docs-faq__q">{entry.question}</summary>
                    <p className="docs-faq__a">{entry.answer}</p>
                  </details>
                ))}
              </div>
            );
          })}
        </section>

        {/* ── Footer CTA ──────────────────────────────────────────── */}
        <footer className="docs-footer">
          <p className="docs-footer__text">
            Ready to borrow, or want to check an existing position?
          </p>
          <div className="docs-footer__actions">
            <Link href="/dashboard/borrower/loans" className="docs-btn docs-btn--primary">
              Apply for a loan
            </Link>
            <Link href="/dashboard/borrower" className="docs-btn">
              Borrower dashboard
            </Link>
          </div>
        </footer>
      </div>
    </main>
  );
}
