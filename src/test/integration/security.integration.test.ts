import { sql } from "drizzle-orm";
import { NextRequest } from "next/server";
import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { withTenantTransaction } from "@/db/tenant";
import { SESSION_COOKIE_NAME, CSRF_COOKIE_NAME } from "@/modules/identity/domain/session-policy";
import { closeTestDb, executeAsAdmin, getTestDb } from "@/test/db/client";
import { ApiClient, registerViaApi, resetState } from "@/test/integration/helpers";

function rawLoginRequest(options: {
  body: unknown;
  origin?: string;
  csrfCookie?: string;
  csrfHeader?: string;
  cookie?: string;
}) {
  const headers = new Headers({
    host: "localhost:3000",
    origin: options.origin ?? "http://localhost:3000",
    "content-type": "application/json",
  });

  const cookies = [
    options.cookie,
    options.csrfCookie ? `${CSRF_COOKIE_NAME}=${options.csrfCookie}` : undefined,
  ].filter(Boolean);

  if (cookies.length > 0) headers.set("cookie", cookies.join("; "));
  if (options.csrfHeader) headers.set("x-csrf-token", options.csrfHeader);

  return new NextRequest("http://localhost:3000/api/auth/login", {
    method: "POST",
    headers,
    body: JSON.stringify(options.body),
  });
}

async function invokeLogin(request: NextRequest) {
  const { POST } = await import("@/app/api/auth/login/route");
  return POST(request, undefined as never);
}

describe("security controls", () => {
  beforeEach(resetState);
  afterAll(closeTestDb);

  it("requires a matching CSRF token on state-changing requests", async () => {
    const registered = await registerViaApi({
      email: "csrf@example.com",
      organizationName: "CSRF org",
    });

    const csrfCookie = registered.client.cookies.get(CSRF_COOKIE_NAME);
    expect(csrfCookie).toBeTruthy();

    const missing = await invokeLogin(
      rawLoginRequest({
        body: { email: "csrf@example.com", password: registered.password },
      }),
    );
    expect(missing.status).toBe(403);

    const mismatched = await invokeLogin(
      rawLoginRequest({
        body: { email: "csrf@example.com", password: registered.password },
        csrfCookie,
        csrfHeader: "not-the-same-value",
      }),
    );
    expect(mismatched.status).toBe(403);

    const valid = await invokeLogin(
      rawLoginRequest({
        body: { email: "csrf@example.com", password: registered.password },
        csrfCookie,
        csrfHeader: csrfCookie,
      }),
    );
    expect(valid.status).toBe(200);
  });

  it("rejects cross-origin state changes even with a valid token", async () => {
    const registered = await registerViaApi({
      email: "cross-origin@example.com",
      organizationName: "Cross origin org",
    });

    const csrfCookie = registered.client.cookies.get(CSRF_COOKIE_NAME)!;

    const response = await invokeLogin(
      rawLoginRequest({
        body: { email: "cross-origin@example.com", password: registered.password },
        csrfCookie,
        csrfHeader: csrfCookie,
        origin: "https://evil.example",
      }),
    );

    expect(response.status).toBe(403);
  });

  it("rate limits repeated login attempts from one IP", async () => {
    const client = new ApiClient();
    await client.ensureCsrf();

    for (let attempt = 0; attempt < 10; attempt += 1) {
      const result = await client.post("/api/auth/login", {
        email: `unknown-${attempt}@example.com`,
        password: "some-long-password",
      });
      expect(result.status).toBe(401);
    }

    const limited = await client.post("/api/auth/login", {
      email: "unknown-final@example.com",
      password: "some-long-password",
    });

    expect(limited.status).toBe(429);
    expect(limited.body.error?.code).toBe("RATE_LIMITED");
  });

  it("rate limits per account before the IP budget is exhausted", async () => {
    const client = new ApiClient();
    await client.ensureCsrf();

    for (let attempt = 0; attempt < 5; attempt += 1) {
      const result = await client.post("/api/auth/login", {
        email: "target@example.com",
        password: "wrong-password-value",
      });
      expect(result.status).toBe(401);
    }

    const limited = await client.post("/api/auth/login", {
      email: "target@example.com",
      password: "wrong-password-value",
    });

    expect(limited.status).toBe(429);
  });

  it("rejects expired sessions", async () => {
    const registered = await registerViaApi({
      email: "expired@example.com",
      organizationName: "Expired org",
    });

    await executeAsAdmin("update sessions set expires_at = now() - interval '1 hour'");

    const session = await registered.client.get("/api/auth/session");
    expect(session.body.data).toMatchObject({ authenticated: false });

    const protectedCall = await registered.client.get("/api/organizations/current");
    expect(protectedCall.status).toBe(401);
  });

  it("rejects tampered session tokens", async () => {
    const registered = await registerViaApi({
      email: "tampered@example.com",
      organizationName: "Tampered org",
    });

    const original = registered.client.cookies.get(SESSION_COOKIE_NAME)!;
    registered.client.cookies.set(SESSION_COOKIE_NAME, `${original.slice(0, -4)}beef`);

    const session = await registered.client.get("/api/auth/session");
    expect(session.body.data).toMatchObject({ authenticated: false });

    const protectedCall = await registered.client.get("/api/organizations/current");
    expect(protectedCall.status).toBe(401);
  });

  it("stores only keyed hashes of session tokens", async () => {
    const registered = await registerViaApi({
      email: "hashes@example.com",
      organizationName: "Hashes org",
    });

    const cookieToken = registered.client.cookies.get(SESSION_COOKIE_NAME)!;

    const rows = await withTenantTransaction(
      getTestDb(),
      { userId: registered.userId, organizationId: registered.organizationId },
      (tx) =>
        tx.execute<{ session_token_hash: string }>(sql`select session_token_hash from sessions`),
    );

    expect(rows).toHaveLength(1);
    expect(rows[0]?.session_token_hash).not.toBe(cookieToken);
    expect(rows[0]?.session_token_hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it("returns 401 for protected endpoints without a session", async () => {
    const anonymous = new ApiClient();

    const overview = await anonymous.get("/api/organizations/current");
    expect(overview.status).toBe(401);
    expect(overview.body.error?.code).toBe("UNAUTHENTICATED");

    const members = await anonymous.get("/api/organizations/current/members");
    expect(members.status).toBe(401);

    const session = await anonymous.get("/api/auth/session");
    expect(session.status).toBe(200);
    expect(session.body.data).toMatchObject({ authenticated: false });
  });

  it("reports honest health state with Salla not configured", async () => {
    const { GET } = await import("@/app/api/health/route");
    const response = await GET();
    const payload = (await response.json()) as {
      status: string;
      checks: { database: string; auth: string; salla: string };
    };

    expect(response.status).toBe(200);
    expect(payload.status).toBe("ok");
    expect(payload.checks.database).toBe("ok");
    expect(payload.checks.auth).toBe("configured");
    expect(payload.checks.salla).toBe("not_configured");
  });
});
