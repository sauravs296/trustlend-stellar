import { describe, expect, it } from "vitest";
import {
  borrowingSteps,
  healthFactorBands,
  liquidationFacts,
  liquidationThresholdRules,
  liquidationExample,
  avoidLiquidationTips,
  borrowingFaq,
  faqCategories,
  BASE_LIQUIDATION_THRESHOLD_BPS,
  DEFAULT_COLLATERAL_FACTOR_BPS,
  MIN_LIQUIDATION_THRESHOLD_BPS,
  MAX_LIQUIDATION_THRESHOLD_BPS,
  DEFAULT_GRACE_PERIOD_DAYS,
  RATE_SWITCH_FEE_BPS,
} from "@/lib/content/borrowing-guide";
import {
  HF_SAFE_THRESHOLD,
  HF_WARNING_THRESHOLD,
} from "@/lib/dashboard/health-factor";
import { RATE_SWITCH_FEE_BPS as SOURCE_RATE_SWITCH_FEE_BPS } from "@/lib/dashboard/interest-rates";

describe("borrowing guide — protocol constants stay in sync", () => {
  // These mirror values that live in the Soroban contract. If a constant
  // changes there, this file must change too — the assertions below pin the
  // documented numbers so a silent drift shows up as a test failure.
  it("matches the contract's collateral factor and threshold defaults", () => {
    expect(DEFAULT_COLLATERAL_FACTOR_BPS).toBe(7500);
    expect(BASE_LIQUIDATION_THRESHOLD_BPS).toBe(7500);
    expect(MIN_LIQUIDATION_THRESHOLD_BPS).toBe(5000);
    expect(MAX_LIQUIDATION_THRESHOLD_BPS).toBe(9000);
  });

  it("re-exports the rate-switch fee from the module that owns it", () => {
    expect(RATE_SWITCH_FEE_BPS).toBe(SOURCE_RATE_SWITCH_FEE_BPS);
  });

  it("keeps the threshold clamp bounds ordered around the base", () => {
    expect(MIN_LIQUIDATION_THRESHOLD_BPS).toBeLessThan(BASE_LIQUIDATION_THRESHOLD_BPS);
    expect(MAX_LIQUIDATION_THRESHOLD_BPS).toBeGreaterThan(BASE_LIQUIDATION_THRESHOLD_BPS);
  });

  it("documents a positive grace period", () => {
    expect(DEFAULT_GRACE_PERIOD_DAYS).toBeGreaterThan(0);
  });
});

describe("borrowing steps (acceptance: covers step-by-step process)", () => {
  it("documents the full lifecycle from signup to repayment", () => {
    expect(borrowingSteps.length).toBeGreaterThanOrEqual(5);
  });

  it("numbers steps consecutively from 01", () => {
    borrowingSteps.forEach((step, i) => {
      expect(step.step).toBe(String(i + 1).padStart(2, "0"));
    });
  });

  it("gives every step a title, description and concrete details", () => {
    for (const step of borrowingSteps) {
      expect(step.title.trim(), `${step.step} title`).not.toBe("");
      expect(step.description.trim(), `${step.step} description`).not.toBe("");
      expect(step.details.length, `${step.step} details`).toBeGreaterThan(0);
      for (const detail of step.details) {
        expect(detail.trim()).not.toBe("");
      }
    }
  });

  it("pairs every in-app link with a label", () => {
    for (const step of borrowingSteps) {
      if (step.href) {
        expect(step.hrefLabel, `${step.step} hrefLabel`).toBeTruthy();
        expect(step.href.startsWith("/"), `${step.step} href is relative`).toBe(true);
      }
    }
  });

  it("covers collateral, funding and repayment across the process", () => {
    const all = borrowingSteps
      .flatMap((s) => [s.title, s.description, ...s.details])
      .join(" ")
      .toLowerCase();
    expect(all).toContain("collateral");
    expect(all).toContain("repay");
    expect(all).toContain("wallet");
  });
});

describe("liquidation content (acceptance: explains liquidation risks clearly)", () => {
  it("states that liquidation is automatic and unannounced", () => {
    const text = liquidationFacts.join(" ").toLowerCase();
    expect(text).toContain("automatic");
    // The borrower must not be left assuming they will be warned first.
    expect(text).toContain("warned");
  });

  it("explains that liquidation is price-driven, not payment-driven", () => {
    const text = liquidationFacts.join(" ").toLowerCase();
    expect(text).toMatch(/not yet due|not by missing a payment/);
  });

  it("explains how the personal threshold is derived", () => {
    const text = liquidationThresholdRules.join(" ").toLowerCase();
    expect(text).toContain("reputation");
    expect(text).toContain("volatility");
    // Both clamp bounds must be quoted so the range is unambiguous.
    expect(text).toContain(String(MIN_LIQUIDATION_THRESHOLD_BPS / 100));
    expect(text).toContain(String(MAX_LIQUIDATION_THRESHOLD_BPS / 100));
  });

  it("provides a worked example with a stated takeaway", () => {
    expect(liquidationExample.narrative.trim()).not.toBe("");
    expect(liquidationExample.takeaway.trim()).not.toBe("");
    // The example is only useful if the LTV rises without new borrowing.
    expect(liquidationExample.narrative.toLowerCase()).toContain("ltv");
  });

  it("offers actionable ways to avoid liquidation", () => {
    expect(avoidLiquidationTips.length).toBeGreaterThanOrEqual(3);
    const text = avoidLiquidationTips.join(" ").toLowerCase();
    // The two real levers: add collateral, or reduce debt.
    expect(text).toContain("add collateral");
    expect(text).toContain("repay");
  });
});

describe("health factor bands", () => {
  it("covers the safe, warning and critical zones", () => {
    expect(healthFactorBands).toHaveLength(3);
    const statuses = healthFactorBands.map((b) => b.status.toLowerCase());
    expect(statuses.some((s) => s.includes("safe"))).toBe(true);
    expect(statuses.some((s) => s.includes("warning"))).toBe(true);
    expect(statuses.some((s) => s.includes("critical"))).toBe(true);
  });

  it("quotes the thresholds that health-factor.ts actually uses", () => {
    const ranges = healthFactorBands.map((b) => b.range).join(" ");
    expect(ranges).toContain(HF_SAFE_THRESHOLD.toFixed(1));
    expect(ranges).toContain(HF_WARNING_THRESHOLD.toFixed(1));
  });

  it("tells the borrower what to do in every band", () => {
    for (const band of healthFactorBands) {
      expect(band.meaning.trim(), `${band.status} meaning`).not.toBe("");
      expect(band.action.trim(), `${band.status} action`).not.toBe("");
      // Colours are theme tokens so the bands follow light/dark mode.
      expect(band.color).toMatch(/^var\(--[a-z-]+\)$/);
    }
  });
});

describe("borrowing FAQ", () => {
  it("answers a meaningful number of questions", () => {
    expect(borrowingFaq.length).toBeGreaterThanOrEqual(10);
  });

  it("gives every entry a question and a non-trivial answer", () => {
    for (const entry of borrowingFaq) {
      expect(entry.question.trim().endsWith("?"), entry.question).toBe(true);
      expect(entry.answer.trim().length, entry.question).toBeGreaterThan(40);
    }
  });

  it("has no duplicate questions", () => {
    const seen = new Set(borrowingFaq.map((f) => f.question.toLowerCase()));
    expect(seen.size).toBe(borrowingFaq.length);
  });

  it("assigns every entry to a rendered category", () => {
    for (const entry of borrowingFaq) {
      expect(faqCategories, entry.question).toContain(entry.category);
    }
  });

  it("renders every category — no empty headings", () => {
    for (const category of faqCategories) {
      const count = borrowingFaq.filter((f) => f.category === category).length;
      expect(count, `category ${category}`).toBeGreaterThan(0);
    }
  });

  it("addresses the liquidation questions a borrower is most likely to have", () => {
    const questions = borrowingFaq.map((f) => f.question.toLowerCase()).join(" ");
    expect(questions).toContain("liquidat");
    // Must directly answer "can this happen even if I'm paying on time?"
    expect(questions).toMatch(/never missed a payment|even if/);
  });

  it("states that quoted rates are APR rather than APY", () => {
    const rateEntry = borrowingFaq.find((f) =>
      f.question.toLowerCase().includes("apr or apy")
    );
    expect(rateEntry).toBeDefined();
    expect(rateEntry!.answer).toContain("simple interest");
  });
});
