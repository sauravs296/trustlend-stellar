/**
 * lib/stellar/verify-payment.ts
 *
 * Server-side verification of client-submitted Stellar payment transactions.
 *
 * The funding, pool-deposit and repayment flows all follow the same pattern:
 * the wallet signs a classic PAYMENT transaction in the browser, Horizon
 * confirms it, and the client posts the resulting hash to our API. Before
 * this module existed the API trusted that hash blindly — any 64-character
 * string credited the caller. Now every route asks Horizon for the
 * transaction and checks, before touching the database, that it:
 *
 *   1. exists and was applied successfully,
 *   2. was signed by the wallet the caller claims to be,
 *   3. carries the memo that binds it to this specific loan / pool,
 *   4. moved at least the claimed amount of native XLM to the expected
 *      destination(s) — and nowhere else.
 *
 * Only Horizon's REST API is used (no SDK instances), so this is safe to unit
 * test with a mocked `fetch`.
 */

const HORIZON_URL =
  process.env.NEXT_PUBLIC_STELLAR_HORIZON_URL ?? "https://horizon-testnet.stellar.org";

/** Stellar amounts have 7 decimals; allow one stroop of float slack. */
const AMOUNT_TOLERANCE = 0.0000001;

const TX_HASH_RE = /^[0-9a-f]{64}$/i;

export interface ExpectedPayment {
  /** G... account that must receive the funds. */
  destination: string;
  /** Minimum native XLM the destination must have received in this tx. */
  minAmount: number;
}

export interface VerifyPaymentParams {
  txHash: string;
  /** The G... account that must be the transaction source. */
  expectedSource: string;
  /**
   * Destinations that must have been paid. When `allowOtherDestinations` is
   * false (default) any payment to an address outside this list fails the
   * check, so a transaction cannot be reused across loans.
   */
  expectedPayments: ExpectedPayment[];
  /** Memo the transaction must carry (exact match on `memo_type: text`). */
  expectedMemo?: string;
  allowOtherDestinations?: boolean;
  /** Reject transactions older than this many seconds (default: 7 days). */
  maxAgeSeconds?: number;
  /** Override for tests. */
  fetchImpl?: typeof fetch;
  horizonUrl?: string;
}

export type VerifyPaymentResult =
  | {
      ok: true;
      txHash: string;
      source: string;
      memo: string | null;
      ledger: number;
      closedAt: string;
      /** Native XLM received per destination, summed across operations. */
      received: Record<string, number>;
      totalNative: number;
    }
  | { ok: false; status: number; reason: string };

interface HorizonTransaction {
  hash: string;
  successful: boolean;
  source_account: string;
  memo_type?: string;
  memo?: string;
  ledger: number;
  created_at: string;
}

interface HorizonOperation {
  type: string;
  transaction_successful?: boolean;
  from?: string;
  to?: string;
  amount?: string;
  asset_type?: string;
  funder?: string;
  account?: string;
  starting_balance?: string;
}

/** Cheap syntactic check so obviously bogus hashes never reach Horizon. */
export function isPlausibleTxHash(value: unknown): value is string {
  return typeof value === "string" && TX_HASH_RE.test(value.trim());
}

/** Memo helpers shared with the client so both sides agree on the binding. */
export const PAYMENT_MEMO = {
  fund: (loanId: string) => `TL-FUND:${loanId.slice(0, 12)}`,
  deposit: (poolId: string) => `TL-DEPOSIT:${poolId.slice(0, 12)}`,
  repay: (loanId: string) => `TL-RPY:${loanId.slice(0, 12)}`,
  withdraw: (positionId: string) => `TL-WDR:${positionId.slice(0, 12)}`,
} as const;

async function horizonGet<T>(
  url: string,
  fetchImpl: typeof fetch,
): Promise<{ ok: true; data: T } | { ok: false; status: number }> {
  const res = await fetchImpl(url, { headers: { Accept: "application/json" } });
  if (!res.ok) return { ok: false, status: res.status };
  return { ok: true, data: (await res.json()) as T };
}

/**
 * Sum native-XLM credits per destination across the transaction's operations.
 * `create_account` counts as a payment of `starting_balance` to the new
 * account, which is what a wallet emits when the destination did not exist.
 */
export function summarisePayments(ops: HorizonOperation[]): Record<string, number> {
  const received: Record<string, number> = {};
  for (const op of ops) {
    if (op.type === "payment" && op.asset_type === "native" && op.to && op.amount) {
      received[op.to] = (received[op.to] ?? 0) + Number(op.amount);
    } else if (op.type === "create_account" && op.account && op.starting_balance) {
      received[op.account] = (received[op.account] ?? 0) + Number(op.starting_balance);
    }
  }
  return received;
}

/**
 * Verify a client-submitted payment transaction against Horizon.
 *
 * Returns `{ ok: false, status, reason }` with an HTTP status the route can
 * pass straight through: 400 for a malformed hash, 404 when Horizon has never
 * seen it, 422 when it exists but does not match what the caller claims, and
 * 502 when Horizon itself is unreachable.
 */
export async function verifyPaymentTransaction(
  params: VerifyPaymentParams,
): Promise<VerifyPaymentResult> {
  const fetchImpl = params.fetchImpl ?? fetch;
  const horizon = (params.horizonUrl ?? HORIZON_URL).replace(/\/$/, "");
  const txHash = params.txHash.trim().toLowerCase();

  if (!isPlausibleTxHash(txHash)) {
    return { ok: false, status: 400, reason: "Transaction hash is not a valid Stellar hash" };
  }

  let tx: HorizonTransaction;
  try {
    const res = await horizonGet<HorizonTransaction>(`${horizon}/transactions/${txHash}`, fetchImpl);
    if (!res.ok) {
      if (res.status === 404) {
        return { ok: false, status: 404, reason: "Transaction not found on the Stellar network" };
      }
      return { ok: false, status: 502, reason: `Horizon returned ${res.status} while verifying the transaction` };
    }
    tx = res.data;
  } catch (error) {
    return {
      ok: false,
      status: 502,
      reason: `Could not reach Horizon to verify the transaction: ${(error as Error).message}`,
    };
  }

  if (!tx.successful) {
    return { ok: false, status: 422, reason: "Transaction was not applied successfully on-chain" };
  }

  if (tx.source_account !== params.expectedSource) {
    return {
      ok: false,
      status: 422,
      reason: "Transaction was not signed by the wallet associated with this account",
    };
  }

  if (params.expectedMemo !== undefined) {
    const memo = tx.memo_type === "text" ? (tx.memo ?? "") : "";
    if (memo !== params.expectedMemo) {
      return { ok: false, status: 422, reason: "Transaction memo does not reference this operation" };
    }
  }

  const maxAge = params.maxAgeSeconds ?? 7 * 24 * 60 * 60;
  const ageSeconds = (Date.now() - new Date(tx.created_at).getTime()) / 1000;
  if (Number.isFinite(ageSeconds) && ageSeconds > maxAge) {
    return { ok: false, status: 422, reason: "Transaction is too old to be credited" };
  }

  let ops: HorizonOperation[];
  try {
    const res = await horizonGet<{ _embedded?: { records?: HorizonOperation[] } }>(
      `${horizon}/transactions/${txHash}/operations?limit=200`,
      fetchImpl,
    );
    if (!res.ok) {
      return { ok: false, status: 502, reason: `Horizon returned ${res.status} while reading operations` };
    }
    ops = res.data._embedded?.records ?? [];
  } catch (error) {
    return {
      ok: false,
      status: 502,
      reason: `Could not reach Horizon to read operations: ${(error as Error).message}`,
    };
  }

  const received = summarisePayments(ops);

  for (const expected of params.expectedPayments) {
    const got = received[expected.destination] ?? 0;
    if (got + AMOUNT_TOLERANCE < expected.minAmount) {
      return {
        ok: false,
        status: 422,
        reason: `Transaction paid ${got.toFixed(7)} XLM to ${expected.destination.slice(0, 6)}… but ${expected.minAmount.toFixed(7)} XLM was claimed`,
      };
    }
  }

  if (!params.allowOtherDestinations) {
    const allowed = new Set(params.expectedPayments.map((p) => p.destination));
    const stray = Object.keys(received).find((dest) => !allowed.has(dest));
    if (stray) {
      return {
        ok: false,
        status: 422,
        reason: "Transaction pays an address that is not part of this operation",
      };
    }
  }

  const totalNative = Object.values(received).reduce((sum, n) => sum + n, 0);

  return {
    ok: true,
    txHash,
    source: tx.source_account,
    memo: tx.memo_type === "text" ? (tx.memo ?? null) : null,
    ledger: tx.ledger,
    closedAt: tx.created_at,
    received,
    totalNative,
  };
}
