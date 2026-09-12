import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";
import type { KycApplicantResult } from "@/lib/kyc/types";
import { createFakeDb, type FakeDb } from "../../helpers/fake-db";

// ── Mock auth (session) ───────────────────────────────────────────────────────
const mockRequireAuthenticatedUser = vi.fn();
vi.mock("@/lib/auth/session", () => ({
  requireAuthenticatedUser: (...args: unknown[]) => mockRequireAuthenticatedUser(...args),
}));

// ── Mock database ─────────────────────────────────────────────────────────────
const mockGetDb = vi.fn();
vi.mock("@/lib/db/client", () => ({
  getDb: () => mockGetDb(),
}));

// ── Mock the SumSub provider ───────────────────────────────────────────────────
const mockCreateApplicant = vi.fn();
const mockGetApplicantId = vi.fn();
const mockGenerateSdkToken = vi.fn();
vi.mock("@/lib/kyc/provider", () => ({
  createApplicant: (...args: unknown[]) => mockCreateApplicant(...args),
  getApplicantId: (...args: unknown[]) => mockGetApplicantId(...args),
  generateSdkToken: (...args: unknown[]) => mockGenerateSdkToken(...args),
}));

import { POST, GET } from "@/app/api/kyc/token/route";

const TOKEN_RESULT: KycApplicantResult = {
  applicantId: "appl-123",
  token: "sdk-token-abc",
  expiresAt: "2026-08-26T00:00:00.000Z",
};

function user(role: "borrower" | "lender" | "admin") {
  return { user: { id: "user-1", email: "a@b.com", fullName: "", walletAddress: "GABC" }, role };
}

/** Database whose first profiles lookup resolves to `profile` (camelCase columns). */
function makeDb(profile: Record<string, unknown> | null): FakeDb {
  const db = createFakeDb();
  db.queue(profile ? [profile] : []);
  mockGetDb.mockReturnValue(db);
  return db;
}

/** The `set({...})` payload of the first update issued on the fake db. */
function persistedUpdate(db: FakeDb): Record<string, unknown> {
  const set = db.calls.find((c) => c.method === "set");
  return (set?.args[0] ?? {}) as Record<string, unknown>;
}

function post() {
  return POST(new NextRequest("http://localhost/api/kyc/token", { method: "POST" }));
}

describe("POST /api/kyc/token", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("issues a KYC SDK token for a lender (issue #262 — AC1)", async () => {
    mockRequireAuthenticatedUser.mockResolvedValue(user("lender"));
    const db = makeDb({ fullName: "Jane Lender", kycProviderId: null, kycStatus: "pending" });
    mockGetApplicantId.mockResolvedValue(null);
    mockCreateApplicant.mockResolvedValue("appl-lender-1");
    mockGenerateSdkToken.mockResolvedValue(TOKEN_RESULT);

    const response = await post();

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(TOKEN_RESULT);
    expect(mockCreateApplicant).toHaveBeenCalledWith("user-1", "a@b.com", "Jane Lender");
    expect(mockGenerateSdkToken).toHaveBeenCalledWith("appl-lender-1", "user-1");
    // Provider id persisted on the profile
    expect(db.calls.some((c) => c.method === "update")).toBe(true);
    expect(persistedUpdate(db).kycProviderId).toBe("appl-lender-1");
  });

  it("reuses an existing applicant found via the provider and persists it", async () => {
    mockRequireAuthenticatedUser.mockResolvedValue(user("borrower"));
    const db = makeDb({ fullName: "Bob Borrower", kycProviderId: null, kycStatus: "submitted" });
    mockGetApplicantId.mockResolvedValue("appl-existing");
    mockGenerateSdkToken.mockResolvedValue(TOKEN_RESULT);

    const response = await post();

    expect(response.status).toBe(200);
    expect(mockCreateApplicant).not.toHaveBeenCalled();
    expect(mockGenerateSdkToken).toHaveBeenCalledWith("appl-existing", "user-1");
    // Persisted with the existing (non-pending) status preserved
    const persisted = persistedUpdate(db);
    expect(persisted.kycProviderId).toBe("appl-existing");
    expect(persisted.kycStatus).toBe("submitted");
  });

  it("redirects admins away instead of issuing a customer KYC token", async () => {
    mockRequireAuthenticatedUser.mockResolvedValue(user("admin"));

    await expect(post()).rejects.toThrow(/NEXT_REDIRECT/);
    expect(mockGenerateSdkToken).not.toHaveBeenCalled();
  });

  it("returns 503 when the database is unavailable", async () => {
    mockRequireAuthenticatedUser.mockResolvedValue(user("lender"));
    mockGetDb.mockReturnValue(null);

    const response = await post();

    expect(response.status).toBe(503);
    expect(mockGenerateSdkToken).not.toHaveBeenCalled();
  });

  it("returns 500 when the provider fails", async () => {
    mockRequireAuthenticatedUser.mockResolvedValue(user("lender"));
    makeDb({ fullName: "Jane Lender", kycProviderId: null, kycStatus: "pending" });
    mockGetApplicantId.mockResolvedValue(null);
    mockCreateApplicant.mockRejectedValue(new Error("SumSub API error 401"));

    const response = await post();

    expect(response.status).toBe(500);
    const payload = await response.json();
    expect(payload.error).toContain("SumSub API error 401");
  });
});

describe("GET /api/kyc/token", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns the current KYC status for a lender", async () => {
    mockRequireAuthenticatedUser.mockResolvedValue(user("lender"));
    makeDb({
      kycStatus: "verified",
      kycProviderId: "appl-lender-1",
      kycSubmittedAt: new Date("2026-08-01T00:00:00.000Z"),
      kycVerifiedAt: new Date("2026-08-02T00:00:00.000Z"),
      kycRejectionReason: null,
      regulatedPoolAccess: true,
    });

    const response = await GET(new NextRequest("http://localhost/api/kyc/token"));

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      kycStatus: "verified",
      applicantId: "appl-lender-1",
      submittedAt: "2026-08-01T00:00:00.000Z",
      regulatedPoolAccess: true,
    });
  });

  it("defaults to pending when no profile exists", async () => {
    mockRequireAuthenticatedUser.mockResolvedValue(user("lender"));
    makeDb(null);

    const response = await GET(new NextRequest("http://localhost/api/kyc/token"));

    expect(response.status).toBe(200);
    expect((await response.json()).kycStatus).toBe("pending");
  });

  it("returns 401 when the status lookup fails", async () => {
    mockRequireAuthenticatedUser.mockResolvedValue(user("lender"));
    const db = createFakeDb();
    db.select = () => {
      throw new Error("db down");
    };
    mockGetDb.mockReturnValue(db);

    const response = await GET(new NextRequest("http://localhost/api/kyc/token"));

    expect(response.status).toBe(401);
  });
});
