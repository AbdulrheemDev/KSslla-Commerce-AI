import { describe, expect, it } from "vitest";

import {
  BASE_RETRY_DELAY_MS,
  DEFAULT_MAX_ATTEMPTS,
  MAX_RETRY_DELAY_MS,
  fitsRetryBudget,
  isRetryableKind,
  retryDelayMs,
  shouldRetry,
} from "@/modules/catalog/domain/retry";

describe("retry policy", () => {
  it("retries transport, throttling, and server failures only", () => {
    expect(isRetryableKind("network")).toBe(true);
    expect(isRetryableKind("rate_limited")).toBe(true);
    expect(isRetryableKind("server")).toBe(true);

    expect(isRetryableKind("client")).toBe(false);
    expect(isRetryableKind("auth")).toBe(false);
    expect(isRetryableKind("schema")).toBe(false);
  });

  it("never exceeds the attempt budget", () => {
    expect(shouldRetry({ kind: "network", attempt: 0 })).toBe(true);
    expect(shouldRetry({ kind: "network", attempt: 1 })).toBe(true);
    expect(shouldRetry({ kind: "network", attempt: DEFAULT_MAX_ATTEMPTS - 1 })).toBe(false);
    expect(shouldRetry({ kind: "client", attempt: 0 })).toBe(false);
  });

  it("honours Retry-After in seconds", () => {
    expect(retryDelayMs({ attempt: 0, retryAfterSeconds: 2 })).toBe(2000);
    expect(retryDelayMs({ attempt: 3, retryAfterSeconds: 0 })).toBe(0);
  });

  it("honours a long Retry-After exactly and refuses to shorten it", () => {
    expect(retryDelayMs({ attempt: 0, retryAfterSeconds: 3600 })).toBe(3_600_000);
    expect(fitsRetryBudget(3600)).toBe(false);
    expect(fitsRetryBudget(2)).toBe(true);
    expect(fitsRetryBudget(undefined)).toBe(true);
  });

  it("backs off exponentially without a Retry-After header", () => {
    expect(retryDelayMs({ attempt: 0 })).toBe(BASE_RETRY_DELAY_MS);
    expect(retryDelayMs({ attempt: 1 })).toBe(BASE_RETRY_DELAY_MS * 2);
    expect(retryDelayMs({ attempt: 20 })).toBe(MAX_RETRY_DELAY_MS);
  });
});
