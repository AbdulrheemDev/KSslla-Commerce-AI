import { AppError } from "@/lib/errors";

/**
 * Rate limiting abstraction.
 *
 * Phase 02 uses a single-process in-memory window, which is honest for the
 * current one-instance deployment. The `RateLimiter` port lets Phase 06 swap in
 * Redis or PostgreSQL without touching call sites.
 */

export interface RateLimitDecision {
  allowed: boolean;
  remaining: number;
  retryAfterSeconds: number;
}

export interface RateLimiter {
  consume(key: string, limit: number, windowMs: number): RateLimitDecision;
}

interface Bucket {
  count: number;
  resetAt: number;
}

export class InMemoryRateLimiter implements RateLimiter {
  private readonly buckets = new Map<string, Bucket>();

  constructor(private readonly now: () => number = Date.now) {}

  consume(key: string, limit: number, windowMs: number): RateLimitDecision {
    const current = this.now();
    const bucket = this.buckets.get(key);

    if (!bucket || current >= bucket.resetAt) {
      this.buckets.set(key, { count: 1, resetAt: current + windowMs });
      this.cleanup(current);
      return { allowed: true, remaining: limit - 1, retryAfterSeconds: 0 };
    }

    if (bucket.count >= limit) {
      return {
        allowed: false,
        remaining: 0,
        retryAfterSeconds: Math.max(1, Math.ceil((bucket.resetAt - current) / 1000)),
      };
    }

    bucket.count += 1;
    return { allowed: true, remaining: limit - bucket.count, retryAfterSeconds: 0 };
  }

  reset(): void {
    this.buckets.clear();
  }

  private cleanup(current: number): void {
    if (this.buckets.size < 5_000) return;
    for (const [key, bucket] of this.buckets) {
      if (current >= bucket.resetAt) this.buckets.delete(key);
    }
  }
}

export const rateLimiter: RateLimiter = new InMemoryRateLimiter();

/** Test helper. Never called by production code. */
export function resetRateLimits(): void {
  if (rateLimiter instanceof InMemoryRateLimiter) {
    rateLimiter.reset();
  }
}

export function enforceRateLimit(
  scope: string,
  identifier: string,
  limit: number,
  windowMs: number,
): void {
  const decision = rateLimiter.consume(`${scope}:${identifier}`, limit, windowMs);

  if (!decision.allowed) {
    throw new AppError({
      code: "RATE_LIMITED",
      message: "Too many attempts. Try again later.",
      details: { retryAfterSeconds: decision.retryAfterSeconds },
    });
  }
}

export const RATE_LIMITS = {
  loginPerIp: { limit: 10, windowMs: 15 * 60 * 1000 },
  loginPerAccount: { limit: 5, windowMs: 15 * 60 * 1000 },
  registerPerIp: { limit: 5, windowMs: 60 * 60 * 1000 },
  invitationPerOrganization: { limit: 20, windowMs: 60 * 60 * 1000 },
} as const;
