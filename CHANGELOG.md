# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added
- Token-based design system (`app/theme.css`, `components/ui/`) with light,
  dark and system themes, shared framer-motion presets and animated stat
  components; landing, auth and dashboard shell rebuilt on it (#314).
- Neon Postgres + Drizzle ORM data layer with versioned migrations in
  `drizzle/`, `npm run db:*` scripts and a CI migration step on `main` (#313).
- Sign-In with Stellar (SEP-10) sessions issued as signed HttpOnly cookies;
  private KYC document storage on Vercel Blob (#313).
- GitHub Actions keeper workflow that triggers the liquidation keeper and price
  oracle every 5 minutes, working around Vercel's daily-cron limit (#312).
- SEP-24 fiat on/off ramp integration with Stellar anchors (#309).
- Grace period before liquidations can be triggered (#308).
- Collateral price oracle (#267): XLM and BTC prices from CoinGecko, Binance
  and the Stellar DEX, aggregated by median with outlier rejection and pushed
  on-chain; the liquidation keeper values positions with the live price. See
  [docs/oracle-price-feeds.md](docs/oracle-price-feeds.md).
- Referral programme (#266): unique invite links with the referrer's bonus paid
  by the `referral_rewards` contract during `activate_loan`. See
  [docs/referral-program.md](docs/referral-program.md).
- Borrowing user guide and FAQ at `/docs/borrowing` (#265) and keyboard
  accessible glossary tooltips for financial terms (#264).
- Initial open-source release setup: README, LICENSE, CONTRIBUTING,
  CODE_OF_CONDUCT, SECURITY, issue and pull request templates.

### Changed
- README rewritten for open-source readers; rate-limiting and payment-due
  scheduler details moved to `docs/rate-limiting.md` and
  `docs/payment-due-scheduler.md`; roadmap and contributing guide refreshed.
- Vercel cron jobs reduced to daily schedules (Hobby plan limit) (#312).
- Hard-coded colours across dashboards replaced with theme tokens so every
  screen renders in both themes (#314).

### Removed
- Supabase client, auth, RLS policies and SQL scripts, replaced by Neon +
  Drizzle (#313).
- Dead code, the indexer stack, stale documentation and unused assets (#311).

### Fixed
- Chart area fills rendered black because a CSS variable was used as an SVG
  gradient id (#314).
- Contract CI job: `usdc_lending_pool` arithmetic widths, token transfer
  calls and clippy warnings (#312).
