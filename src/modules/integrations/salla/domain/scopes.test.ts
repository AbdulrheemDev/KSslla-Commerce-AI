import { describe, expect, it } from "vitest";

import {
  SALLA_REQUIRED_SCOPES,
  hasOfflineAccess,
  normalizeScopes,
  serializeScopes,
} from "@/modules/integrations/salla/domain/scopes";

describe("Salla scopes", () => {
  it("requests exactly the scopes the implemented features use", () => {
    expect(SALLA_REQUIRED_SCOPES).toEqual(["offline_access", "products.read", "categories.read"]);
  });

  it("never asks for a write scope", () => {
    for (const scope of SALLA_REQUIRED_SCOPES) {
      expect(scope.endsWith(".read") || scope === "offline_access").toBe(true);
    }
  });

  it("splits on spaces and commas", () => {
    expect(normalizeScopes("settings.read,orders.read")).toEqual(["settings.read", "orders.read"]);
    expect(normalizeScopes("a b  c")).toEqual(["a", "b", "c"]);
  });

  it("deduplicates while preserving order", () => {
    expect(normalizeScopes(["b", "a", "b", "c", "a"])).toEqual(["b", "a", "c"]);
    expect(normalizeScopes("offline_access offline_access")).toEqual(["offline_access"]);
  });

  it("ignores empty input", () => {
    expect(normalizeScopes(null)).toEqual([]);
    expect(normalizeScopes("")).toEqual([]);
    expect(normalizeScopes(["", "  "])).toEqual([]);
  });

  it("serializes to the RFC 6749 space-delimited form", () => {
    expect(serializeScopes(["offline_access", "settings.read"])).toBe(
      "offline_access settings.read",
    );
  });

  it("detects offline_access", () => {
    expect(hasOfflineAccess(["offline_access"])).toBe(true);
    expect(hasOfflineAccess(["settings.read"])).toBe(false);
  });
});
