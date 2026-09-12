import { describe, it, expect, vi, beforeEach } from "vitest";

// ── Mock the server-side contract invoker (no real RPC in tests) ───────────────
const mockGetAdminKeypair = vi.fn();
const mockGetLedgerTimeSecs = vi.fn();
const mockInvokeSigned = vi.fn();

vi.mock("@/lib/stellar/server-contract", () => ({
  getAdminKeypair: () => mockGetAdminKeypair(),
  getLedgerTimeSecs: () => mockGetLedgerTimeSecs(),
  invokeSigned: (...args: unknown[]) => mockInvokeSigned(...args),
  addr: (g: string) => ({ addr: g }),
  u32: (n: number) => ({ u32: n }),
  u64: (n: number) => ({ u64: n }),
  i128: (n: bigint) => ({ i128: n }),
  tupleEnumToScVal: (variant: string, fields: unknown[]) => ({ variant, fields }),
  xlmToStroops: (xlm: number) => BigInt(Math.round(xlm * 10_000_000)),
}));

// ── Mock the database ─────────────────────────────────────────────────────────
import { createFakeDb } from "../helpers/fake-db";
let db = createFakeDb();
vi.mock("@/lib/db/client", () => ({
  getDb: () => db,
}));

import {
  computeDaysOverdue,
  runDefaultManagement,
} from "@/lib/scheduler/default-management";

const DAY = 86_400;

// ── computeDaysOverdue (pure) ──────────────────────────────────────────────────

describe("computeDaysOverdue", () => {
  it("returns 0 when not yet overdue", () => {
    const now = 1_000_000_000;
    const due = new Date((now + DAY) * 1000).toISOString();
    expect(computeDaysOverdue(due, now)).toBe(0);
  });

  it("returns whole days overdue using ledger time", () => {
    const now = 1_000_000_000;
    const due = new Date((now - 30 * DAY) * 1000).toISOString();
    expect(computeDaysOverdue(due, now)).toBe(30);
  });

  it("floors partial days", () => {
    const now = 1_000_000_000;
    const due = new Date((now - (5 * DAY + 3600)) * 1000).toISOString();
    expect(computeDaysOverdue(due, now)).toBe(5);
  });
});

// ── runDefaultManagement ───────────────────────────────────────────────────────

/**
 * Queue the results the run will read, in order: the overdue-loans query,
 * then per loan the funding ledger row and the borrower's wallet, then any
 * metadata-flag update.
 */
function makeDb(loans: ReturnType<typeof overdueLoan>[], perLoan: unknown[][]) {
  db = createFakeDb();
  db.queue(
    loans.map((l) => ({
      id: l.id,
      borrowerId: l.borrower_id,
      status: l.status,
      principalAmount: String(l.principal_amount),
      repaidAmount: String(l.repaid_amount),
      dueAt: l.due_at ? new Date(l.due_at as string) : null,
      defaultedAt: l.defaulted_at ? new Date(l.defaulted_at as string) : null,
      metadata: l.metadata,
    })),
  );
  for (const rows of perLoan) db.queue(rows);
  return db;
}

const NOW = 1_700_000_000;

function overdueLoan(daysOverdue: number, overrides: Record<string, unknown> = {}) {
  return {
    id: "loan-1",
    borrower_id: "borrower-1",
    status: "active",
    principal_amount: 1000,
    repaid_amount: 0,
    due_at: new Date((NOW - daysOverdue * DAY) * 1000).toISOString(),
    defaulted_at: null,
    metadata: {},
    ...overrides,
  };
}

describe("runDefaultManagement", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetLedgerTimeSecs.mockResolvedValue(NOW);
    mockGetAdminKeypair.mockReturnValue(null); // DB-only mode (no on-chain calls)
  });

  it("skips loans still within the grace period", async () => {
    makeDb([overdueLoan(3)], []);
    const res = await runDefaultManagement();
    expect(res.scanned).toBe(1);
    expect(res.defaulted).toBe(0);
    expect(res.payoutsProposed).toBe(0);
    expect(res.outcomes[0].skipped).toContain("grace period");
  });

  it("marks a past-grace loan defaulted (no payout before insurance threshold)", async () => {
    // read order: ledger funding info, borrower wallet, then the flag update
    makeDb(
      [overdueLoan(30)],
      [
        [{ metadata: { lenderAddress: "GLENDER", onchainLoanId: 7 }, amount: "1000" }],
        [{ walletAddress: "GBORROWER" }],
        [],
      ]
    );
    const res = await runDefaultManagement();
    expect(res.defaulted).toBe(1);
    expect(res.payoutsProposed).toBe(0);
    expect(res.failed).toBe(0);
    expect(res.outcomes[0].actions).toContain("db:status=defaulted");
  });

  it("does not re-default an already-defaulted loan", async () => {
    makeDb(
      [overdueLoan(30, { defaulted_at: new Date(NOW * 1000).toISOString() })],
      [
        [{ metadata: { lenderAddress: "GLENDER", onchainLoanId: 7 }, amount: "1000" }],
        [{ walletAddress: "GBORROWER" }],
      ]
    );
    const res = await runDefaultManagement();
    expect(res.defaulted).toBe(0);
    expect(res.payoutsProposed).toBe(0);
  });

  it("reports counts and never throws on a clean run", async () => {
    makeDb([], []);
    const res = await runDefaultManagement();
    expect(res).toMatchObject({ scanned: 0, defaulted: 0, payoutsProposed: 0, failed: 0 });
    expect(res.ledgerTime).toBe(new Date(NOW * 1000).toISOString());
  });
});
