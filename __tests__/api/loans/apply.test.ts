import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

// ── Mock Auth ─────────────────────────────────────────────────────────────────
const mockRequireAuthenticatedUser = vi.fn();
vi.mock("@/lib/auth/session", () => ({
  requireAuthenticatedUser: (...args: unknown[]) => mockRequireAuthenticatedUser(...args),
}));

// ── Mock Rate Limiter ─────────────────────────────────────────────────────────
vi.mock("@/lib/rate-limit", () => ({
  enforceRouteRateLimit: vi.fn().mockResolvedValue(null),
}));

// ── Mock KYC Guard ────────────────────────────────────────────────────────────
vi.mock("@/lib/kyc/middleware", () => ({
  requireKycVerified: vi.fn().mockResolvedValue({ allowed: true, kycStatus: "verified" }),
}));

// ── Mock Notifications ────────────────────────────────────────────────────────
vi.mock("@/lib/notifications", () => ({
  createNotification: vi.fn().mockResolvedValue({ id: "notif-1" }),
}));

// ── Mock database ─────────────────────────────────────────────────────────────
const mockGetDb = vi.fn();
vi.mock("@/lib/db/client", () => ({
  getDb: () => mockGetDb(),
}));

import { POST } from "@/app/api/loans/apply/route";
import { createFakeDb } from "../../helpers/fake-db";

function makeMockRequest(body: Record<string, unknown>) {
  return new NextRequest("http://localhost/api/loans/apply", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("POST /api/loans/apply - Minimum Borrow Amount Validation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRequireAuthenticatedUser.mockResolvedValue({
      user: { id: "borrower-123", email: "borrower@example.com" },
      role: "borrower",
    });
  });

  it("rejects dust loan amount below 1 XLM with 400 status", async () => {
    mockGetDb.mockReturnValue(createFakeDb());

    const req = makeMockRequest({
      amount: 0.0000001,
      durationDays: 30,
      rateModel: "fixed",
    });

    const res = await POST(req);
    expect(res.status).toBe(400);

    const json = await res.json();
    expect(json.error).toContain("minimum borrow amount is 1 XLM");
  });

  it("rejects zero or negative loan amounts with 400 status", async () => {
    mockGetDb.mockReturnValue(createFakeDb());

    const req = makeMockRequest({
      amount: 0,
      durationDays: 30,
      rateModel: "fixed",
    });

    const res = await POST(req);
    expect(res.status).toBe(400);

    const json = await res.json();
    expect(json.error).toContain("minimum borrow amount is 1 XLM");
  });
});
