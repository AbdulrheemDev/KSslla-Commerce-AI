import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * Salla webhook signature verification.
 *
 * Documented scheme (docs/salla-reference.md §14.2):
 * - header `X-Salla-Security-Strategy` carries the strategy name (`Signature`);
 * - header `X-Salla-Signature` carries a hex HMAC-SHA256 of the request body
 *   keyed by the webhook secret.
 *
 * The **raw** body is hashed, never a re-serialised `JSON.parse` result. The
 * documentation's Node sample re-serialises `req.body`, while its PHP sample
 * reads `php://input`; only the raw body is stable across key order, whitespace,
 * and unicode escaping, so this module hashes what arrived (ADR-045).
 */

export const SALLA_SIGNATURE_HEADER = "x-salla-signature";
export const SALLA_SECURITY_STRATEGY_HEADER = "x-salla-security-strategy";
export const SALLA_WEBHOOK_VERSION_HEADER = "x-salla-webhook-version";

/** The only strategy this implementation verifies. */
export const SUPPORTED_STRATEGY = "signature";

export type SignatureFailure =
  "secret_not_configured" | "missing_signature" | "unsupported_strategy" | "invalid_signature";

export type SignatureResult =
  | { ok: true; strategy: string; strategyHeaderPresent: boolean }
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
 * `timingSafeEqual` needs equal-length buffers, so the length check happens
 * first and returns `false` without comparing content.
 */
export function safeEqualHex(expected: string, received: string): boolean {
  return safeEqualString(expected, received);
}

/**
 * Verifies a delivery.
 *
 * A missing strategy header is accepted when the signature verifies: Salla
 * documents `Signature` as the default strategy for apps, and rejecting on an
 * absent header would break a documented default. A header naming any other
 * strategy (`Token`) is rejected — this build implements the documented
 * signature strategy only, and silently accepting a token delivery would mean
 * accepting an unverified body.
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

  if (!signature || signature.trim().length === 0) {
    return { ok: false, reason: "missing_signature" };
  }

  if (strategyHeaderPresent && strategy.trim().toLowerCase() !== SUPPORTED_STRATEGY) {
    return { ok: false, reason: "unsupported_strategy" };
  }

  const expected = signSallaWebhookBody(rawBody, secret);
  const received = signature.trim().toLowerCase();

  if (!safeEqualHex(expected, received)) {
    return { ok: false, reason: "invalid_signature" };
  }

  return {
    ok: true,
    strategy: strategyHeaderPresent ? strategy.trim() : SUPPORTED_STRATEGY,
    strategyHeaderPresent,
  };
}
