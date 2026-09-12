import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createFakeDb, type FakeDb } from "../helpers/fake-db";

// ── Mock the database ─────────────────────────────────────────────────────────
let db: FakeDb | null;

vi.mock("@/lib/db/client", () => ({
  getDb: () => db,
}));

import {
  queryDueLoans,
  sendWebhookNotification,
  markLoanNotified,
  runPaymentDueScheduler,
  type DueLoan,
} from "@/lib/scheduler/payment-due";

// ── Helpers ────────────────────────────────────────────────────────────────────

function makeLoan(overrides: Partial<DueLoan> = {}): DueLoan {
  const dueAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(); // 24h from now
  return {
    id: "loan-1",
    borrower_id: "borrower-1",
    due_at: dueAt,
    principal_amount: 1000,
    repaid_amount: 200,
    metadata: {},
    ...overrides,
  };
}

/** The camelCase row shape the loans query returns for a DueLoan. */
function toDbRow(loan: DueLoan) {
  return {
    id: loan.id,
    borrowerId: loan.borrower_id,
    dueAt: loan.due_at ? new Date(loan.due_at) : null,
    principalAmount: String(loan.principal_amount),
    repaidAmount: String(loan.repaid_amount),
    metadata: loan.metadata,
  };
}

function primeDueLoans(loans: DueLoan[]) {
  db = createFakeDb();
  db.queue(loans.map(toDbRow));
  return db;
}

// ── queryDueLoans ──────────────────────────────────────────────────────────────

describe("queryDueLoans", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns loans due within 48 hours that are not yet notified", async () => {
    primeDueLoans([makeLoan()]);

    const result = await queryDueLoans();

    expect(result).toHaveLength(1);
    expect(result[0].id).toBe("loan-1");
    expect(result[0].principal_amount).toBe(1000);
  });

  it("filters out loans already marked as notified", async () => {
    primeDueLoans([
      makeLoan({ metadata: { payment_due_notified_at: "2026-06-27T00:00:00.000Z" } }),
    ]);

    const result = await queryDueLoans();

    expect(result).toHaveLength(0);
  });

  it("returns empty array when no loans are due", async () => {
    primeDueLoans([]);

    const result = await queryDueLoans();

    expect(result).toHaveLength(0);
  });

  it("throws when the database is not configured", async () => {
    db = null;

    await expect(queryDueLoans()).rejects.toThrow("Database unavailable");
  });

  it("handles multiple qualifying loans", async () => {
    primeDueLoans([makeLoan({ id: "loan-1" }), makeLoan({ id: "loan-2" })]);

    const result = await queryDueLoans();

    expect(result).toHaveLength(2);
  });
});

// ── sendWebhookNotification ────────────────────────────────────────────────────

describe("sendWebhookNotification", () => {
  beforeEach(() => vi.clearAllMocks());

  const webhookUrl = "https://example.com/webhook";

  it("sends a POST with the correct payload", async () => {
    const loan = makeLoan();
    const fetchMock = vi.fn().mockResolvedValue({ ok: true });
    vi.stubGlobal("fetch", fetchMock);

    await sendWebhookNotification(loan, webhookUrl);

    expect(fetchMock).toHaveBeenCalledOnce();
    const [url, options] = fetchMock.mock.calls[0];
    expect(url).toBe(webhookUrl);
    expect(options.method).toBe("POST");

    const body = JSON.parse(options.body);
    expect(body.borrowerId).toBe(loan.borrower_id);
    expect(body.loanId).toBe(loan.id);
    expect(body.dueDate).toBe(loan.due_at);
    expect(body.paymentAmount).toBe(800); // 1000 - 200
  });

  it("throws when the webhook returns a non-OK status", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, status: 503 }));
    await expect(sendWebhookNotification(makeLoan(), webhookUrl)).rejects.toThrow("HTTP 503");
  });

  it("throws on network failure", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("Network error")));
    await expect(sendWebhookNotification(makeLoan(), webhookUrl)).rejects.toThrow("Network error");
  });
});

// ── markLoanNotified ──────────────────────────────────────────────────────────

describe("markLoanNotified", () => {
  beforeEach(() => vi.clearAllMocks());

  it("merges the notified timestamp into loans.metadata with an update", async () => {
    db = createFakeDb();
    db.queue([]);

    await markLoanNotified("loan-1");

    const methods = db.calls.map((c) => c.method);
    expect(methods).toEqual(expect.arrayContaining(["update", "set", "where"]));
    const set = db.calls.find((c) => c.method === "set")?.args[0] as { metadata?: unknown };
    expect(set.metadata).toBeDefined();
  });

  it("throws when the database is not configured", async () => {
    db = null;
    await expect(markLoanNotified("loan-1")).rejects.toThrow("Database unavailable");
  });
});

// ── runPaymentDueScheduler ────────────────────────────────────────────────────

describe("runPaymentDueScheduler", () => {
  const webhookUrl = "https://example.com/webhook";

  beforeEach(() => {
    vi.clearAllMocks();
    process.env.WEBHOOK_NOTIFICATION_URL = webhookUrl;
  });

  afterEach(() => {
    delete process.env.WEBHOOK_NOTIFICATION_URL;
  });

  it("returns succeeded count when all notifications succeed", async () => {
    primeDueLoans([makeLoan()]);
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true }));

    const result = await runPaymentDueScheduler();

    expect(result.processed).toBe(1);
    expect(result.succeeded).toBe(1);
    expect(result.failed).toBe(0);
  });

  it("records failure without stopping other loans", async () => {
    primeDueLoans([makeLoan({ id: "loan-1" }), makeLoan({ id: "loan-2" })]);

    let callCount = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation(() => {
        callCount++;
        if (callCount === 1) return Promise.reject(new Error("Network error"));
        return Promise.resolve({ ok: true });
      })
    );

    const result = await runPaymentDueScheduler();

    expect(result.processed).toBe(2);
    expect(result.succeeded).toBe(1);
    expect(result.failed).toBe(1);
    expect(result.errors[0]).toContain("loan-1");
  });

  it("returns zero processed for empty result set", async () => {
    primeDueLoans([]);

    const result = await runPaymentDueScheduler();

    expect(result.processed).toBe(0);
    expect(result.succeeded).toBe(0);
  });

  it("throws when WEBHOOK_NOTIFICATION_URL is not configured", async () => {
    delete process.env.WEBHOOK_NOTIFICATION_URL;
    await expect(runPaymentDueScheduler()).rejects.toThrow("WEBHOOK_NOTIFICATION_URL");
  });
});
