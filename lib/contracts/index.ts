/**
 * lib/contracts/index.ts
 *
 * Barrel export for all TrustLend contract clients.
 */

export * as ReputationContract from "./reputation";
export * as EscrowContract from "./escrow";
export * as LendingContract from "./lending";
export * as DefaultContract from "./default";
export * as GovernanceContract from "./governance";
export * as MultiSigAdminContract from "./multisig-admin";
export * as PooledLendingContract from "./pooled-lending";
export * as TreasuryContract from "./treasury";
export * as BorrowerLoyaltyContract from "./borrower-loyalty";
export * as ReferralRewardsContract from "./referral-rewards";
export * as AutoCompoundVaultContract from "./auto-compound-vault";
export * as LiquidationAuctionContract from "./liquidation-auction";
export * as UsdcLendingPoolContract from "./usdc-lending-pool";
export * as ZkCreditVerifierContract from "./zk-credit-verifier";

export { SOROBAN_RPC_URL, NETWORK_PASSPHRASE } from "@/lib/stellar/soroban";

export {
  stroopsToXlm,
  xlmToStroops,
  calculateInterest,
  scoreToTier,
  TIER_MAX_LOAN,
  TIER_INTEREST_BPS,
  LOAN_STATUS_LABEL,
  DEFAULT_PHASE_LABEL,
  PROPOSAL_STATUS_LABEL,
  DEFAULT_PLATFORM_FEE_BPS,
  MAX_PLATFORM_FEE_BPS,
  MULTISIG_PROPOSAL_STATUS_LABEL,
  RATE_SWITCH_FEE_BPS,
  RATE_SWITCH_COOLDOWN_SECS,
} from "@/types/contracts";

export type {
  BorrowerProfile,
  CollateralEntry,
  AssetCollateralConfig,
  LoanRequestInput,
  LoanRecord,
  EscrowHold,
  DefaultRecord,
  InsuranceEvent,
  PaymentRecord,
  ReputationTier,
  ReputationEvent,
  LoanStatus,
  InterestRateModel,
  EscrowStatus,
  DefaultPhase,
  Proposal,
  ProposalStatus,
  ProposalKind,
  GovConfig,
  MultiSigProposal,
  MultiSigProposalStatus,
  MultiSigAdminAction,
} from "@/types/contracts";

