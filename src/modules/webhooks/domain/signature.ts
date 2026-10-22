import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * Salla webhook signature verification.
 *
 * **Verified against the official docs on 2026-10-22**
 * (https://docs.salla.dev/webhooks · https://docs.salla.dev/421119m0 §Security
 * Strategies / Verify Webhooks Using Signature):
 *
 * - the delivery carries exactly two security headers —
 *   `X-Salla-Security-Strategy: Signature` and `X-Salla-Signature`;
 * - the signature is the request body's **64-character SHA256 hex** produced
 *   with the per-webhook `secret`;
 * - the docs' Node sample is
 *   `crypto.createHmac('sha256', secret).update(JSON.stringify(req.body)).digest('hex')`
 *   and the PHP sample is `hash_hmac('sha256', file_get_contents('php://input'), $secret)`.
 *
 * Both samples are HMAC-SHA256 keyed by the secret — **not** an unkeyed hash of
 * the body. This module implements the keyed algorithm and hashes the bytes that
 * actually arrived. The Node sample re-serialises a parsed object; doing the
 * same would tie validity to key order and whitespace, so the raw body is used
 * instead (ADR-045, restated in docs/salla-reference.md §14.10).
 *
 * The signature is never logged, never stored, and never returned to a caller —
 * only the outcome and its reason leave this module.
 */

export const SALLA_SIGNATURE_HEADER = "x-salla-signature";
export const SALLA_SECURITY_STRATEGY_HEADER = "x-salla-security-strategy";

/**
 * The only strategy this implementation verifies.
 *
 * Salla documents `Signature` (the default for every registered webhook) and
 * `Token`. Only `Signature` is specified in enough detail to verify a request,
 * so `Token` is refused rather than guessed (ADR-045).
 */
export const SUPPORTED_STRATEGY = "signature";

/** Canonical casing Salla documents, stored in `webhook_events.signature_strategy`. */
export const SIGNATURE_STRATEGY_NAME = "Signature";

/** SHA256 hex: exactly 64 lowercase hex characters after normalisation. */
export const SIGNATURE_HEX_PATTERN = /^[0-9a-f]{64}$/;

export type SignatureFailure =
  | "secret_not_configured"
  | "missing_signature"
  | "malformed_signature"
  | "unsupported_strategy"
  | "invalid_signature";

export type SignatureResult =
  | { ok: true; strategy: typeof SIGNATURE_STRATEGY_NAME; strategyHeaderPresent: boolean }
  | { ok: false; reason: SignatureFailure };

/** Hex HMAC-SHA256 of the raw body. Exported for the local simulator and tests. */
export function signSallaWebhookBody(rawBody: string, secret: string): string {
  return createHmac("sha256", secret).update(rawBody, "utf8").digest("hex");
}

/**
 * Constant-time comparison of two strings.
 *
 * `timingSafeEqual` needs equal-length buffers, so the length check happens
 * first and returns `false` without comparing content.
 */
export function safeEqualString(expected: string, received: string): boolean {
  const left = Buffer.from(expected, "utf8");
  const right = Buffer.from(received, "utf8");

  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}

/**
 * Constant-time comparison of two hex digests.
 *
 * Kept as a named helper because the digest comparison is the security-critical
 * call site: a plain `===` there would leak how many leading characters matched.
 */
export function safeEqualHex(expected: string, received: string): boolean {
  return safeEqualString(expected, received);
}

/**
 * Verifies a delivery.
 *
 * Decision order is deliberate:
 *
 * 1. no configured secret → refuse everything (never "accept unverified");
 * 2. no signature header → nothing to verify;
 * 3. a strategy header naming anything but `Signature` → refuse, even if a
 *    valid signature happens to accompany it. An unsupported strategy means we
 *    do not know what the header is proving;
 * 4. a signature that is not 64 hex characters → malformed, refused before any
 *    comparison;
 * 5. otherwise compare the HMAC in constant time.
 *
 * A **missing** strategy header is accepted when the digest verifies: Salla
 * documents `Signature` as the strategy it assigns by default, so absence means
 * the default rather than "unauthenticated". This is not a bypass — step 5 is
 * still mandatory, and a missing header with a wrong signature is rejected.
 */
export function verifySallaWebhookSignature(input: {
  rawBody: string;
  signature: string | null;
  strategy: string | null;
  secret: string | null | undefined;
}): SignatureResult {
  const { rawBody, signature, strategy, secret } = input;
  const strategyHeaderPresent = strategy !== null && strategy.trim().length > 0;

  if (!secret || secret.trim().length === 0) {
    return { ok: false, reason: "secret_not_configured" };
  }

  const received = signature?.trim().toLowerCase() ?? "";
  if (received.length === 0) {
    return { ok: false, reason: "missing_signature" };
  }

  if (strategyHeaderPresent && strategy.trim().toLowerCase() !== SUPPORTED_STRATEGY) {
    return { ok: false, reason: "unsupported_strategy" };
  }

  if (!SIGNATURE_HEX_PATTERN.test(received)) {
    return { ok: false, reason: "malformed_signature" };
  }

  const expected = signSallaWebhookBody(rawBody, secret);

  if (!safeEqualHex(expected, received)) {
    return { ok: false, reason: "invalid_signature" };
  }

  return {
    ok: true,
    strategy: SIGNATURE_STRATEGY_NAME,
    strategyHeaderPresent,
  };
}
