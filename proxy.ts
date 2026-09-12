import { type NextRequest, NextResponse } from "next/server";
import { getDashboardPath, normalizeUserRole } from "@/lib/auth/roles";
import { SESSION_COOKIE_NAME, verifySessionToken } from "@/lib/auth/session-token";
import { recordRequestMetrics } from "@/lib/monitoring/metrics";
import { enforceGlobalApiRateLimit } from "@/lib/rate-limit";

const DEV_BYPASS_ENABLED =
  process.env.NODE_ENV !== "production" &&
  process.env.ENABLE_DEV_AUTH_BYPASS === "true";

function isValidUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

export async function proxy(request: NextRequest) {
  const pathname = request.nextUrl.pathname;
  const method = request.method;
  const start = performance.now();

  // ── ① Short-circuit for static assets — no auth check needed ────────────────
  const isStatic =
    pathname.startsWith("/_next/") ||
    pathname.startsWith("/favicon") ||
    /\.(?:svg|png|jpg|jpeg|gif|webp|ico|woff2?|ttf|otf|css|js|map)$/.test(pathname);
  if (isStatic) return NextResponse.next({ request });

  const bypassUserId = request.headers.get("x-dev-user-id")?.trim() ?? "";
  const bypassRoleRaw = request.headers.get("x-dev-role")?.trim();
  const bypassActive = DEV_BYPASS_ENABLED && !!bypassUserId && isValidUuid(bypassUserId);

  // ── ② Global rate limit on API routes ───────────────────────────────────────
  // Hard ceiling of 100 requests per minute per IP across all `/api/*` routes.
  // Per-route granular limits (lib/rate-limit.ts) remain the primary control;
  // this is the safety net against brute-force and misconfigured clients.
  if (pathname.startsWith("/api/")) {
    const rateLimited = await enforceGlobalApiRateLimit(request);

    if (rateLimited) {
      const duration = (performance.now() - start) / 1000;
      recordRequestMetrics(method, pathname, 429, duration);
      return rateLimited;
    }
  }

  // ── ③ Session cookie check (NO NETWORK CALL) ────────────────────────────────
  // The cookie is a signed JWT, so the edge can verify it locally. Whether the
  // user still exists is checked by requireAuthenticatedUser() in each
  // protected page / API route.
  const claims = bypassActive
    ? { sub: bypassUserId, role: normalizeUserRole(bypassRoleRaw) }
    : await verifySessionToken(request.cookies.get(SESSION_COOKIE_NAME)?.value);

  const isDashboardPath = pathname === "/dashboard" || pathname.startsWith("/dashboard/");
  const isAuthEntryPath = pathname === "/auth";

  if (isDashboardPath && !claims) {
    const duration = (performance.now() - start) / 1000;
    recordRequestMetrics(method, pathname, 302, duration);
    const redirectUrl = request.nextUrl.clone();
    redirectUrl.pathname = "/auth";
    redirectUrl.search = "";
    return NextResponse.redirect(redirectUrl);
  }

  if (isAuthEntryPath && claims) {
    const duration = (performance.now() - start) / 1000;
    recordRequestMetrics(method, pathname, 302, duration);
    const redirectUrl = request.nextUrl.clone();
    redirectUrl.pathname = getDashboardPath(normalizeUserRole(claims.role));
    redirectUrl.search = "";
    return NextResponse.redirect(redirectUrl);
  }

  return NextResponse.next({ request });
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
