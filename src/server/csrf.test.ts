import { NextRequest } from "next/server";
import { describe, expect, it } from "vitest";

import { AppError } from "@/lib/errors";
import { CSRF_COOKIE_NAME, CSRF_HEADER_NAME } from "@/modules/identity/domain/session-policy";
import { allowedOriginHosts, assertCsrf, assertSameOrigin, isAcceptedOrigin } from "@/server/csrf";

describe("CSRF origin matching", () => {
  it("accepts the socket host, the forwarded host, and the configured app host", () => {
    const hosts = allowedOriginHosts({
      host: "127.0.0.1:4010",
      forwardedHost: "4010-preview.example.app",
      appUrl: "https://4010-preview.example.app",
    });

    expect(hosts).toEqual(new Set(["127.0.0.1:4010", "4010-preview.example.app"]));
  });

  it("takes the first entry of a forwarded-host hop list", () => {
    const hosts = allowedOriginHosts({
      host: null,
      forwardedHost: "public.example.app, internal.example.app",
      appUrl: null,
    });

    expect(hosts.has("public.example.app")).toBe(true);
    expect(hosts.has("internal.example.app")).toBe(false);
  });

  it("ignores malformed and empty inputs instead of failing open", () => {
    expect(allowedOriginHosts({ host: null, forwardedHost: "", appUrl: null }).size).toBe(0);
    expect(
      allowedOriginHosts({ host: "http://", forwardedHost: " ", appUrl: "not a url" }).size,
    ).toBe(0);
  });

  it("compares hosts case-insensitively and drops default ports", () => {
    const hosts = allowedOriginHosts({
      host: "Preview.Example.Test:443",
      forwardedHost: null,
      appUrl: "https://preview.example.test",
    });

    expect(
      isAcceptedOrigin("https://PREVIEW.example.test", hosts, { allowPreviewHosts: false }),
    ).toBe(true);
  });

  it("rejects a foreign origin even when the token is valid", () => {
    const hosts = allowedOriginHosts({
      host: "127.0.0.1:4010",
      forwardedHost: "4010-preview.example.app",
      appUrl: "https://4010-preview.example.app",
    });

    expect(isAcceptedOrigin("https://evil.example", hosts, { allowPreviewHosts: true })).toBe(
      false,
    );
    expect(
      isAcceptedOrigin("https://4010-preview.example.app.evil.test", hosts, {
        allowPreviewHosts: false,
      }),
    ).toBe(false);
  });

  it("rejects non-http origins", () => {
    const hosts = allowedOriginHosts({ host: "localhost:3000", forwardedHost: null, appUrl: null });

    expect(isAcceptedOrigin("file://localhost:3000", hosts, { allowPreviewHosts: false })).toBe(
      false,
    );
    expect(isAcceptedOrigin("not-a-url", hosts, { allowPreviewHosts: false })).toBe(false);
  });

  it("trusts preview hosts only when development allows it", () => {
    const empty = new Set<string>();

    expect(isAcceptedOrigin("https://4010-abc.e2b.app", empty, { allowPreviewHosts: true })).toBe(
      true,
    );
    expect(isAcceptedOrigin("https://4010-abc.e2b.app", empty, { allowPreviewHosts: false })).toBe(
      false,
    );
    expect(isAcceptedOrigin("http://4010-abc.e2b.app", empty, { allowPreviewHosts: true })).toBe(
      false,
    );
    expect(
      isAcceptedOrigin("https://e2b.app.attacker.test", empty, { allowPreviewHosts: true }),
    ).toBe(false);
  });
});

function loginRequest(headers: Record<string, string>): NextRequest {
  return new NextRequest("http://localhost:3000/api/auth/login", { method: "POST", headers });
}

/**
 * Runs a guard and reports either "accepted" or the internal rejection reason,
 * so the tests can prove *why* a request was refused rather than only that it was.
 */
function outcomeOf(run: () => void): string {
  try {
    run();
    return "accepted";
  } catch (error) {
    if (error instanceof AppError) return String(error.details?.reason ?? error.code);
    return "unexpected-error";
  }
}

describe("same-origin verification", () => {
  it("accepts the origin the browser reports for the same host", () => {
    expect(
      outcomeOf(() =>
        assertSameOrigin(loginRequest({ host: "localhost:3000", origin: "http://localhost:3000" })),
      ),
    ).toBe("accepted");
  });

  it("accepts the origin the proxy reports through x-forwarded-host", () => {
    expect(
      outcomeOf(() =>
        assertSameOrigin(
          loginRequest({
            host: "127.0.0.1:4011",
            "x-forwarded-host": "4011-abc.e2b.app",
            origin: "https://4011-abc.e2b.app",
          }),
        ),
      ),
    ).toBe("accepted");
  });

  it("falls back to the Referer when no Origin was sent", () => {
    expect(
      outcomeOf(() =>
        assertSameOrigin(
          loginRequest({
            host: "localhost:3000",
            referer: "http://localhost:3000/login?next=%2Fapp",
          }),
        ),
      ),
    ).toBe("accepted");
  });

  it("rejects a foreign Referer used as the fallback", () => {
    expect(
      outcomeOf(() =>
        assertSameOrigin(
          loginRequest({ host: "localhost:3000", referer: "https://evil.example/login" }),
        ),
      ),
    ).toBe("cross_origin_referer");
  });

  it("rejects a foreign Origin even when the Referer is same-origin", () => {
    expect(
      outcomeOf(() =>
        assertSameOrigin(
          loginRequest({
            host: "localhost:3000",
            origin: "https://evil.example",
            referer: "http://localhost:3000/login",
          }),
        ),
      ),
    ).toBe("cross_origin");
  });

  it("rejects a request that carries neither Origin nor Referer", () => {
    expect(outcomeOf(() => assertSameOrigin(loginRequest({ host: "localhost:3000" })))).toBe(
      "missing_origin",
    );
  });

  it("rejects an opaque or malformed origin", () => {
    expect(
      outcomeOf(() => assertSameOrigin(loginRequest({ host: "localhost:3000", origin: "null" }))),
    ).toBe("cross_origin");
  });

  it("rejects a same host on a different port", () => {
    expect(
      outcomeOf(() =>
        assertSameOrigin(loginRequest({ host: "localhost:3000", origin: "http://localhost:3001" })),
      ),
    ).toBe("cross_origin");
  });
});

describe("double-submit token verification", () => {
  const base = { host: "localhost:3000", origin: "http://localhost:3000" } as const;

  it("accepts a token that matches the cookie", () => {
    expect(
      outcomeOf(() =>
        assertCsrf(
          loginRequest({
            ...base,
            cookie: `${CSRF_COOKIE_NAME}=token-value`,
            [CSRF_HEADER_NAME]: "token-value",
          }),
        ),
      ),
    ).toBe("accepted");
  });

  it("rejects a missing cookie, which is what a blocked third-party cookie looks like", () => {
    expect(
      outcomeOf(() => assertCsrf(loginRequest({ ...base, [CSRF_HEADER_NAME]: "token-value" }))),
    ).toBe("csrf_token_mismatch");
  });

  it("rejects a missing header", () => {
    expect(
      outcomeOf(() =>
        assertCsrf(loginRequest({ ...base, cookie: `${CSRF_COOKIE_NAME}=token-value` })),
      ),
    ).toBe("csrf_token_mismatch");
  });

  it("rejects a mismatched pair", () => {
    expect(
      outcomeOf(() =>
        assertCsrf(
          loginRequest({
            ...base,
            cookie: `${CSRF_COOKIE_NAME}=token-value`,
            [CSRF_HEADER_NAME]: "other-value",
          }),
        ),
      ),
    ).toBe("csrf_token_mismatch");
  });

  it("checks the origin before the token", () => {
    expect(
      outcomeOf(() =>
        assertCsrf(
          loginRequest({
            host: "localhost:3000",
            origin: "https://evil.example",
            cookie: `${CSRF_COOKIE_NAME}=token-value`,
            [CSRF_HEADER_NAME]: "token-value",
          }),
        ),
      ),
    ).toBe("cross_origin");
  });
});
