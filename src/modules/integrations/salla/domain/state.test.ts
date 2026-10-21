import { describe, expect, it } from "vitest";

import {
  OAUTH_STATE_TTL_MS,
  generateOAuthState,
  getStateExpiry,
  hashOAuthState,
  isStateExpired,
  isWellFormedState,
  stateHashesEqual,
} from "@/modules/integrations/salla/domain/state";

const SECRET = "test-secret-value-with-enough-characters";

describe("OAuth state", () => {
  it("generates 256-bit url-safe values", () => {
    const state = generateOAuthState();

    expect(state).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(isWellFormedState(state)).toBe(true);
  });

  it("does not repeat across calls", () => {
    const values = new Set(Array.from({ length: 200 }, () => generateOAuthState()));
    expect(values.size).toBe(200);
  });

  it("hashes deterministically and never stores the raw value", () => {
    const state = generateOAuthState();
    const hash = hashOAuthState(state, SECRET);

    expect(hash).toMatch(/^[0-9a-f]{64}$/);
    expect(hash).not.toContain(state);
    expect(hashOAuthState(state, SECRET)).toBe(hash);
  });

  it("produces a different hash for a different secret", () => {
    const state = generateOAuthState();
    expect(hashOAuthState(state, SECRET)).not.toBe(hashOAuthState(state, "another-secret"));
  });

  it("compares hashes without early exit", () => {
    const state = generateOAuthState();
    const hash = hashOAuthState(state, SECRET);

    expect(stateHashesEqual(hash, hash)).toBe(true);
    expect(stateHashesEqual(hash, hashOAuthState(generateOAuthState(), SECRET))).toBe(false);
    expect(stateHashesEqual(hash, "short")).toBe(false);
  });

  it("expires after ten minutes", () => {
    const now = new Date("2026-10-22T10:00:00.000Z");
    const expiry = getStateExpiry(now);

    expect(expiry.getTime() - now.getTime()).toBe(OAUTH_STATE_TTL_MS);
    expect(isStateExpired(expiry, new Date(now.getTime() + OAUTH_STATE_TTL_MS - 1))).toBe(false);
    expect(isStateExpired(expiry, expiry)).toBe(true);
  });

  it("rejects malformed state values", () => {
    for (const value of [null, undefined, "", "short", "has spaces in it", "a".repeat(200)]) {
      expect(isWellFormedState(value)).toBe(false);
    }
  });
});
