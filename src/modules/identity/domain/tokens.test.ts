import { describe, expect, it } from "vitest";

import { generateOpaqueToken, hashToken, safeCompare } from "@/modules/identity/domain/tokens";

describe("opaque tokens", () => {
  it("generates URL-safe, high-entropy tokens", () => {
    const first = generateOpaqueToken();
    const second = generateOpaqueToken();

    expect(first).not.toBe(second);
    expect(first).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(first.length).toBeGreaterThanOrEqual(42);
  });

  it("hashes deterministically with the secret and differently without it", () => {
    const token = generateOpaqueToken();

    expect(hashToken(token, "secret-one")).toBe(hashToken(token, "secret-one"));
    expect(hashToken(token, "secret-one")).not.toBe(hashToken(token, "secret-two"));
    expect(hashToken(token, "secret-one")).toMatch(/^[0-9a-f]{64}$/);
    expect(hashToken(token, "secret-one")).not.toContain(token);
  });

  it("compares strings without throwing on length differences", () => {
    expect(safeCompare("same-value", "same-value")).toBe(true);
    expect(safeCompare("same-value", "same-valuE")).toBe(false);
    expect(safeCompare("short", "a-much-longer-value")).toBe(false);
  });
});
