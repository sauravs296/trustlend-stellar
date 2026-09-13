import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";
import { createFakeDb } from "../../helpers/fake-db";

const LENDER = "GBLENDER00000000000000000000000000000000000000000000000000";
const BORROWER_WALLET = "GBBORROWER0000000000000000000000000000000000000000000000";
const HASH = "c".repeat(64);
const LOAN_ID = "0b1e5c4a-7d9f-4c3b-9a2e-123456789abc";

const mockRequireAuthenticatedUser = vi.fn();
vi.mock("@/lib/auth/session", () => ({
  requireAuthenticatedUser: (...args: unknown[]) => mockRequireAuthenticatedUser(...args),
}));
vi.mock("@/lib/rate-limit", () => ({ enforceRouteRateLimit: vi.fn().mockResolvedValue(null) }));
vi.mock("@/lib/notifications", () => ({ createNotification: vi.fn().mockResolvedValue({ id: "n" }) }));
vi.mock("@/lib/email/resend", () => ({ sendLoanFundedEmail: vi.fn().mockResolvedValue(undefined) }));
vi.mock("@/lib/referrals/qualify", () => ({ qualifyReferralForLoan: vi.fn().mockResolvedValue({ qualified: false }) }));

const mockVerify = vi.fn();
vi.mock("@/lib/stellar/verify-payment", async () => {
  const actual = await vi.importActual<typeof import("@/lib/stellar/verify-payment")>("@/lib/stellar/verify-payment");
  return { ...actual, verifyPaymentTransaction: (...args: unknown[]) => mockVerify(...args) };
});

const mockActivate = vi.fn();
vi.mock("@/lib/loans/onchain", () => ({
  activateFundedLoanOnchain: (...args: unknown[]) => mockActivate(...args),
}));

const mockGetDb = vi.fn();
vi.mock("@/lib/db/client", () => ({ getDb: () => mockGetDb() }));

import { POST } from "@/app/api/loans/fund/route";

function request(body: Record<string, unknown>) {
  return new NextRequest("http://localhost/api/loans/fund", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

function loanRow(overrides: Record<string, unknown> = {}) {
  return {
    id: LOAN_ID,
    status: "requested",
    principalAmount: "100",
    fundedAmount: "0",
    borrowerId: "borrower-1",
    aprBps: 1200,
    durationDays: 30,
    metadata: { onchain_loan_id: 5 },
    borrowerWallet: BORROWER_WALLET,
    ...overrides,
  };
}

describe("POST /api/loans/fund — payment verification", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRequireAuthenticatedUser.mockResolvedValue({ user: { id: "lender-1", walletAddress: LENDER }, role: "lender" });
    mockActivate.mockResolvedValue({ attempted: true, ok: true, txHash: "d".repeat(64), status: "Active" });
  });

  it("refuses to credit a payment Horizon cannot verify and writes nothing", async () => {
    const db = createFakeDb();
    db.queue([]); // replay guard
    db.queue([loanRow()]); // loan
    db.queue([{ walletAddress: LENDER }]); // lender profile
    mockGetDb.mockReturnValue(db);
    mockVerify.mockResolvedValue({ ok: false, status: 422, reason: "Transaction memo does not reference this operation" });

    const res = await POST(request({ loanId: LOAN_ID, txHash: HASH, lenderAddress: LENDER, amount: 100 }));
    expect(res.status).toBe(422);
    expect((await res.json()).error).toMatch(/memo/);
    expect(db.calls.some((c) => c.method === "execute" || c.method === "insert")).toBe(false);
    expect(mockActivate).not.toHaveBeenCalled();
  });

  it("rejects a lenderAddress that is not linked to the signed-in account", async () => {
    const db = createFakeDb();
    db.queue([]);
    db.queue([loanRow()]);
    db.queue([{ walletAddress: LENDER }]);
    mockGetDb.mockReturnValue(db);

    const res = await POST(
      request({ loanId: LOAN_ID, txHash: HASH, lenderAddress: "GBSOMEONEELSE000000000000000000000000000000000000000000", amount: 100 }),
    );
    expect(res.status).toBe(400);
    expect(mockVerify).not.toHaveBeenCalled();
  });

  it("verifies against the borrower's wallet and the loan-bound memo, then records and activates on-chain", async () => {
    const db = createFakeDb();
    db.queue([]); // replay guard
    db.queue([loanRow()]); // loan
    db.queue([{ walletAddress: LENDER }]); // lender profile
    db.queue([
      {
        loan_id: LOAN_ID,
        status: "active",
        principal_amount: "100",
        funded_amount: "100",
        remaining_amount: "0",
        is_fully_funded: true,
        funding_id: "f-1",
      },
    ]); // record_loan_funding
    db.queue([]); // ledger insert
    mockGetDb.mockReturnValue(db);
    mockVerify.mockResolvedValue({
      ok: true,
      txHash: HASH,
      source: LENDER,
      memo: `TL-FUND:${LOAN_ID.slice(0, 12)}`,
      ledger: 100,
      closedAt: new Date().toISOString(),
      received: { [BORROWER_WALLET]: 100 },
      totalNative: 100,
    });

    const approveTxHash = "e".repeat(64);
    const res = await POST(request({ loanId: LOAN_ID, txHash: HASH, lenderAddress: LENDER, amount: 100, approveTxHash }));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.isFullyFunded).toBe(true);
    expect(json.onchain).toMatchObject({ attempted: true, ok: true });

    expect(mockVerify).toHaveBeenCalledWith(
      expect.objectContaining({
        txHash: HASH,
        expectedSource: LENDER,
        expectedMemo: `TL-FUND:${LOAN_ID.slice(0, 12)}`,
        expectedPayments: [{ destination: BORROWER_WALLET, minAmount: 100 }],
      }),
    );
    expect(mockActivate).toHaveBeenCalledWith(
      expect.objectContaining({ loanId: LOAN_ID, lenderAddress: LENDER, approveTxHash, loanMetadata: { onchain_loan_id: 5 } }),
    );
  });

  it("does not try to activate on-chain for a partial fill", async () => {
    const db = createFakeDb();
    db.queue([]);
    db.queue([loanRow()]);
    db.queue([{ walletAddress: LENDER }]);
    db.queue([
      {
        loan_id: LOAN_ID,
        status: "requested",
        principal_amount: "100",
        funded_amount: "40",
        remaining_amount: "60",
        is_fully_funded: false,
        funding_id: "f-1",
      },
    ]);
    db.queue([]);
    mockGetDb.mockReturnValue(db);
    mockVerify.mockResolvedValue({
      ok: true,
      txHash: HASH,
      source: LENDER,
      memo: "",
      ledger: 1,
      closedAt: new Date().toISOString(),
      received: { [BORROWER_WALLET]: 40 },
      totalNative: 40,
    });

    const res = await POST(request({ loanId: LOAN_ID, txHash: HASH, lenderAddress: LENDER, amount: 40 }));
    expect(res.status).toBe(200);
    expect((await res.json()).onchain).toEqual({ attempted: false });
    expect(mockActivate).not.toHaveBeenCalled();
  });

  it("refuses to fund a borrower with no wallet on file", async () => {
    const db = createFakeDb();
    db.queue([]);
    db.queue([loanRow({ borrowerWallet: null })]);
    mockGetDb.mockReturnValue(db);

    const res = await POST(request({ loanId: LOAN_ID, txHash: HASH, lenderAddress: LENDER, amount: 100 }));
    expect(res.status).toBe(409);
    expect(mockVerify).not.toHaveBeenCalled();
  });
});
