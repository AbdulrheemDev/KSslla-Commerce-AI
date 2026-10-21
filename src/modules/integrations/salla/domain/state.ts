import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

/**
 * OAuth `state` handling.
 *
 * A state is 256 bits of CSPRNG output, valid for ten minutes, stored only as an
 * HMAC so a database dump cannot be replayed as a callback URL. Consumption is
 * enforced by the database (`used_at IS NULL` conditional update), not by the
 * presence of the row alone.
 */
export const OAUTH_STATE_TTL_MS = 10 * 60 * 1000;

export function generateOAuthState(): string {
  return randomBytes(32).toString("base64url");
}

/** HMAC-SHA256 of the state value. The secret is the app's AUTH_SECRET. */
export function hashOAuthState(state: string, secret: string): string {
  return createHmac("sha256", secret).update(state).digest("hex");
}

export function isWellFormedState(state: string | null | undefined): boolean {
  if (!state) return false;
  // base64url of 32 bytes = 43 characters; allow a small range for forward compat.
  return /^[A-Za-z0-9_-]{32,128}$/.test(state);
}

export function getStateExpiry(now: Date = new Date()): Date {
  return new Date(now.getTime() + OAUTH_STATE_TTL_MS);
}

export function isStateExpired(expiresAt: Date, now: Date = new Date()): boolean {
  return expiresAt.getTime() <= now.getTime();
}

/** Constant-time comparison for equal-length hex digests. */
export function stateHashesEqual(a: string, b: string): boolean {
  const left = Buffer.from(a, "utf8");
  const right = Buffer.from(b, "utf8");
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}
