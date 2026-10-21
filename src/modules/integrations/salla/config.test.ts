import { describe, expect, it } from "vitest";

import { parseServerEnv } from "@/lib/env";
import {
  SALLA_OFFICIAL_ENDPOINTS,
  getSallaHealth,
  isSallaConfigured,
  readSallaConfig,
  requireSallaConfig,
} from "@/modules/integrations/salla/config";

const CLIENT_ID = "client-id-value";
const CLIENT_SECRET = "client-secret-value";
const REDIRECT = "http://localhost:3000/api/integrations/salla/callback";

function env(overrides: Record<string, string | undefined> = {}) {
  return parseServerEnv({
    NODE_ENV: "test",
    APP_URL: "http://localhost:3000",
    DATABASE_URL: "postgres://localhost/test",
    AUTH_SECRET: "x".repeat(40),
    ENCRYPTION_KEY: "a".repeat(64),
    SALLA_CLIENT_ID: CLIENT_ID,
    SALLA_CLIENT_SECRET: CLIENT_SECRET,
    SALLA_REDIRECT_URI: REDIRECT,
    ...overrides,
  });
}

describe("Salla configuration", () => {
  it("is unconfigured without app keys", () => {
    const parsed = parseServerEnv({ NODE_ENV: "test" });

    expect(readSallaConfig(parsed)).toBeNull();
    expect(isSallaConfigured(parsed)).toBe(false);
    expect(() => requireSallaConfig(parsed)).toThrow(/not configured/i);
  });

  it("uses the official endpoints by default", () => {
    const config = requireSallaConfig(env());

    expect(config.endpoints).toEqual(SALLA_OFFICIAL_ENDPOINTS);
    expect(config.redirectUri).toBe(REDIRECT);
    expect(config.scopes).toEqual(["offline_access"]);
  });

  it("defaults to custom mode and treats easy mode as not implemented yet", () => {
    expect(requireSallaConfig(env()).mode).toBe("custom");

    const easy = readSallaConfig(env({ SALLA_OAUTH_MODE: "easy" }));
    expect(easy?.mode).toBe("easy");
    expect(easy?.supported).toBe(false);
    expect(() => requireSallaConfig(env({ SALLA_OAUTH_MODE: "easy" }))).toThrow();
  });

  it("honours documented endpoint overrides outside production", () => {
    const config = requireSallaConfig(
      env({
        SALLA_AUTH_URL: "http://127.0.0.1:9999/auth",
        SALLA_TOKEN_URL: "http://127.0.0.1:9999/token",
        SALLA_USERINFO_URL: "http://127.0.0.1:9999/user-info",
      }),
    );

    expect(config.endpoints.authorizationUrl).toBe("http://127.0.0.1:9999/auth");
    expect(config.endpoints.tokenUrl).toBe("http://127.0.0.1:9999/token");
    expect(config.endpoints.userInfoUrl).toBe("http://127.0.0.1:9999/user-info");
  });

  it("ignores overrides in production and forces official hosts", () => {
    const config = requireSallaConfig(
      env({
        NODE_ENV: "production",
        APP_URL: "https://app.example.com",
        SALLA_REDIRECT_URI: "https://app.example.com/api/integrations/salla/callback",
        SALLA_AUTH_URL: "http://attacker.example/auth",
        SALLA_TOKEN_URL: "http://attacker.example/token",
      }),
    );

    expect(config.endpoints).toEqual(SALLA_OFFICIAL_ENDPOINTS);
  });

  it("rejects a production redirect that is not the registered https callback", () => {
    const production = (redirect: string) =>
      readSallaConfig(
        env({
          NODE_ENV: "production",
          APP_URL: "https://app.example.com",
          SALLA_REDIRECT_URI: redirect,
        }),
      );

    expect(production("http://app.example.com/api/integrations/salla/callback")).toBeNull();
    expect(production("https://app.example.com/api/other/callback")).toBeNull();
    expect(production("https://evil.example.com/api/integrations/salla/callback")).toBeNull();
    expect(production("https://app.example.com/api/integrations/salla/callback")).not.toBeNull();
  });

  it("never leaks secrets in the health summary", () => {
    const health = getSallaHealth(env());
    const serialized = JSON.stringify(health);

    expect(health).toEqual({ configured: true, oauthMode: "custom", implemented: true });
    expect(serialized).not.toContain(CLIENT_ID);
    expect(serialized).not.toContain(CLIENT_SECRET);
  });

  it("rejects malformed encryption keys at the schema level", () => {
    expect(() => parseServerEnv({ NODE_ENV: "test", ENCRYPTION_KEY: "abc" })).toThrow();
    expect(() => parseServerEnv({ NODE_ENV: "test", ENCRYPTION_KEY: "z".repeat(64) })).toThrow();
  });
});
