import { NextResponse } from "next/server";
import { afterEach, describe, expect, it } from "vitest";

import { AppError } from "@/lib/errors";
import { parseServerEnv, resetServerEnvCache } from "@/lib/env";
import { SESSION_COOKIE_NAME } from "@/modules/identity/domain/session-policy";
import {
  DEFAULT_COOKIE_POLICY,
  PREVIEW_COOKIE_POLICY,
  resolveCookiePolicy,
} from "@/server/cookie-policy";
import { setCsrfCookie } from "@/server/csrf";
import { clearSessionCookie, setSessionCookie } from "@/server/session";

const ORIGINAL_ENV = { ...process.env };

afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
  resetServerEnvCache();
});

describe("cookie policy", () => {
  it("keeps the same-origin default outside preview mode", () => {
    expect(resolveCookiePolicy({ nodeEnv: "development" })).toEqual(DEFAULT_COOKIE_POLICY);
    expect(resolveCookiePolicy({ nodeEnv: "test" })).toEqual({
      secure: true,
      sameSite: "lax",
    });
    expect(DEFAULT_COOKIE_POLICY.partitioned).toBeUndefined();
  });

  it("opts into partitioned cookies only when the preview asks for them", () => {
    expect(
      resolveCookiePolicy({ nodeEnv: "development", previewEmbeddedCookies: "partitioned" }),
    ).toEqual(PREVIEW_COOKIE_POLICY);
    expect(resolveCookiePolicy({ nodeEnv: "test", previewEmbeddedCookies: "partitioned" })).toEqual(
      { secure: true, sameSite: "none", partitioned: true },
    );
  });

  it("refuses preview mode in production even if it reaches the resolver", () => {
    expect(
      resolveCookiePolicy({ nodeEnv: "production", previewEmbeddedCookies: "partitioned" }),
    ).toEqual(DEFAULT_COOKIE_POLICY);
  });

  it("rejects the flag at the environment boundary in production", () => {
    expect(() =>
      parseServerEnv({ NODE_ENV: "production", PREVIEW_EMBEDDED_COOKIES: "partitioned" }),
    ).toThrow(AppError);
  });

  it("accepts the flag outside production and rejects unknown values", () => {
    expect(
      parseServerEnv({ NODE_ENV: "development", PREVIEW_EMBEDDED_COOKIES: "partitioned" })
        .PREVIEW_EMBEDDED_COOKIES,
    ).toBe("partitioned");

    expect(() => parseServerEnv({ PREVIEW_EMBEDDED_COOKIES: "true" })).toThrow(AppError);
  });

  it("emits the default attributes when preview mode is off", () => {
    const response = new NextResponse(null);
    setCsrfCookie(response, "token-value");
    const cookie = response.headers.get("set-cookie") ?? "";

    expect(cookie).toContain("Secure");
    expect(cookie).toContain("SameSite=lax");
    expect(cookie).not.toContain("Partitioned");
    expect(cookie).not.toContain("SameSite=none");
  });

  it("emits Partitioned, SameSite=None, Secure for CSRF and session cookies in preview mode", () => {
    process.env.PREVIEW_EMBEDDED_COOKIES = "partitioned";
    resetServerEnvCache();

    const csrfResponse = new NextResponse(null);
    setCsrfCookie(csrfResponse, "token-value");
    const csrfCookie = csrfResponse.headers.get("set-cookie") ?? "";

    expect(csrfCookie).toContain("__Host-ksh_csrf=token-value");
    expect(csrfCookie).toContain("Secure");
    expect(csrfCookie).toContain("SameSite=none");
    expect(csrfCookie).toContain("Partitioned");
    expect(csrfCookie).toContain("Path=/");

    const sessionResponse = new NextResponse(null);
    setSessionCookie(sessionResponse, "session-token", new Date(Date.now() + 60_000));
    const sessionCookie = sessionResponse.headers.get("set-cookie") ?? "";

    expect(sessionCookie).toContain(`${SESSION_COOKIE_NAME}=session-token`);
    expect(sessionCookie).toContain("HttpOnly");
    expect(sessionCookie).toContain("Secure");
    expect(sessionCookie).toContain("SameSite=none");
    expect(sessionCookie).toContain("Partitioned");

    const clearedResponse = new NextResponse(null);
    clearSessionCookie(clearedResponse);
    const cleared = clearedResponse.headers.get("set-cookie") ?? "";
    expect(cleared).toContain(`${SESSION_COOKIE_NAME}=`);
    expect(cleared).toContain("Partitioned");
    expect(cleared).toContain("Max-Age=0");
  });
});
