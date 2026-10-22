/**
 * Retry policy for catalogue reads.
 *
 * Retried: transport failures, 429, and 5xx.
 * Never retried: 400/401/403/404/422, scope errors, and schema mismatches.
 * A 401 is handled separately by the sync service: refresh once, replay the
 * page once, then stop.
 *
 * Delays are injectable (`sleep`) so tests never wait in real time. When Salla
 * sends `Retry-After`, the value is honoured exactly; if it exceeds the budget
 * the run stops instead of retrying earlier than the provider asked.
 */

export const DEFAULT_MAX_ATTEMPTS = 3;
export const BASE_RETRY_DELAY_MS = 500;
export const MAX_RETRY_DELAY_MS = 30_000;

/** Longest `Retry-After` this run is willing to wait for before giving up. */
export const MAX_RETRY_AFTER_MS = 30_000;

export type FailureKind = "network" | "rate_limited" | "server" | "client" | "auth" | "schema";

export function isRetryableKind(kind: FailureKind): boolean {
  return kind === "network" || kind === "rate_limited" || kind === "server";
}

export function shouldRetry(input: {
  kind: FailureKind;
  attempt: number;
  maxAttempts?: number;
}): boolean {
  const maxAttempts = input.maxAttempts ?? DEFAULT_MAX_ATTEMPTS;
  return isRetryableKind(input.kind) && input.attempt < maxAttempts - 1;
}

export function retryDelayMs(input: { attempt: number; retryAfterSeconds?: number }): number {
  if (input.retryAfterSeconds !== undefined && input.retryAfterSeconds >= 0) {
    return Math.ceil(input.retryAfterSeconds * 1000);
  }

  const exponential = BASE_RETRY_DELAY_MS * 2 ** input.attempt;
  return Math.min(MAX_RETRY_DELAY_MS, exponential);
}

/** A header we cannot wait for must stop the run, never shorten the wait. */
export function fitsRetryBudget(retryAfterSeconds?: number): boolean {
  return retryAfterSeconds === undefined || retryAfterSeconds * 1000 <= MAX_RETRY_AFTER_MS;
}
