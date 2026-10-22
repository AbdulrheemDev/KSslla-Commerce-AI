/**
 * Internal processing retry policy.
 *
 * This is **our** policy for our own worker; it is not a claim about Salla's
 * delivery behaviour. Salla's documented delivery retry (three attempts about
 * five minutes apart, 30 s timeout) is recorded in docs/salla-reference §14.5
 * and only motivates keeping our own retries short and bounded.
 *
 * Deterministic schedule: after the 1st failure wait 1 minute, after the 2nd
 * wait 5 minutes, after the 3rd move to the dead-letter state.
 */

export const MAX_WEBHOOK_ATTEMPTS = 3;

/** Delay applied *after* the attempt with this 1-based number failed. */
export const RETRY_DELAYS_MS = [60_000, 300_000] as const;

export type RetryDecision =
  | { status: "failed"; attempt: number; availableAt: Date; delayMs: number }
  | { status: "dead_letter"; attempt: number; availableAt: Date };

/**
 * Decides what happens after an attempt failed.
 *
 * `attempt` is the 1-based number of the attempt that just failed (the claim
 * already incremented it).
 */
export function decideAfterFailure(attempt: number, now: Date, retryable: boolean): RetryDecision {
  const exhausted = attempt >= MAX_WEBHOOK_ATTEMPTS;

  if (!retryable || exhausted) {
    return { status: "dead_letter", attempt, availableAt: now };
  }

  const delayMs = RETRY_DELAYS_MS[Math.min(attempt - 1, RETRY_DELAYS_MS.length - 1)] ?? 0;
  return { status: "failed", attempt, availableAt: new Date(now.getTime() + delayMs), delayMs };
}

/**
 * Error codes that a later attempt could plausibly fix.
 *
 * Auth/permission problems and contract violations are not retryable: repeating
 * them wastes rate limit and hides a configuration fault behind noise.
 */
const RETRYABLE_CODES = new Set([
  "INTEGRATION_ERROR",
  "RATE_LIMITED",
  "CONFLICT",
  "AI_PROVIDER_ERROR",
  "INTERNAL",
]);

const NON_RETRYABLE_CODES = new Set([
  "INTEGRATION_AUTH_REQUIRED",
  "INTEGRATION_NOT_CONNECTED",
  "INTEGRATION_NOT_CONFIGURED",
  "FORBIDDEN",
  "UNAUTHENTICATED",
  "NOT_FOUND",
  "VALIDATION_FAILED",
  "TENANT_ISOLATION_VIOLATION",
  "CONFIG_INVALID",
]);

export function isRetryableErrorCode(code: string): boolean {
  if (NON_RETRYABLE_CODES.has(code)) return false;
  if (RETRYABLE_CODES.has(code)) return true;

  // Unknown codes default to retryable: an unexpected failure is more likely to
  // be transient than permanent, and the attempt ceiling still bounds the work.
  return true;
}
