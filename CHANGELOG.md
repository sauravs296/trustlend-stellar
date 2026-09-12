# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added
- Collateral price oracle (#267): XLM and BTC prices polled every 5 seconds from
  CoinGecko, Binance and the Stellar DEX, aggregated by median with outlier
  rejection, and pushed on-chain. Fallback chain is live → cached → on-chain
  TWAP → refuse to publish. The liquidation keeper now values positions with the
  live price instead of a hardcoded constant. See
  [docs/oracle-price-feeds.md](docs/oracle-price-feeds.md).
- Referral programme (#266): every user gets a unique invite link, and when an
  invited friend's first loan is funded the referrer's bonus is transferred
  automatically by the new `referral_rewards` Soroban contract during
  `activate_loan`. Includes a referral dashboard, attribution APIs, and
  `sql/09_referral_program.sql`. See [docs/referral-program.md](docs/referral-program.md).
- Borrowing user guide and FAQ at `/docs/borrowing`, covering the step-by-step
  borrowing process, how the liquidation threshold is calculated, Health Factor
  bands, and 15 frequently asked questions. Linked from the borrower dashboard
  nav and the landing footer (#265).
- Keyboard-accessible glossary tooltips for financial acronyms (APR, APY, LTV,
  Trust Score, Health Factor, basis points) across the borrower, lender and
  admin dashboards, backed by a shared `lib/glossary` definition list (#264).
- Initial open-source release setup.
- Basic repository files: README, LICENSE, CONTRIBUTING, CODE_OF_CONDUCT, SECURITY.
- GitHub issue and pull request templates.

### Changed
- None yet.

### Deprecated
- None yet.

### Removed
- None yet.

### Fixed
- None yet.

### Security
- None yet.
