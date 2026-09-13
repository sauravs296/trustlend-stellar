import { describe, it, expect } from "vitest";
import {
  PAYMENT_MEMO,
  isPlausibleTxHash,
  summarisePayments,
  verifyPaymentTransaction,
} from "@/lib/stellar/verify-payment";

const HASH = "a".repeat(64);
const LENDER = "GBLENDER00000000000000000000000000000000000000000000000000";
const BORROWER = "GBBORROWER0000000000000000000000000000000000000000000000";
const PLATFORM = "GBPLATFORM0000000000000000000000000000000000000000000000";
const LOAN_ID = "0b1e5c4a-7d9f-4c3b-9a2e-123456789abc";

type TxOverrides = Partial<{
  successful: boolean;
  source_account: string;
  memo_type: string;
  memo: string;
  created_at: string;
}>;

type Op = Record<string, unknown>;

function fakeFetch(tx: TxOverrides, ops: Op[], opts: { txStatus?: number; opsStatus?: number } = {}) {
  const calls: string[] = [];
  const fetchImpl = (async (input: string | URL | Request) => {
    const url = String(input);
    calls.push(url);
    if (url.endsWith("/operations?limit=200")) {
      if (opts.opsStatus) return new Response("{}", { status: opts.opsStatus });
      return new Response(JSON.stringify({ _embedded: { records: ops } }), { status: 200 });
    }
    if (opts.txStatus) return new Response("{}", { status: opts.txStatus });
    return new Response(
      JSON.stringify({
        hash: HASH,
        successful: true,
        source_account: LENDER,
        memo_type: "text",
        memo: PAYMENT_MEMO.fund(LOAN_ID),
        ledger: 12345,
        created_at: new Date().toISOString(),
        ...tx,
      }),
      { status: 200 },
    );
  }) as unknown as typeof fetch;
  return { fetchImpl, calls };
}

const payment = (to: string, amount: string): Op => ({ type: "payment", asset_type: "native", from: LENDER, to, amount });

const base = {
  txHash: HASH,
  expectedSource: LENDER,
  expectedMemo: PAYMENT_MEMO.fund(LOAN_ID),
  expectedPayments: [{ destination: BORROWER, minAmount: 100 }],
  horizonUrl: "https://horizon.test",
};

describe("verifyPaymentTransaction", () => {
  it("accepts a successful payment that matches source, memo, destination and amount", async () => {
    const { fetchImpl, calls } = fakeFetch({}, [payment(BORROWER, "100.0000000")]);
    const res = await verifyPaymentTransaction({ ...base, fetchImpl });
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.source).toBe(LENDER);
      expect(res.received[BORROWER]).toBe(100);
      expect(res.totalNative).toBe(100);
      expect(res.ledger).toBe(12345);
    }
    expect(calls[0]).toBe(`https://horizon.test/transactions/${HASH}`);
  });

  it("rejects malformed hashes without calling Horizon", async () => {
    const { fetchImpl, calls } = fakeFetch({}, []);
    const res = await verifyPaymentTransaction({ ...base, txHash: "not-a-hash", fetchImpl });
    expect(res).toMatchObject({ ok: false, status: 400 });
    expect(calls).toHaveLength(0);
  });

  it("returns 404 when Horizon has never seen the transaction", async () => {
    const { fetchImpl } = fakeFetch({}, [], { txStatus: 404 });
    const res = await verifyPaymentTransaction({ ...base, fetchImpl });
    expect(res).toMatchObject({ ok: false, status: 404 });
  });

  it("returns 502 when Horizon is unavailable", async () => {
    const { fetchImpl } = fakeFetch({}, [], { txStatus: 503 });
    const res = await verifyPaymentTransaction({ ...base, fetchImpl });
    expect(res).toMatchObject({ ok: false, status: 502 });
  });

  it("rejects transactions that failed on-chain", async () => {
    const { fetchImpl } = fakeFetch({ successful: false }, [payment(BORROWER, "100")]);
    const res = await verifyPaymentTransaction({ ...base, fetchImpl });
    expect(res).toMatchObject({ ok: false, status: 422 });
    if (!res.ok) expect(res.reason).toMatch(/not applied/);
  });

  it("rejects a transaction signed by a different wallet", async () => {
    const { fetchImpl } = fakeFetch({ source_account: PLATFORM }, [payment(BORROWER, "100")]);
    const res = await verifyPaymentTransaction({ ...base, fetchImpl });
    expect(res).toMatchObject({ ok: false, status: 422 });
    if (!res.ok) expect(res.reason).toMatch(/not signed by the wallet/);
  });

  it("rejects a transaction whose memo references another loan", async () => {
    const { fetchImpl } = fakeFetch({ memo: PAYMENT_MEMO.fund("ffffffff-0000-0000-0000-000000000000") }, [
      payment(BORROWER, "100"),
    ]);
    const res = await verifyPaymentTransaction({ ...base, fetchImpl });
    expect(res).toMatchObject({ ok: false, status: 422 });
    if (!res.ok) expect(res.reason).toMatch(/memo/);
  });

  it("rejects a transaction with no text memo when one is expected", async () => {
    const { fetchImpl } = fakeFetch({ memo_type: "none", memo: undefined }, [payment(BORROWER, "100")]);
    const res = await verifyPaymentTransaction({ ...base, fetchImpl });
    expect(res).toMatchObject({ ok: false, status: 422 });
  });

  it("rejects when the destination received less than claimed", async () => {
    const { fetchImpl } = fakeFetch({}, [payment(BORROWER, "99.9")]);
    const res = await verifyPaymentTransaction({ ...base, fetchImpl });
    expect(res).toMatchObject({ ok: false, status: 422 });
    if (!res.ok) expect(res.reason).toMatch(/99.9000000 XLM/);
  });

  it("tolerates one stroop of float slack", async () => {
    const { fetchImpl } = fakeFetch({}, [payment(BORROWER, "99.9999999")]);
    const res = await verifyPaymentTransaction({ ...base, fetchImpl });
    expect(res.ok).toBe(true);
  });

  it("sums several payment operations to the same destination", async () => {
    const { fetchImpl } = fakeFetch({}, [payment(BORROWER, "60"), payment(BORROWER, "40")]);
    const res = await verifyPaymentTransaction({ ...base, fetchImpl });
    expect(res.ok).toBe(true);
  });

  it("rejects payments to addresses outside the expected set", async () => {
    const { fetchImpl } = fakeFetch({}, [payment(BORROWER, "100"), payment(PLATFORM, "1")]);
    const res = await verifyPaymentTransaction({ ...base, fetchImpl });
    expect(res).toMatchObject({ ok: false, status: 422 });
    if (!res.ok) expect(res.reason).toMatch(/not part of this operation/);
  });

  it("allows extra destinations when explicitly permitted", async () => {
    const { fetchImpl } = fakeFetch({}, [payment(BORROWER, "100"), payment(PLATFORM, "1")]);
    const res = await verifyPaymentTransaction({ ...base, allowOtherDestinations: true, fetchImpl });
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.totalNative).toBe(101);
  });

  it("ignores non-native payments", async () => {
    const { fetchImpl } = fakeFetch({}, [
      { type: "payment", asset_type: "credit_alphanum4", asset_code: "USDC", to: BORROWER, amount: "100" },
    ]);
    const res = await verifyPaymentTransaction({ ...base, fetchImpl });
    expect(res).toMatchObject({ ok: false, status: 422 });
  });

  it("counts create_account as a payment of the starting balance", async () => {
    const { fetchImpl } = fakeFetch({}, [
      { type: "create_account", funder: LENDER, account: BORROWER, starting_balance: "100.0000000" },
    ]);
    const res = await verifyPaymentTransaction({ ...base, fetchImpl });
    expect(res.ok).toBe(true);
  });

  it("rejects transactions older than maxAgeSeconds", async () => {
    const old = new Date(Date.now() - 10 * 24 * 3600 * 1000).toISOString();
    const { fetchImpl } = fakeFetch({ created_at: old }, [payment(BORROWER, "100")]);
    const res = await verifyPaymentTransaction({ ...base, fetchImpl });
    expect(res).toMatchObject({ ok: false, status: 422 });
    if (!res.ok) expect(res.reason).toMatch(/too old/);
  });

  it("returns 502 when the operations lookup fails", async () => {
    const { fetchImpl } = fakeFetch({}, [], { opsStatus: 500 });
    const res = await verifyPaymentTransaction({ ...base, fetchImpl });
    expect(res).toMatchObject({ ok: false, status: 502 });
  });

  it("supports the repayment shape: many lender payouts plus the platform fee", async () => {
    const LENDER_B = "GBLENDERB000000000000000000000000000000000000000000000000";
    const { fetchImpl } = fakeFetch(
      { source_account: BORROWER, memo: PAYMENT_MEMO.repay(LOAN_ID) },
      [payment(LENDER, "60"), payment(LENDER_B, "39"), payment(PLATFORM, "1")],
    );
    const res = await verifyPaymentTransaction({
      txHash: HASH,
      expectedSource: BORROWER,
      expectedMemo: PAYMENT_MEMO.repay(LOAN_ID),
      expectedPayments: [LENDER, LENDER_B, PLATFORM].map((destination) => ({ destination, minAmount: 0 })),
      fetchImpl,
    });
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.totalNative).toBeCloseTo(100, 7);
  });
});

describe("helpers", () => {
  it("isPlausibleTxHash accepts 64 hex chars only", () => {
    expect(isPlausibleTxHash(HASH)).toBe(true);
    expect(isPlausibleTxHash(HASH.toUpperCase())).toBe(true);
    expect(isPlausibleTxHash("abc")).toBe(false);
    expect(isPlausibleTxHash(42)).toBe(false);
  });

  it("summarisePayments groups native credits per destination", () => {
    const received = summarisePayments([
      payment(BORROWER, "1.5"),
      payment(BORROWER, "2.5"),
      payment(PLATFORM, "0.1"),
      { type: "manage_data" },
    ] as never);
    expect(received).toEqual({ [BORROWER]: 4, [PLATFORM]: 0.1 });
  });

  it("memos are bound to the first 12 characters of the id and stay under 28 bytes", () => {
    expect(PAYMENT_MEMO.fund(LOAN_ID)).toBe("TL-FUND:0b1e5c4a-7d9");
    for (const memo of [
      PAYMENT_MEMO.fund(LOAN_ID),
      PAYMENT_MEMO.deposit(LOAN_ID),
      PAYMENT_MEMO.repay(LOAN_ID),
      PAYMENT_MEMO.withdraw(LOAN_ID),
    ]) {
      expect(Buffer.byteLength(memo)).toBeLessThanOrEqual(28);
    }
  });
});
