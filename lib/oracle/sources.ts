/**
 * Price source adapters (Issue #267).
 *
 * Each adapter turns one upstream API into `PriceQuote`s. They are deliberately
 * tiny and independent: the aggregator takes a median across whichever ones
 * respond, so a single dead or misbehaving source degrades the feed rather
 * than breaking it.
 *
 * Every adapter must:
 *   • time out rather than hanging the 5-second poll loop,
 *   • return [] on any failure instead of throwing,
 *   • never return a partially-parsed or zero price.
 */

import type { PriceQuote, PriceSymbol } from "./prices";
import { TRACKED_SYMBOLS } from "./prices";

/** Default per-request timeout. Must stay well under the poll interval. */
export const DEFAULT_SOURCE_TIMEOUT_MS = 3_000;

export interface PriceSource {
  /** Stable identifier used in logs, alerts and `contributingSources`. */
  name: string;
  /** Fetch quotes for the requested symbols. Returns [] on any failure. */
  fetchPrices(symbols: PriceSymbol[]): Promise<PriceQuote[]>;
}

/** Injectable fetch, so tests never touch the network. */
export type FetchLike = (
  input: string,
  init?: { signal?: AbortSignal; headers?: Record<string, string> },
) => Promise<{ ok: boolean; status: number; json(): Promise<unknown> }>;

/**
 * GET JSON with a hard timeout.
 * Returns null instead of throwing — callers treat null as "source down".
 */
export async function fetchJsonSafe(
  url: string,
  options: {
    timeoutMs?: number;
    fetchImpl?: FetchLike;
    headers?: Record<string, string>;
  } = {},
): Promise<unknown | null> {
  const {
    timeoutMs = DEFAULT_SOURCE_TIMEOUT_MS,
    fetchImpl = globalThis.fetch as unknown as FetchLike,
    headers,
  } = options;

  if (typeof fetchImpl !== "function") return null;

  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  // Race the request against the deadline as well as aborting it: a fetch
  // implementation that ignores the signal must still not hang the poll loop.
  const deadline = new Promise<null>((resolve) => {
    timer = setTimeout(() => {
      controller.abort();
      resolve(null);
    }, timeoutMs);
  });

  try {
    const res = await Promise.race([fetchImpl(url, { signal: controller.signal, headers }), deadline]);
    if (!res || !res.ok) return null;
    return await Promise.race([res.json(), deadline]);
  } catch {
    // Timeout, DNS failure, malformed JSON — all "source down".
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/** Safely read a nested numeric field, returning null when absent or unusable. */
function readNumber(value: unknown): number | null {
  const n = typeof value === "string" ? Number(value) : value;
  if (typeof n !== "number" || !Number.isFinite(n) || n <= 0) return null;
  return n;
}

// ─── CoinGecko ──────────────────────────────────────────────────────────────

const COINGECKO_IDS: Record<PriceSymbol, string> = {
  XLM: "stellar",
  BTC: "bitcoin",
};

export function createCoinGeckoSource(options: {
  fetchImpl?: FetchLike;
  timeoutMs?: number;
  apiKey?: string;
  baseUrl?: string;
} = {}): PriceSource {
  const {
    fetchImpl,
    timeoutMs,
    apiKey,
    baseUrl = "https://api.coingecko.com/api/v3",
  } = options;

  return {
    name: "coingecko",
    async fetchPrices(symbols) {
      const ids = symbols.map((s) => COINGECKO_IDS[s]).filter(Boolean);
      if (ids.length === 0) return [];

      const url = `${baseUrl}/simple/price?ids=${ids.join(",")}&vs_currencies=usd`;
      const data = await fetchJsonSafe(url, {
        timeoutMs,
        fetchImpl,
        headers: apiKey ? { "x-cg-demo-api-key": apiKey } : undefined,
      });
      if (!data || typeof data !== "object") return [];

      const observedAt = Date.now();
      const quotes: PriceQuote[] = [];

      for (const symbol of symbols) {
        const id = COINGECKO_IDS[symbol];
        const entry = (data as Record<string, unknown>)[id];
        if (!entry || typeof entry !== "object") continue;
        const price = readNumber((entry as Record<string, unknown>).usd);
        if (price === null) continue;
        quotes.push({ symbol, priceUsd: price, source: "coingecko", observedAt });
      }

      return quotes;
    },
  };
}

// ─── Binance ────────────────────────────────────────────────────────────────

const BINANCE_PAIRS: Record<PriceSymbol, string> = {
  XLM: "XLMUSDT",
  BTC: "BTCUSDT",
};

export function createBinanceSource(options: {
  fetchImpl?: FetchLike;
  timeoutMs?: number;
  baseUrl?: string;
} = {}): PriceSource {
  const {
    fetchImpl,
    timeoutMs,
    baseUrl = "https://api.binance.com/api/v3",
  } = options;

  return {
    name: "binance",
    async fetchPrices(symbols) {
      const observedAt = Date.now();

      // Binance's batch endpoint wants a JSON array of symbols in the query.
      const pairs = symbols.map((s) => BINANCE_PAIRS[s]).filter(Boolean);
      if (pairs.length === 0) return [];

      const url = `${baseUrl}/ticker/price?symbols=${encodeURIComponent(
        JSON.stringify(pairs),
      )}`;
      const data = await fetchJsonSafe(url, { timeoutMs, fetchImpl });
      if (!Array.isArray(data)) return [];

      const bySymbol = new Map<string, number>();
      for (const row of data) {
        if (!row || typeof row !== "object") continue;
        const pair = (row as Record<string, unknown>).symbol;
        const price = readNumber((row as Record<string, unknown>).price);
        if (typeof pair === "string" && price !== null) bySymbol.set(pair, price);
      }

      const quotes: PriceQuote[] = [];
      for (const symbol of symbols) {
        const price = bySymbol.get(BINANCE_PAIRS[symbol]);
        // USDT is treated as 1 USD. Good enough for collateral valuation at
        // this scale; the median across sources absorbs any small depeg.
        if (price !== undefined) {
          quotes.push({ symbol, priceUsd: price, source: "binance", observedAt });
        }
      }
      return quotes;
    },
  };
}

// ─── Stellar DEX ────────────────────────────────────────────────────────────

/**
 * On-chain price from the Stellar DEX orderbook, via Horizon.
 *
 * This is the only source that is native to the chain TrustLend runs on, so
 * it keeps the feed working even if every centralised API is unreachable.
 * Uses the orderbook mid-price against USDC.
 */
export function createStellarDexSource(options: {
  fetchImpl?: FetchLike;
  timeoutMs?: number;
  horizonUrl?: string;
  /** USDC issuer used as the USD leg of the orderbook. */
  usdcIssuer?: string;
} = {}): PriceSource {
  const {
    fetchImpl,
    timeoutMs,
    horizonUrl = "https://horizon.stellar.org",
    usdcIssuer = "GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN",
  } = options;

  return {
    name: "stellar-dex",
    async fetchPrices(symbols) {
      const quotes: PriceQuote[] = [];

      // Only XLM has a deep native orderbook against USDC; BTC on the Stellar
      // DEX is thin enough that its mid-price would be misleading, so we
      // deliberately do not quote it here.
      if (!symbols.includes("XLM")) return quotes;

      const url =
        `${horizonUrl}/order_book` +
        `?selling_asset_type=native` +
        `&buying_asset_type=credit_alphanum4` +
        `&buying_asset_code=USDC` +
        `&buying_asset_issuer=${usdcIssuer}` +
        `&limit=1`;

      const data = await fetchJsonSafe(url, { timeoutMs, fetchImpl });
      if (!data || typeof data !== "object") return quotes;

      const book = data as Record<string, unknown>;
      const bids = Array.isArray(book.bids) ? book.bids : [];
      const asks = Array.isArray(book.asks) ? book.asks : [];
      if (bids.length === 0 || asks.length === 0) return quotes;

      const bid = readNumber((bids[0] as Record<string, unknown>)?.price);
      const ask = readNumber((asks[0] as Record<string, unknown>)?.price);
      if (bid === null || ask === null) return quotes;

      quotes.push({
        symbol: "XLM",
        priceUsd: (bid + ask) / 2,
        source: "stellar-dex",
        observedAt: Date.now(),
      });

      return quotes;
    },
  };
}

// ─── Orchestration ──────────────────────────────────────────────────────────

/**
 * Poll every source concurrently and flatten the results.
 *
 * `Promise.allSettled` is deliberate: one source throwing (despite the
 * adapters' own guards) must not lose the quotes from the others.
 */
export async function collectQuotes(
  sources: PriceSource[],
  symbols: PriceSymbol[] = TRACKED_SYMBOLS,
): Promise<{ quotes: PriceQuote[]; failedSources: string[] }> {
  const settled = await Promise.allSettled(
    sources.map((source) => source.fetchPrices(symbols)),
  );

  const quotes: PriceQuote[] = [];
  const failedSources: string[] = [];

  settled.forEach((result, i) => {
    const name = sources[i]?.name ?? `source-${i}`;
    if (result.status === "fulfilled" && result.value.length > 0) {
      quotes.push(...result.value);
    } else {
      failedSources.push(name);
    }
  });

  return { quotes, failedSources };
}

/** Build the default source set from environment configuration. */
export function createDefaultSources(env: NodeJS.ProcessEnv = process.env): PriceSource[] {
  const sources: PriceSource[] = [];

  if (env.ORACLE_DISABLE_COINGECKO !== "true") {
    sources.push(createCoinGeckoSource({ apiKey: env.COINGECKO_API_KEY }));
  }
  if (env.ORACLE_DISABLE_BINANCE !== "true") {
    sources.push(createBinanceSource());
  }
  if (env.ORACLE_DISABLE_STELLAR_DEX !== "true") {
    sources.push(
      createStellarDexSource({
        horizonUrl: env.STELLAR_HORIZON_URL,
        usdcIssuer: env.ORACLE_USDC_ISSUER,
      }),
    );
  }

  return sources;
}
