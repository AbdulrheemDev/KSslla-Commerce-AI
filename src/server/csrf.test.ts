import { describe, expect, it } from "vitest";

import { allowedOriginHosts, isAcceptedOrigin } from "@/server/csrf";

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
