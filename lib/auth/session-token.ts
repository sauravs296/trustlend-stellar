/**
 * lib/auth/session-token.ts
 *
 * Stateless session tokens. A signed JWT (HS256, `jose`) is stored in an
 * HttpOnly cookie after a successful SEP-10 sign-in. It carries only what the
 * edge proxy needs to route requests (user id, wallet, role); everything else
 * is looked up in the database by `lib/auth/session.ts`.
 *
 * This module is Edge-safe (no Node-only APIs) so proxy.ts can verify tokens
 * without a database round-trip.
 */

import { jwtVerify, SignJWT } from "jose";
import type { UserRole } from "@/lib/auth/roles";

export const SESSION_COOKIE_NAME = "tl_session";

/** Session lifetime in seconds (7 days). */
export const SESSION_TTL_SECONDS = 7 * 24 * 60 * 60;

export interface SessionClaims {
  /** users.id */
  sub: string;
  /** Stellar public key (G...) */
  wallet: string;
  role: UserRole;
}

function secretKey(): Uint8Array {
  const secret = process.env.SESSION_SECRET;
  if (!secret || secret.length < 32) {
    throw new Error(
      "SESSION_SECRET is missing or shorter than 32 characters. Generate one with `openssl rand -base64 48`.",
    );
  }
  return new TextEncoder().encode(secret);
}

/** True when a session secret is configured. */
export function isSessionSigningConfigured(): boolean {
  const secret = process.env.SESSION_SECRET;
  return typeof secret === "string" && secret.length >= 32;
}

export async function signSessionToken(claims: SessionClaims): Promise<string> {
  return new SignJWT({ wallet: claims.wallet, role: claims.role })
    .setProtectedHeader({ alg: "HS256", typ: "JWT" })
    .setSubject(claims.sub)
    .setIssuedAt()
    .setExpirationTime(`${SESSION_TTL_SECONDS}s`)
    .sign(secretKey());
}

/** Verify a token; returns null for anything invalid or expired. */
export async function verifySessionToken(token: string | undefined | null): Promise<SessionClaims | null> {
  if (!token) return null;
  if (!isSessionSigningConfigured()) return null;
  try {
    const { payload } = await jwtVerify(token, secretKey(), { algorithms: ["HS256"] });
    const sub = payload.sub;
    const wallet = payload.wallet;
    const role = payload.role;
    if (typeof sub !== "string" || typeof wallet !== "string") return null;
    const safeRole: UserRole = role === "lender" || role === "admin" ? role : "borrower";
    return { sub, wallet, role: safeRole };
  } catch {
    return null;
  }
}

/** Cookie attributes shared by set and clear so the browser matches them. */
export function sessionCookieOptions() {
  return {
    httpOnly: true,
    sameSite: "lax" as const,
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: SESSION_TTL_SECONDS,
  };
}
