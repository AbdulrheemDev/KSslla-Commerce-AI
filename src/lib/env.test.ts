import { afterEach, describe, expect, it } from "vitest";

import { AppError } from "@/lib/errors";
import { getSafeEnvSummary, getServerEnv, parseServerEnv, resetServerEnvCache } from "@/lib/env";

const ORIGINAL_ENV = { ...process.env };

afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
  resetServerEnvCache();
});

describe("parseServerEnv", () => {
  it("applies safe defaults when no variables are provided", () => {
    const env = parseServerEnv({});

    expect(env.NODE_ENV).toBe("development");
    expect(env.APP_URL).toBe("http://localhost:3000");
    expect(env.LOG_LEVEL).toBe("info");
    expect(env.DATABASE_URL).toBeUndefined();
    expect(env.AI_API_KEY).toBeUndefined();
  });

  it("accepts a complete future-phase configuration", () => {
    const env = parseServerEnv({
      NODE_ENV: "production",
      APP_URL: "https://app.example.com",
      LOG_LEVEL: "debug",
      DATABASE_URL: "postgresql://user:pass@db:5432/app",
      AUTH_SECRET: "a".repeat(32),
      ENCRYPTION_KEY: "b".repeat(64),
      SALLA_CLIENT_ID: "client-id",
      SALLA_CLIENT_SECRET: "client-secret",
      SALLA_REDIRECT_URI: "https://app.example.com/api/integrations/salla/callback",
      AI_PROVIDER: "openai",
      AI_API_KEY: "test-key",
      AI_DEFAULT_MODEL: "test-model",
    });

    expect(env.NODE_ENV).toBe("production");
    expect(env.ENCRYPTION_KEY).toBe("b".repeat(64));
    expect(env.SALLA_REDIRECT_URI).toBe("https://app.example.com/api/integrations/salla/callback");
  });

  it("rejects an invalid APP_URL without echoing the value", () => {
    try {
      parseServerEnv({ APP_URL: "not-a-url" });
      expect.unreachable("Expected APP_URL validation to fail");
    } catch (error) {
      expect(error).toBeInstanceOf(AppError);
      const appError = error as AppError;
      expect(appError.code).toBe("CONFIG_INVALID");
      expect(JSON.stringify(appError.details)).toContain("APP_URL");
      expect(JSON.stringify(appError.details)).not.toContain("not-a-url");
    }
  });

  it("rejects a short AUTH_SECRET", () => {
    expect(() => parseServerEnv({ AUTH_SECRET: "too-short" })).toThrowError(
      expect.objectContaining({ code: "CONFIG_INVALID" }),
    );
  });

  it("rejects an ENCRYPTION_KEY that is not 32 bytes of hex", () => {
    expect(() => parseServerEnv({ ENCRYPTION_KEY: "abc123" })).toThrowError(
      expect.objectContaining({ code: "CONFIG_INVALID" }),
    );
  });

  it("rejects unknown NODE_ENV and LOG_LEVEL values", () => {
    expect(() => parseServerEnv({ NODE_ENV: "staging" })).toThrowError(
      expect.objectContaining({ code: "CONFIG_INVALID" }),
    );
    expect(() => parseServerEnv({ LOG_LEVEL: "verbose" })).toThrowError(
      expect.objectContaining({ code: "CONFIG_INVALID" }),
    );
  });
});

describe("getServerEnv", () => {
  it("caches the parsed environment until reset", () => {
    process.env.APP_URL = "https://first.example.com";
    resetServerEnvCache();
    const first = getServerEnv();

    process.env.APP_URL = "https://second.example.com";
    const second = getServerEnv();

    expect(second).toBe(first);
    expect(second.APP_URL).toBe("https://first.example.com");

    resetServerEnvCache();
    expect(getServerEnv().APP_URL).toBe("https://second.example.com");
  });
});

describe("getSafeEnvSummary", () => {
  it("reports integration presence without exposing secret values", () => {
    const env = parseServerEnv({
      APP_URL: "https://app.example.com",
      AUTH_SECRET: "auth-secret-value-that-must-not-leak",
      DATABASE_URL: "postgresql://user:db-password@db:5432/app",
      SALLA_CLIENT_ID: "salla-client-id",
      SALLA_CLIENT_SECRET: "salla-client-secret-value",
      SALLA_REDIRECT_URI: "https://app.example.com/callback",
      AI_PROVIDER: "openai",
      AI_API_KEY: "sk-must-not-leak",
    });

    const summary = getSafeEnvSummary(env);
    const serialized = JSON.stringify(summary);

    expect(summary.integrations).toEqual({
      database: "configured",
      salla: "configured",
      aiProvider: "configured",
    });
    expect(serialized).not.toContain("auth-secret-value-that-must-not-leak");
    expect(serialized).not.toContain("db-password");
    expect(serialized).not.toContain("salla-client-secret-value");
    expect(serialized).not.toContain("sk-must-not-leak");
  });

  it("reports not_configured for a Phase 01 environment", () => {
    const summary = getSafeEnvSummary(parseServerEnv({}));

    expect(summary.integrations).toEqual({
      database: "not_configured",
      salla: "not_configured",
      aiProvider: "not_configured",
    });
  });
});
