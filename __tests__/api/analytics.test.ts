import { beforeEach, describe, expect, it, vi } from "vitest";
import type { NextRequest } from "next/server";
import { GET } from "@/app/api/analytics/route";
import {
  clearAnalyticsMemoryCacheForTests,
} from "@/lib/analytics-cache";

import { createFakeDb } from "../helpers/fake-db";

const mockGetDb = vi.fn();
const mockGetCachedPlatformAnalytics = vi.fn();
const mockSetCachedPlatformAnalytics = vi.fn();

vi.mock("@/lib/db/client", () => ({
  getDb: () => mockGetDb(),
}));

vi.mock("@/lib/analytics-cache", () => ({
  getCachedPlatformAnalytics: () => mockGetCachedPlatformAnalytics(),
  setCachedPlatformAnalytics: (...args: unknown[]) => mockSetCachedPlatformAnalytics(...args),
  clearAnalyticsMemoryCacheForTests: vi.fn(),
}));

/**
 * fetchPlatformAnalytics runs four queries in parallel (loans, pool positions,
 * repayments, ledger); queue the results in that order.
 */
function createDbStub() {
  const db = createFakeDb();
  db.queue([
    { principal_amount: "1000", status: "funded" },
    { principal_amount: "2500", status: "active" },
  ]);
  db.queue([
    { principal_amount: "4000", earned_interest: "120", status: "active" },
    { principal_amount: "500", earned_interest: "40", status: "closed" },
  ]);
  db.queue([{ amount: "600" }, { amount: "500" }]);
  db.queue([
    { amount: "1200", user_id: "u1", status: "confirmed", created_at: new Date() },
    { amount: "800", user_id: "u2", status: "confirmed", created_at: new Date() },
    { amount: "300", user_id: "u3", status: "pending", created_at: new Date() },
  ]);
  return db;
}

describe("GET /api/analytics", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    clearAnalyticsMemoryCacheForTests();
    mockGetCachedPlatformAnalytics.mockReset();
    mockSetCachedPlatformAnalytics.mockReset();
  });

  it("returns a cached payload without hitting the database", async () => {
    const cachedPayload = {
      success: true,
      metrics: {
        tvl: 123,
        totalRepaid: 45,
        platformYields: 67,
        activeUsers: 8,
        cumulativeTransactionVolume: 90,
      },
      generatedAt: "2026-06-29T00:00:00.000Z",
    };

    mockGetCachedPlatformAnalytics.mockResolvedValue(cachedPayload);

    const response = await GET({
      nextUrl: new URL("http://localhost/api/analytics"),
      headers: new Headers({ "x-forwarded-for": "127.0.0.1" }),
    } as unknown as NextRequest);

    expect(response.status).toBe(200);
    expect(mockGetDb).not.toHaveBeenCalled();
    expect(mockSetCachedPlatformAnalytics).not.toHaveBeenCalled();
    expect(await response.json()).toEqual(cachedPayload);
    expect(response.headers.get("x-analytics-cache")).toBe("hit");
  });

  it("returns aggregated platform metrics and stores them in cache", async () => {
    mockGetCachedPlatformAnalytics.mockResolvedValue(null);
    mockGetDb.mockReturnValue(createDbStub());

    const response = await GET({
      nextUrl: new URL("http://localhost/api/analytics"),
      headers: new Headers({ "x-forwarded-for": "127.0.0.1" }),
    } as unknown as NextRequest);

    expect(response.status).toBe(200);

    const payload = await response.json();
    expect(payload.success).toBe(true);
    expect(payload.metrics).toMatchObject({
      tvl: 7500,
      totalRepaid: 1100,
      platformYields: 160,
      activeUsers: 2,
      cumulativeTransactionVolume: 2000,
    });
    expect(response.headers.get("cache-control")).toContain("max-age=3600");
    expect(response.headers.get("x-analytics-cache")).toBe("miss");
    expect(mockSetCachedPlatformAnalytics).toHaveBeenCalledTimes(1);
  });

  it("returns a service unavailable response when the client cannot be created", async () => {
    mockGetCachedPlatformAnalytics.mockResolvedValue(null);
    mockGetDb.mockReturnValue(null);

    const response = await GET({
      nextUrl: new URL("http://localhost/api/analytics"),
      headers: new Headers({ "x-forwarded-for": "127.0.0.1" }),
    } as unknown as NextRequest);

    expect(response.status).toBe(503);
    const payload = await response.json();
    expect(payload.error).toBe("Analytics service unavailable");
  });
});
