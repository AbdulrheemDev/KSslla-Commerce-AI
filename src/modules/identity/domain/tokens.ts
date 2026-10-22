import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

/**
 * Opaque token handling.
 *
 * Tokens are high-entropy random strings; only an HMAC-SHA256 digest keyed with
 * `AUTH_SECRET` is persisted. A database leak therefore does not yield usable
 * session or invitation tokens.
 */

export function generateOpaqueToken(byteLength = 32): string {
  return randomBytes(byteLength).toString("base64url");
}

export function hashToken(token: string, secret: string): string {
  return createHmac("sha256", secret).update(token, "utf8").digest("hex");
}

export function safeCompare(a: string, b: string): boolean {
  const left = Buffer.from(a, "utf8");
  const right = Buffer.from(b, "utf8");
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}
