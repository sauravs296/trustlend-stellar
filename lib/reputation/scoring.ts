/**
 * lib/reputation/scoring.ts
 *
 * Reputation scoring algorithm that evaluates borrowers' on-chain repayment
 * history, calculates credit tiers, and determines discounted interest rates.
 */

import {
  ReputationTier,
  TIER_MAX_LOAN,
  TIER_INTEREST_BPS,
} from "@/types/contracts";

export interface BorrowerRepaymentStats {
  totalLoans: number;
  completedLoans: number;
  onTimeRepayments: number;
  earlyRepayments: number;
  lateRepayments: number;
  defaultedLoans: number;
  totalBorrowedXlm: number;
  totalRepaidXlm: number;
  kycVerified: boolean;
  emailVerified: boolean;
  accountAgeDays?: number;
}

export interface ReputationScoreBreakdown {
  baseScore: number;
  onTimeBonus: number;
  earlyPayoffBonus: number;
  volumeBonus: number;
  kycBonus: number;
  latePenalty: number;
  defaultPenalty: number;
  tenureBonus: number;
}

export interface BorrowerReputationResult {
  score: number;
  tier: ReputationTier;
  tierLabel: string;
  interestRateBps: number;
  interestRatePct: number;
  standardRateBps: number;
  rateDiscountBps: number;
  rateDiscountPct: number;
  maxLoanXlm: number;
  breakdown: ReputationScoreBreakdown;
  onTimePercentage: number;
  nextTier: {
    tier: ReputationTier;
    minScore: number;
    pointsNeeded: number;
    unlockedRatePct: number;
  } | null;
}

// Base Constants
export const BASE_REPUTATION_SCORE = 250;
export const MAX_REPUTATION_SCORE = 1000;
export const MIN_REPUTATION_SCORE = 0;
export const STANDARD_BASE_APR_BPS = 1500; // 15.00% APR standard rate

/**
 * Off-chain tier thresholds on the 0–1000 platform scale (base score 250).
 * This is deliberately NOT the on-chain `scoreToTier` mapping in
 * types/contracts.ts, which works on the contract's raw point scale.
 */
export const OFFCHAIN_TIER_MIN_SCORE: Record<Exclude<ReputationTier, "None">, number> = {
  Beginner: 300,
  Silver: 500,
  Gold: 700,
  Platinum: 850,
};

export function offchainScoreToTier(score: number): ReputationTier {
  if (score >= OFFCHAIN_TIER_MIN_SCORE.Platinum) return "Platinum";
  if (score >= OFFCHAIN_TIER_MIN_SCORE.Gold) return "Gold";
  if (score >= OFFCHAIN_TIER_MIN_SCORE.Silver) return "Silver";
  if (score >= OFFCHAIN_TIER_MIN_SCORE.Beginner) return "Beginner";
  return "None";
}

// Score weights
export const SCORING_WEIGHTS = {
  ON_TIME_LOAN_PTS: 35,          // +35 pts per on-time loan repayment
  EARLY_PAYOFF_PTS: 45,          // +45 pts per early loan payoff
  VOLUME_PER_1000_XLM_PTS: 15,   // +15 pts per 1,000 XLM volume successfully settled
  MAX_VOLUME_BONUS_PTS: 150,     // Max 150 pts from volume
  EMAIL_VERIFIED_PTS: 20,        // +20 pts for email verification
  KYC_ID_VERIFIED_PTS: 80,       // +80 pts for government ID verification
  LATE_PAYMENT_PENALTY_PTS: 25,  // -25 pts per late payment
  DEFAULT_PENALTY_PTS: 150,      // -150 pts per loan default
  MONTHLY_TENURE_PTS: 5,         // +5 pts per 30 days active
  MAX_TENURE_BONUS_PTS: 50,      // Max 50 pts from tenure
};

/**
 * Computes a borrower's reputation score, tier, and discounted interest rate.
 */
export function computeBorrowerReputationScore(
  stats: BorrowerRepaymentStats
): BorrowerReputationResult {
  // 1. Base Score
  const baseScore = BASE_REPUTATION_SCORE;

  // 2. On-Time Repayments
  const onTimeBonus = stats.onTimeRepayments * SCORING_WEIGHTS.ON_TIME_LOAN_PTS;

  // 3. Early Payoffs
  const earlyPayoffBonus = stats.earlyRepayments * SCORING_WEIGHTS.EARLY_PAYOFF_PTS;

  // 4. Repaid Volume Bonus
  const volumeInThousands = Math.floor(stats.totalRepaidXlm / 1000);
  const volumeBonus = Math.min(
    SCORING_WEIGHTS.MAX_VOLUME_BONUS_PTS,
    volumeInThousands * SCORING_WEIGHTS.VOLUME_PER_1000_XLM_PTS
  );

  // 5. KYC & Identity Bonus
  let kycBonus = 0;
  if (stats.emailVerified) kycBonus += SCORING_WEIGHTS.EMAIL_VERIFIED_PTS;
  if (stats.kycVerified) kycBonus += SCORING_WEIGHTS.KYC_ID_VERIFIED_PTS;

  // 6. Account Tenure Bonus
  const tenureMonths = Math.floor((stats.accountAgeDays ?? 0) / 30);
  const tenureBonus = Math.min(
    SCORING_WEIGHTS.MAX_TENURE_BONUS_PTS,
    tenureMonths * SCORING_WEIGHTS.MONTHLY_TENURE_PTS
  );

  // 7. Penalties
  const latePenalty = stats.lateRepayments * SCORING_WEIGHTS.LATE_PAYMENT_PENALTY_PTS;
  const defaultPenalty = stats.defaultedLoans * SCORING_WEIGHTS.DEFAULT_PENALTY_PTS;

  // 8. Total Score Calculation (Clamped 0..1000)
  const rawScore =
    baseScore +
    onTimeBonus +
    earlyPayoffBonus +
    volumeBonus +
    kycBonus +
    tenureBonus -
    latePenalty -
    defaultPenalty;

  const score = Math.max(MIN_REPUTATION_SCORE, Math.min(MAX_REPUTATION_SCORE, Math.round(rawScore)));

  // 9. Tier and Rate Determination
  const tier = offchainScoreToTier(score);
  const interestRateBps = TIER_INTEREST_BPS[tier] ?? STANDARD_BASE_APR_BPS;
  const interestRatePct = Number((interestRateBps / 100).toFixed(2));
  const standardRateBps = STANDARD_BASE_APR_BPS;
  const rateDiscountBps = Math.max(0, standardRateBps - interestRateBps);
  const rateDiscountPct = Number((rateDiscountBps / 100).toFixed(2));

  // Max Loan Limit in XLM
  const maxLoanStroops = TIER_MAX_LOAN[tier] ?? TIER_MAX_LOAN.None;
  const maxLoanXlm = Number(maxLoanStroops / 10_000_000n);

  // On-time percentage calculation
  const totalSettled = stats.completedLoans + stats.defaultedLoans;
  const onTimePercentage =
    totalSettled > 0
      ? Math.round(((stats.onTimeRepayments + stats.earlyRepayments) / totalSettled) * 100)
      : 100;

  // 10. Next Tier Target Calculation
  let nextTier = null;
  if (tier === "None") {
    nextTier = {
      tier: "Beginner" as ReputationTier,
      minScore: 300,
      pointsNeeded: Math.max(0, 300 - score),
      unlockedRatePct: TIER_INTEREST_BPS.Beginner / 100,
    };
  } else if (tier === "Beginner") {
    nextTier = {
      tier: "Silver" as ReputationTier,
      minScore: 500,
      pointsNeeded: Math.max(0, 500 - score),
      unlockedRatePct: TIER_INTEREST_BPS.Silver / 100,
    };
  } else if (tier === "Silver") {
    nextTier = {
      tier: "Gold" as ReputationTier,
      minScore: 700,
      pointsNeeded: Math.max(0, 700 - score),
      unlockedRatePct: TIER_INTEREST_BPS.Gold / 100,
    };
  } else if (tier === "Gold") {
    nextTier = {
      tier: "Platinum" as ReputationTier,
      minScore: 850,
      pointsNeeded: Math.max(0, 850 - score),
      unlockedRatePct: TIER_INTEREST_BPS.Platinum / 100,
    };
  }

  return {
    score,
    tier,
    tierLabel: String(tier),
    interestRateBps,
    interestRatePct,
    standardRateBps,
    rateDiscountBps,
    rateDiscountPct,
    maxLoanXlm,
    breakdown: {
      baseScore,
      onTimeBonus,
      earlyPayoffBonus,
      volumeBonus,
      kycBonus,
      latePenalty,
      defaultPenalty,
      tenureBonus,
    },
    onTimePercentage,
    nextTier,
  };
}
