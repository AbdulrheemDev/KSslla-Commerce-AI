import { describe, expect, it } from "vitest";

import { InMemoryRateLimiter, RATE_LIMITS, enforceRateLimit } from "@/server/rate-limit";
import { AppError } from "@/lib/errors";

describe("rate limiting", () => {
  it("allows a bounded number of attempts per window", () => {
    let now = 1_000;
    const limiter = new InMemoryRateLimiter(() => now);

    for (let attempt = 0; attempt < 3; attempt += 1) {
      expect(limiter.consume("login:ip", 3, 1_000).allowed).toBe(true);
    }

    const blocked = limiter.consume("login:ip", 3, 1_000);
    expect(blocked.allowed).toBe(false);
    expect(blocked.retryAfterSeconds).toBeGreaterThan(0);

    now += 1_001;
    expect(limiter.consume("login:ip", 3, 1_000).allowed).toBe(true);
  });

  it("keeps keys independent and clears on reset", () => {
    const limiter = new InMemoryRateLimiter(() => 0);

    limiter.consume("ip:a", 1, 1_000);
    expect(limiter.consume("ip:a", 1, 1_000).allowed).toBe(false);
    expect(limiter.consume("ip:b", 1, 1_000).allowed).toBe(true);

    limiter.reset();
    expect(limiter.consume("ip:a", 1, 1_000).allowed).toBe(true);
  });

  it("throws a retryable RATE_LIMITED error when the budget is gone", () => {
    const key = `test:${Math.random()}`;

    for (let attempt = 0; attempt < RATE_LIMITS.loginPerAccount.limit; attempt += 1) {
      enforceRateLimit(
        key,
        "account",
        RATE_LIMITS.loginPerAccount.limit,
        RATE_LIMITS.loginPerAccount.windowMs,
      );
    }

    try {
      enforceRateLimit(
        key,
        "account",
        RATE_LIMITS.loginPerAccount.limit,
        RATE_LIMITS.loginPerAccount.windowMs,
      );
      throw new Error("expected rate limit");
    } catch (error) {
      expect(error).toBeInstanceOf(AppError);
      expect((error as AppError).code).toBe("RATE_LIMITED");
      expect((error as AppError).httpStatus).toBe(429);
      expect((error as AppError).retryable).toBe(true);
    }
  });
});
