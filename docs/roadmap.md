# TrustLend Roadmap

This page tracks where the project is and what comes next. It is a living
document — priorities shift with community feedback, and every item is open for
contribution. Comment on or open an issue if you want to pick something up.

## Shipped

- Soroban contracts for lending, borrower reputation, escrow, default
  management, pooled lending, multisig admin, governance, referral rewards and
  the TLEND token suite, deployed to Stellar testnet with `npm run deploy:testnet`.
- Wallet-native authentication (Sign-In with Stellar / SEP-10) — no passwords,
  no third-party identity provider.
- Borrower, lender and admin dashboards (Next.js 16) with a token-based design
  system, light/dark themes and motion.
- KYC submission and admin review with private document storage.
- On-chain trust score, tiers and credit limits (reputation v1) driving loan
  eligibility and pricing.
- Escrow-assisted disbursement with a revocation window.
- Automated default management with multisig-gated insurance payouts.
- Liquidation keeper backed by a median-of-sources collateral price oracle.
- SEP-24 fiat on/off ramp integration with Stellar anchors.
- Referral programme paid on-chain on the first funded loan.
- Neon Postgres + Drizzle ORM data layer with versioned migrations, nightly
  encrypted backups and a documented restore procedure.
- CI: contract tests + WASM build, type check, lint, unit tests, production
  build, Playwright E2E, formal verification (proptest / Kani), coverage.

## In progress

- **On-chain verification of client-submitted transactions.** Funding,
  pool-deposit and repayment endpoints currently trust the `txHash` supplied by
  the client; the server will verify the transaction on Soroban RPC (success,
  amount, destination) before crediting anything.
- **Full contract wiring.** Route the remaining lifecycle calls
  (`activate_loan`, `record_payment`, pooled lending) through the contracts
  from the app and make on-chain loan creation mandatory rather than optional.
- **Wire the standalone contracts** — treasury, auto-compound vault,
  liquidation auction, USDC lending pool, borrower loyalty and the ZK credit
  verifier are built and tested but not yet used by the frontend.
- Generated TypeScript bindings for every contract instead of hand-written
  invocation helpers.

## Planned

- Multi-asset lending (USDC and other Stellar assets) end to end.
- Governance UI: proposals, voting and parameter changes from the dashboard.
- Decentralised credit oracles that aggregate off-chain signals (mobile money,
  utility payments) into the trust score.
- Institutional lender tooling: pluggable underwriting models and bulk funding.
- Mobile-first experience and WalletConnect improvements.
- Mainnet launch after an external contract audit.

## Contributing

See [CONTRIBUTING.md](../CONTRIBUTING.md) for the workflow. Items in
"In progress" are the best place to help right now; "Planned" items usually
need a short design discussion in an issue first.
