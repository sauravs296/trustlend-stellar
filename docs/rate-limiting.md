# API Rate Limiting

All public-facing API routes are rate limited to protect backend services from
brute-force attacks, scraping and misconfigured clients.

## Two layers

| Layer | Scope | Limit | Enforced in |
| --- | --- | --- | --- |
| **Global ceiling** | Every `/api/*` request, keyed by client IP | **100 requests / minute / IP** | [`proxy.ts`](../proxy.ts) — before the request reaches a handler |
| **Per-route policy** | One endpoint, keyed by client IP | Stricter, endpoint-specific (e.g. `POST /api/loans/apply` → 5 per 10 min) | `enforceRouteRateLimit()` at the top of each route handler |

The two layers use independent counters, so an expensive endpoint stays tightly
capped even when the caller is well under the global ceiling.

## Exceeding a limit

Requests over the limit are rejected with **HTTP 429** before any database or
Stellar network work is performed:

```http
HTTP/1.1 429 Too Many Requests
Retry-After: 37
X-RateLimit-Limit: 100
X-RateLimit-Remaining: 0
X-RateLimit-Reset: 1735689600000

{ "error": "Too many requests, please slow down." }
```

## Storage backend

Counters are kept in **Upstash Redis** when `UPSTASH_REDIS_REST_URL` and
`UPSTASH_REDIS_REST_TOKEN` are set, so limits hold across serverless instances.
Without them the limiter falls back to a bounded in-memory store (capped at
10,000 buckets with automatic pruning) — per-instance only, and fine for local
development. If Redis is unreachable the limiter **fails open** rather than
blocking legitimate traffic.

## Client IP resolution

The caller is identified from the first present header of
`x-vercel-ip-address` → `cf-connecting-ip` → `x-vercel-forwarded-for` →
`x-real-ip` → `x-forwarded-for` (first hop of the chain). Platform-injected
headers are preferred because a client cannot forge them.

## Bypass

Two escape hatches skip rate limiting entirely — see [`.env.example`](../.env.example):

- `Authorization: Bearer <ADMIN_SECRET_KEY>` — trusted internal/admin callers.
- `RATE_LIMIT_WHITELIST` — comma-separated IPs (uptime probes, Prometheus scrapers).

## Adding a policy to a new route

Register the limit in `ROUTE_POLICIES` (or `ROUTE_PATTERN_POLICIES` for dynamic
segments) in [`lib/rate-limit.ts`](../lib/rate-limit.ts), then guard the handler:

```ts
export async function POST(request: NextRequest) {
  const rateLimited = await enforceRouteRateLimit(request);
  if (rateLimited) return rateLimited;

  // ...handler logic
}
```

Routes with no explicit policy fall back to **20 requests / minute / IP**.
Scheduler (`/api/cron/*`) and anchor-callback (`/api/webhooks/*`) endpoints are
deliberately left to the global ceiling only — they authenticate with a shared
secret or a verified signature, and a per-route cap could drop legitimate
scheduled runs or provider retries.
