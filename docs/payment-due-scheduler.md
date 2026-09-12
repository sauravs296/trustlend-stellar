# Payment-Due Scheduler & Notifications

TrustLend checks for loans whose payment deadline falls within the next
**48 hours** and dispatches a webhook (and, when configured, an email) for each
of them.

## How it works

1. A scheduler calls `POST /api/cron/payment-due`. On Vercel this is the daily
   cron declared in [`vercel.json`](../vercel.json); any HTTP trigger works.
2. The route queries the database for `active` or `funded` loans with `due_at`
   between now and +48 hours.
3. A POST webhook is sent to `WEBHOOK_NOTIFICATION_URL` for each qualifying loan.
4. The loan's `metadata.payment_due_notified_at` is set to prevent duplicate
   notifications.
5. Per-loan errors are logged without stopping the rest of the batch.

## Environment variables

| Variable | Description |
|---|---|
| `WEBHOOK_NOTIFICATION_URL` | URL of the notification service that receives payment-due webhook POSTs |
| `CRON_SECRET` | Secret token used to authenticate scheduler requests (`Authorization: Bearer <value>`) |
| `DATABASE_URL` | Neon Postgres connection string |
| `RESEND_API_KEY` | Optional Resend API key for borrower email notifications |
| `RESEND_FROM_EMAIL` | Verified sender address used for TrustLend emails |
| `RESEND_REPLY_TO_EMAIL` | Optional reply-to address for support responses |

When Resend is configured, TrustLend sends borrower emails for loan approval,
loan funding and overdue payments. Email failures are logged but do not roll
back successful loan state changes.

## Webhook payload

```json
{
  "borrowerId": "uuid",
  "loanId": "uuid",
  "dueDate": "2026-07-01T12:00:00.000Z",
  "paymentAmount": 800.00
}
```

`paymentAmount` is `principal_amount − repaid_amount` (outstanding balance).

## Triggering the scheduler

**Vercel cron (automatic, daily):** configured in `vercel.json` together with
the other daily jobs (default management, reputation scoring, liquidation,
price oracle). Vercel's Hobby plan only allows daily crons, which is why the
time-sensitive liquidation keeper and price oracle are additionally driven every
5 minutes by the [`keepers.yml`](../.github/workflows/keepers.yml) GitHub
Actions workflow (requires the `KEEPER_BASE_URL` and `CRON_SECRET` repository
secrets).

**Manual trigger:**

```bash
curl -X POST https://your-app.vercel.app/api/cron/payment-due \
  -H "Authorization: Bearer $CRON_SECRET"
```

**Local development:** the `Authorization` check is skipped when `CRON_SECRET`
is not configured.

## Failure handling

- Individual loan failures are logged and do not block other loans in the same run.
- The scheduler returns a JSON summary: `{ processed, succeeded, failed, errors }`.
- Webhook requests time out after 10 seconds.
