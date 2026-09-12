/**
 * lib/auth/siws-server.ts
 *
 * Server-side Sign-In with Stellar (SEP-0010) logic:
 *   1. buildChallenge()  — generate a signed SEP-10 challenge transaction
 *   2. verifyChallenge() — validate structure, expiry and the wallet signature
 *   3. issueSessionForWallet() — upsert the users/profiles rows for the wallet
 *
 * SERVER-ONLY. Reads SIWS_SERVER_SECRET and the database.
 */

import { eq } from "drizzle-orm";
import { Keypair, StrKey, Transaction, WebAuth } from "@stellar/stellar-sdk";
import { SIWS_NETWORK_PASSPHRASE, getSiwsDomain } from "@/lib/auth/siws-config";
import { normalizeUserRole, type UserRole } from "@/lib/auth/roles";
import { getDb } from "@/lib/db/client";
import { profiles, users } from "@/lib/db/schema";

/** SEP-10 challenge validity window (seconds). */
const CHALLENGE_TIMEOUT_SECS = 300;

// ─── Typed errors → clean HTTP states ─────────────────────────────────────────

export type SiwsErrorCode =
  | "invalid_address"
  | "not_configured"
  | "invalid_challenge"
  | "expired_challenge"
  | "invalid_signature"
  | "address_mismatch"
  | "session_failed";

export class SiwsError extends Error {
  constructor(
    public code: SiwsErrorCode,
    message: string,
    /** HTTP status the API route should return. */
    public status: number
  ) {
    super(message);
    this.name = "SiwsError";
  }
}

// ─── Config ───────────────────────────────────────────────────────────────────

/** The SEP-10 server signing keypair (its public key is the challenge source). */
function getServerKeypair(): Keypair {
  const secret = process.env.SIWS_SERVER_SECRET;
  if (!secret) {
    throw new SiwsError(
      "not_configured",
      "SIWS is not configured on the server (SIWS_SERVER_SECRET missing).",
      503
    );
  }
  try {
    return Keypair.fromSecret(secret);
  } catch {
    throw new SiwsError("not_configured", "SIWS_SERVER_SECRET is not a valid Stellar secret key.", 503);
  }
}

/** Public server signing key — safe to expose (advertised in a SEP-1 toml). */
export function getServerSigningKey(): string {
  return getServerKeypair().publicKey();
}

export function assertValidStellarAddress(address: string): void {
  if (typeof address !== "string" || !StrKey.isValidEd25519PublicKey(address)) {
    throw new SiwsError("invalid_address", "A valid Stellar public key (G...) is required.", 400);
  }
}

// ─── 1. Build challenge ───────────────────────────────────────────────────────

export function buildChallenge(address: string): { transaction: string; networkPassphrase: string } {
  assertValidStellarAddress(address);
  const server = getServerKeypair();
  const domain = getSiwsDomain();

  const transaction = WebAuth.buildChallengeTx(
    server,
    address,
    domain,
    CHALLENGE_TIMEOUT_SECS,
    SIWS_NETWORK_PASSPHRASE,
    domain
  );

  return { transaction, networkPassphrase: SIWS_NETWORK_PASSPHRASE };
}

// ─── 2. Verify challenge ──────────────────────────────────────────────────────

/**
 * Validate a wallet-signed SEP-10 challenge. Returns the authenticated wallet
 * address on success; throws a typed `SiwsError` otherwise so the API can emit
 * clear invalid / expired states.
 */
export function verifyChallenge(signedTxXdr: string, expectedAddress: string): string {
  assertValidStellarAddress(expectedAddress);
  const serverKey = getServerSigningKey();
  const domain = getSiwsDomain();

  if (typeof signedTxXdr !== "string" || signedTxXdr.length < 20) {
    throw new SiwsError("invalid_challenge", "Missing or malformed signed challenge.", 400);
  }

  // Structure validation (sequence=0, single manage_data op, home domain, etc.)
  let clientAccountID: string;
  try {
    const result = WebAuth.readChallengeTx(
      signedTxXdr,
      serverKey,
      SIWS_NETWORK_PASSPHRASE,
      domain,
      domain
    );
    clientAccountID = result.clientAccountID;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (/expired|timebound|too far/i.test(msg)) {
      throw new SiwsError("expired_challenge", "The challenge has expired. Please try again.", 401);
    }
    throw new SiwsError("invalid_challenge", `Invalid challenge transaction: ${msg}`, 400);
  }

  // Explicit expiry check: this SDK's readChallengeTx validates structure but
  // does NOT enforce timeBounds against wall-clock time, so we check it here.
  const parsedForTimebounds = new Transaction(signedTxXdr, SIWS_NETWORK_PASSPHRASE);
  const maxTime = Number.parseInt(parsedForTimebounds.timeBounds?.maxTime ?? "0", 10);
  const nowSecs = Math.floor(Date.now() / 1000);
  if (maxTime > 0 && nowSecs > maxTime) {
    throw new SiwsError("expired_challenge", "The challenge has expired. Please try again.", 401);
  }

  if (clientAccountID !== expectedAddress) {
    throw new SiwsError(
      "address_mismatch",
      "The signed challenge does not match the provided wallet address.",
      400
    );
  }

  // Signature validation — the wallet must have signed the challenge.
  try {
    const signers = WebAuth.verifyChallengeTxSigners(
      signedTxXdr,
      serverKey,
      SIWS_NETWORK_PASSPHRASE,
      [expectedAddress],
      domain,
      domain
    );
    if (!signers.includes(expectedAddress)) {
      throw new SiwsError("invalid_signature", "The wallet signature is missing or invalid.", 401);
    }
  } catch (err) {
    if (err instanceof SiwsError) throw err;
    const msg = err instanceof Error ? err.message : String(err);
    if (/expired|timebound/i.test(msg)) {
      throw new SiwsError("expired_challenge", "The challenge has expired. Please try again.", 401);
    }
    throw new SiwsError("invalid_signature", `Signature verification failed: ${msg}`, 401);
  }

  return expectedAddress;
}

// ─── 3. Provision the wallet identity ─────────────────────────────────────────

export interface WalletIdentity {
  userId: string;
  role: UserRole;
  isNewUser: boolean;
}

/**
 * Ensure a `users` + `profiles` row exists for `address` and return the
 * identity the API route turns into a session cookie.
 *
 * Idempotent: signing in again just bumps `last_sign_in_at`. The role chosen on
 * the auth page only applies to brand-new accounts — an existing account keeps
 * whatever role it already has.
 */
export async function issueSessionForWallet(address: string, role?: string): Promise<WalletIdentity> {
  const db = getDb();
  if (!db) {
    throw new SiwsError("session_failed", "Database is not configured.", 503);
  }
  const requestedRole: UserRole = role === "lender" ? "lender" : "borrower";
  const now = new Date();

  const [existing] = await db
    .select({ id: users.id, role: users.role })
    .from(users)
    .where(eq(users.walletAddress, address))
    .limit(1);

  if (existing) {
    await db.update(users).set({ lastSignInAt: now }).where(eq(users.id, existing.id));
    // Heal a missing profile row (e.g. a partially failed first sign-in).
    await db
      .insert(profiles)
      .values({ id: existing.id, role: existing.role, walletAddress: address, fullName: shortName(address) })
      .onConflictDoNothing();
    return { userId: existing.id, role: normalizeUserRole(existing.role), isNewUser: false };
  }

  const [created] = await db
    .insert(users)
    .values({ walletAddress: address, role: requestedRole, lastSignInAt: now })
    .onConflictDoNothing({ target: users.walletAddress })
    .returning({ id: users.id, role: users.role });

  if (!created) {
    // Lost a race with a concurrent first sign-in for the same wallet.
    const [raced] = await db
      .select({ id: users.id, role: users.role })
      .from(users)
      .where(eq(users.walletAddress, address))
      .limit(1);
    if (!raced) {
      throw new SiwsError("session_failed", "Could not provision wallet account.", 500);
    }
    return { userId: raced.id, role: normalizeUserRole(raced.role), isNewUser: false };
  }

  await db
    .insert(profiles)
    .values({ id: created.id, role: requestedRole, walletAddress: address, fullName: shortName(address) })
    .onConflictDoNothing();

  return { userId: created.id, role: requestedRole, isNewUser: true };
}

/** "Stellar GABC…WXYZ" — the default display name for a wallet-only account. */
function shortName(address: string): string {
  return `Stellar ${address.slice(0, 4)}…${address.slice(-4)}`;
}
