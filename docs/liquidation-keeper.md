# Liquidation Keeper

> Implements issues **#72 — automatic re-balancing script for lending pool
> liquidations** and **#259 — automated liquidation bot for undercollateralized
> loans** (background worker that monitors prices every minute and liquidates
> automatically).

`scripts/liquidation-keeper.ts` is an automated bot that finds under-collateralized
loans and liquidates them on-chain before they become bad debt.

## Flow

1. **Fetch open loans** — either `--source=db` (Supabase `loans` table, resolving the
   on-chain loan id from the funding ledger entry) or `--source=chain` (iterates the
   LendingContract directly via `get_loan_count`/`get_loan`).
2. **Read authoritative on-chain state** — collateral + remaining debt from
   `lending.get_loan`, the borrower's `reputation.get_reputation_score`, and the
   contract's own dynamic `lending.calculate_liquidation_threshold`.
3. **Price the position** — debt is always XLM; collateral price/decimals come from
   `LIQUIDATION_PRICE_TABLE_JSON` (or an on-chain oracle, if wired in later). Unpriced
   assets are skipped and logged, never guessed.
4. **Liquidate** — if `LTV bps >= threshold bps`, submits `lending.mark_defaulted`
   signed by `ADMIN_SECRET_KEY`.
5. **Alert** — posts to Slack/Discord webhooks on every liquidation and every failure.

## Usage

```bash
npm run liquidation:keeper                     # one-shot (cron)
npm run liquidation:keeper -- --dry-run          # evaluate only
npm run liquidation:keeper -- --source=chain
npm run liquidation:keeper -- --interval=60      # background service
npm run liquidation:keeper:service               # shorthand: poll every minute
```

Config is documented in `.env.example` (`LIQUIDATION_*` section). Every step is
individually error-handled — one bad loan never aborts the run — matching the
`default-management` scheduler's conventions.

## Deployment (issue #259)

Two ways to run the keeper as a background worker that monitors every minute:

1. **Vercel Cron (default deployment).** [`vercel.json`](vercel.json) schedules
   `POST /api/cron/liquidation` every minute (`* * * * *`). The route
   ([`app/api/cron/liquidation/route.ts`](app/api/cron/liquidation/route.ts))
   authenticates the caller with `Bearer ${CRON_SECRET}` (same scheme as the
   `payment-due` / `default-management` crons), loads the keeper config from env,
   runs a full scan, and returns the per-run summary. Every-minute schedules
   require a Vercel Pro plan; on Hobby, run the self-hosted variant below (or an
   external cron) instead.
2. **Self-hosted service.** `npm run liquidation:keeper:service` runs
   `scripts/liquidation-keeper.ts --interval=60` — a long-lived loop that rescans
   prices and liquidates every 60 seconds. Wrap it in Docker/systemd/PM2 on any
   always-on host. One-shot cron invocations (item 1 of [Usage](#usage)) remain
   supported for schedulers with coarser granularity.

Either way, `ADMIN_SECRET_KEY` is the real control: the on-chain
`mark_defaulted` call `require_auth()`s the admin address, so a leaked cron URL
cannot liquidate anything without the signing key.

## Tests

- `__tests__/scripts/liquidation-keeper.test.ts` — 27 tests covering the pure
  LTV/threshold math, alert delivery (incl. webhook failure isolation), CLI/env
  config parsing (incl. the every-minute 60s interval), and full run
  orchestration (liquidate, dry-run, healthy, skipped, failed, both `db` and
  `chain` sources).
- `__tests__/api/cron/liquidation.test.ts` — 7 tests covering the cron route
  (success, 401 on missing/wrong bearer, unset-secret dev mode, 500 on keeper
  failure, GET alias) and the `vercel.json` `* * * * *` schedule.
