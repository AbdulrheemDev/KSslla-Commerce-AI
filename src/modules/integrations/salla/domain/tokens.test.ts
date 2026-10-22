import { describe, expect, it } from "vitest";

import {
  ACCESS_TOKEN_FALLBACK_MS,
  computeAccessTokenExpiry,
  computeRefreshTokenExpiry,
  isAccessTokenUsable,
  isConnectionUsable,
} from "@/modules/integrations/salla/domain/tokens";

const NOW = new Date("2026-10-22T10:00:00.000Z");

describe("access-token expiry", () => {
  it("prefers expires_in seconds", () => {
    const expiry = computeAccessTokenExpiry({ now: NOW, expiresIn: 3600 });

    expect(expiry.toISOString()).toBe("2026-10-22T11:00:00.000Z");
  });

  it("accepts expires as a numeric string", () => {
    const expiry = computeAccessTokenExpiry({ now: NOW, expiresIn: "120" });
    expect(expiry.getTime() - NOW.getTime()).toBe(120_000);
  });

  it("accepts the documented `expires` unix-seconds field", () => {
    const epochSeconds = Math.floor(NOW.getTime() / 1000) + 3600;
    const expiry = computeAccessTokenExpiry({ now: NOW, expiresAtEpoch: epochSeconds });

    expect(expiry.toISOString()).toBe("2026-10-22T11:00:00.000Z");
  });

  it("tolerates millisecond timestamps", () => {
    const epochMs = NOW.getTime() + 7200_000;
    const expiry = computeAccessTokenExpiry({ now: NOW, expiresAtEpoch: epochMs });
    expect(expiry.toISOString()).toBe("2026-10-22T12:00:00.000Z");
  });

  it("falls back to the documented 14-day lifetime", () => {
    const expiry = computeAccessTokenExpiry({ now: NOW });
    expect(expiry.getTime() - NOW.getTime()).toBe(ACCESS_TOKEN_FALLBACK_MS);
    expect(ACCESS_TOKEN_FALLBACK_MS).toBe(14 * 24 * 60 * 60 * 1000);
  });

  it("ignores zero and negative lifetimes", () => {
    expect(computeAccessTokenExpiry({ now: NOW, expiresIn: 0 }).getTime()).toBe(
      NOW.getTime() + ACCESS_TOKEN_FALLBACK_MS,
    );
    expect(computeAccessTokenExpiry({ now: NOW, expiresIn: -5 }).getTime()).toBe(
      NOW.getTime() + ACCESS_TOKEN_FALLBACK_MS,
    );
  });
});

describe("refresh-token expiry", () => {
  it("uses the documented one-month lifetime", () => {
    const expiry = computeRefreshTokenExpiry(NOW, "refresh");
    expect(expiry?.getTime()).toBe(NOW.getTime() + 30 * 24 * 60 * 60 * 1000);
  });

  it("is null when Salla issued no refresh token", () => {
    expect(computeRefreshTokenExpiry(NOW, null)).toBeNull();
  });
});

describe("usability windows", () => {
  it("treats a token inside the skew window as expired", () => {
    const soon = new Date(NOW.getTime() + 30_000);
    expect(isAccessTokenUsable(soon, NOW)).toBe(false);
    expect(isAccessTokenUsable(new Date(NOW.getTime() + 120_000), NOW)).toBe(true);
  });

  it("treats a missing expiry as unusable", () => {
    expect(isAccessTokenUsable(null, NOW)).toBe(false);
  });

  it("only considers connected/refreshing connections usable", () => {
    expect(isConnectionUsable("connected")).toBe(true);
    expect(isConnectionUsable("refreshing")).toBe(true);
    expect(isConnectionUsable("reauth_required")).toBe(false);
    expect(isConnectionUsable("disconnected")).toBe(false);
    expect(isConnectionUsable("authorizing")).toBe(false);
  });
});
