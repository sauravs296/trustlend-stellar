import { NextResponse } from "next/server";
import { SESSION_COOKIE_NAME, sessionCookieOptions } from "@/lib/auth/session-token";

/**
 * POST /api/auth/signout
 *
 * Clears the session cookie. Sessions are stateless JWTs, so there is nothing
 * to revoke server-side; the cookie simply stops being sent.
 */
export async function POST() {
  const response = NextResponse.json({ ok: true });
  response.cookies.set(SESSION_COOKIE_NAME, "", { ...sessionCookieOptions(), maxAge: 0 });
  return response;
}
