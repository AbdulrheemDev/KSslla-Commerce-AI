import { sql } from "drizzle-orm";
import { NextRequest } from "next/server";
import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";

import { withTenantTransaction } from "@/db/tenant";
import { resetServerEnvCache } from "@/lib/env";
import {
  CSRF_COOKIE_NAME,
  CSRF_HEADER_NAME,
  SESSION_COOKIE_NAME,
} from "@/modules/identity/domain/session-policy";
import { closeTestDb, getTestDb } from "@/test/db/client";
import {
  ApiClient,
  DEFAULT_PASSWORD,
  registerViaApi,
  resetState,
} from "@/test/integration/helpers";

/**
 * The login request must satisfy both halves of the Phase 02 CSRF defence:
 * a same-origin `Origin`, and a token that matches the double-submit cookie.
 *
 * These tests drive the real route handler with hand-built requests so the
 * cookie, origin, and referer can be varied independently — the exact failure
 * mode reported from the preview (header present, cookie missing) has to keep
 * returning 403, while the cookie policy has to keep that cookie alive inside
 * an embedded iframe.
 */

interface RawRequest {
  body?: unknown;
  path?: string;
  origin?: string | null;
  referer?: string | null;
  host?: string;
  forwardedHost?: string;
  cookie?: string | null;
  token?: string | null;
}

function buildRequest(options: RawRequest): NextRequest {
  const headers = new Headers({ host: options.host ?? "localhost:3000" });

  // `origin: null` models a client that sent no Origin header at all.
  if (options.origin !== null) headers.set("origin", options.origin ?? "http://localhost:3000");
  if (options.referer) headers.set("referer", options.referer);
  if (options.forwardedHost) headers.set("x-forwarded-host", options.forwardedHost);
  if (options.cookie) headers.set("cookie", options.cookie);
  if (options.token) headers.set(CSRF_HEADER_NAME, options.token);
  if (options.body !== undefined) headers.set("content-type", "application/json");

  return new NextRequest(`http://localhost:3000${options.path ?? "/api/auth/login"}`, {
    method: "POST",
    headers,
    ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) }),
  });
}

async function postLogin(options: RawRequest) {
  const { POST } = await import("@/app/api/auth/login/route");
  const response = await POST(buildRequest(options), undefined as never);
  return { response, body: (await response.json()) as { error?: { code?: string } } };
}

async function postCsrf() {
  const { GET } = await import("@/app/api/auth/csrf/route");
  return GET();
}

async function issueToken(): Promise<{ token: string; cookie: string }> {
  const response = await postCsrf();
  const payload = (await response.json()) as { data: { csrfToken: string } };
  return {
    token: payload.data.csrfToken,
    cookie: `${CSRF_COOKIE_NAME}=${payload.data.csrfToken}`,
  };
}

async function sessionCount(userId: string, organizationId: string): Promise<number> {
  const rows = await withTenantTransaction(getTestDb(), { userId, organizationId }, (tx) =>
    tx.execute<{ count: number }>(sql`select count(*)::int as count from sessions`),
  );
  return Number(rows[0]?.count ?? 0);
}

function setCookieOf(response: Response, name: string): string {
  return response.headers.getSetCookie().find((cookie) => cookie.startsWith(`${name}=`)) ?? "";
}

describe("login request verification", () => {
  beforeEach(resetState);
  afterAll(closeTestDb);

  it("creates a session for valid credentials, token, and origin", async () => {
    const registered = await registerViaApi({
      email: "verify@example.com",
      organizationName: "Verify Org",
    });
    const { token, cookie } = await issueToken();
    // Registration already issued one session; a login must add exactly one.
    const before = await sessionCount(registered.userId, registered.organizationId);

    const { response, body } = await postLogin({
      token,
      cookie,
      body: { email: "verify@example.com", password: DEFAULT_PASSWORD },
    });

    expect(body.error).toBeUndefined();
    expect(response.status).toBe(200);

    const sessionCookie = setCookieOf(response, SESSION_COOKIE_NAME);
    expect(sessionCookie).toMatch(/HttpOnly/i);
    expect(sessionCookie).toMatch(/Secure/i);
    expect(sessionCookie).toMatch(/SameSite=lax/i);
    expect(sessionCookie).toMatch(/Path=\//i);
    expect(sessionCookie).not.toMatch(/Domain=/i);

    expect(await sessionCount(registered.userId, registered.organizationId)).toBe(before + 1);

    const audits = await withTenantTransaction(
      getTestDb(),
      { userId: registered.userId, organizationId: registered.organizationId },
      (tx) => tx.execute<{ action: string }>(sql`select action from audit_logs`),
    );
    expect(audits.map((row) => row.action)).toContain("user.login");

    // The UI redirects to /app on 200; /app itself only needs this session.
    const value = sessionCookie.slice(`${SESSION_COOKIE_NAME}=`.length).split(";")[0]!;
    const client = new ApiClient();
    client.cookies.set(SESSION_COOKIE_NAME, value);
    const session = await client.get<{ authenticated: boolean; role: string | null }>(
      "/api/auth/session",
    );
    expect(session.body.data?.authenticated).toBe(true);
    expect(session.body.data?.role).toBe("owner");
  });

  it("rejects a login whose CSRF cookie never arrived, as in the embedded preview", async () => {
    const registered = await registerViaApi({
      email: "nocookie@example.com",
      organizationName: "No Cookie Org",
    });
    const { token } = await issueToken();
    const before = await sessionCount(registered.userId, registered.organizationId);

    const { response, body } = await postLogin({
      token,
      cookie: null,
      body: { email: "nocookie@example.com", password: DEFAULT_PASSWORD },
    });

    expect(response.status).toBe(403);
    expect(body.error?.code).toBe("FORBIDDEN");
    // A rejected verification must never mint a session.
    expect(await sessionCount(registered.userId, registered.organizationId)).toBe(before);
  });

  it("rejects a login with no token header even when the cookie is valid", async () => {
    await registerViaApi({ email: "noheader@example.com", organizationName: "No Header Org" });
    const { cookie } = await issueToken();

    const { response, body } = await postLogin({
      cookie,
      token: null,
      body: { email: "noheader@example.com", password: DEFAULT_PASSWORD },
    });

    expect(response.status).toBe(403);
    expect(body.error?.code).toBe("FORBIDDEN");
  });

  it("rejects a login whose header and cookie disagree", async () => {
    await registerViaApi({ email: "mismatch@example.com", organizationName: "Mismatch Org" });
    const { cookie } = await issueToken();

    const { response } = await postLogin({
      cookie,
      token: "not-the-issued-token",
      body: { email: "mismatch@example.com", password: DEFAULT_PASSWORD },
    });

    expect(response.status).toBe(403);
  });

  it("accepts a proxied request whose Host was rewritten by the preview proxy", async () => {
    await registerViaApi({ email: "preview@example.com", organizationName: "Preview Org" });
    const { token, cookie } = await issueToken();

    const { response, body } = await postLogin({
      host: "127.0.0.1:4011",
      forwardedHost: "4011-preview.e2b.app",
      origin: "https://4011-preview.e2b.app",
      token,
      cookie,
      body: { email: "preview@example.com", password: DEFAULT_PASSWORD },
    });

    expect(body.error).toBeUndefined();
    expect(response.status).toBe(200);
  });

  it("accepts a same-origin Referer when Origin is absent", async () => {
    await registerViaApi({ email: "referer@example.com", organizationName: "Referer Org" });
    const { token, cookie } = await issueToken();

    const { response, body } = await postLogin({
      origin: null,
      referer: "http://localhost:3000/login?next=%2Fapp",
      token,
      cookie,
      body: { email: "referer@example.com", password: DEFAULT_PASSWORD },
    });

    expect(body.error).toBeUndefined();
    expect(response.status).toBe(200);
  });

  it("rejects a foreign Referer when Origin is absent", async () => {
    await registerViaApi({ email: "badreferer@example.com", organizationName: "Bad Referer Org" });
    const { token, cookie } = await issueToken();

    const { response } = await postLogin({
      origin: null,
      referer: "https://evil.example/login",
      token,
      cookie,
      body: { email: "badreferer@example.com", password: DEFAULT_PASSWORD },
    });

    expect(response.status).toBe(403);
  });

  it("rejects a foreign Origin even when the Referer matches", async () => {
    await registerViaApi({ email: "originwins@example.com", organizationName: "Origin Wins Org" });
    const { token, cookie } = await issueToken();

    const { response } = await postLogin({
      origin: "https://evil.example",
      referer: "http://localhost:3000/login",
      token,
      cookie,
      body: { email: "originwins@example.com", password: DEFAULT_PASSWORD },
    });

    expect(response.status).toBe(403);
  });

  it("rejects a request with neither Origin nor Referer", async () => {
    await registerViaApi({ email: "nosource@example.com", organizationName: "No Source Org" });
    const { token, cookie } = await issueToken();

    const { response } = await postLogin({
      origin: null,
      token,
      cookie,
      body: { email: "nosource@example.com", password: DEFAULT_PASSWORD },
    });

    expect(response.status).toBe(403);
  });

  it("rejects a lookalike preview origin", async () => {
    await registerViaApi({ email: "lookalike@example.com", organizationName: "Lookalike Org" });
    const { token, cookie } = await issueToken();

    const { response } = await postLogin({
      origin: "https://4011-preview.e2b.app.evil.test",
      token,
      cookie,
      body: { email: "lookalike@example.com", password: DEFAULT_PASSWORD },
    });

    expect(response.status).toBe(403);
  });
});

describe("CSRF cookie policy per environment", () => {
  beforeEach(resetState);

  afterEach(() => {
    delete process.env.PREVIEW_EMBEDDED_COOKIES;
    resetServerEnvCache();
  });

  afterAll(closeTestDb);

  it("keeps the same-origin Lax cookie outside preview mode", async () => {
    const response = await postCsrf();
    const cookie = setCookieOf(response, CSRF_COOKIE_NAME);

    expect(cookie).toContain("Path=/");
    expect(cookie).toMatch(/Secure/i);
    expect(cookie).toMatch(/SameSite=lax/i);
    expect(cookie).not.toMatch(/Partitioned/i);
  });

  it("issues a partitioned cookie and completes login inside an embedded iframe", async () => {
    process.env.PREVIEW_EMBEDDED_COOKIES = "partitioned";
    resetServerEnvCache();

    const registered = await registerViaApi({
      email: "embedded@example.com",
      organizationName: "Embedded Org",
    });

    const csrfResponse = await postCsrf();
    const csrfCookie = setCookieOf(csrfResponse, CSRF_COOKIE_NAME);
    expect(csrfCookie).toMatch(/SameSite=none/i);
    expect(csrfCookie).toMatch(/Secure/i);
    expect(csrfCookie).toMatch(/Partitioned/i);

    const { data } = (await csrfResponse.json()) as { data: { csrfToken: string } };
    const csrfToken = data.csrfToken;

    // A browser in a cross-site iframe only keeps cookies that are
    // SameSite=None, Secure, and Partitioned — replay exactly those.
    const { response } = await postLogin({
      host: "127.0.0.1:4011",
      forwardedHost: "4011-preview.e2b.app",
      origin: "https://4011-preview.e2b.app",
      token: csrfToken,
      cookie: `${CSRF_COOKIE_NAME}=${csrfToken}`,
      body: { email: "embedded@example.com", password: DEFAULT_PASSWORD },
    });

    expect(response.status).toBe(200);

    const sessionCookie = setCookieOf(response, SESSION_COOKIE_NAME);
    expect(sessionCookie).toMatch(/HttpOnly/i);
    expect(sessionCookie).toMatch(/Secure/i);
    expect(sessionCookie).toMatch(/SameSite=none/i);
    expect(sessionCookie).toMatch(/Partitioned/i);

    const value = sessionCookie.slice(`${SESSION_COOKIE_NAME}=`.length).split(";")[0]!;
    const client = new ApiClient();
    client.cookies.set(SESSION_COOKIE_NAME, value);
    const session = await client.get<{ authenticated: boolean; user: { email: string } }>(
      "/api/auth/session",
    );
    expect(session.body.data?.authenticated).toBe(true);
    expect(session.body.data?.user.email).toBe("embedded@example.com");

    const organization = await client.get<{ organization: { id: string } }>(
      "/api/organizations/current",
    );
    expect(organization.body.data?.organization.id).toBe(registered.organizationId);
  });
});

describe("tenant boundary after a verified login", () => {
  beforeEach(resetState);
  afterAll(closeTestDb);

  it("resolves the organization from the session and hides another tenant's store", async () => {
    const alpha = await registerViaApi({ email: "a@example.com", organizationName: "Alpha" });
    const beta = await registerViaApi({ email: "b@example.com", organizationName: "Beta" });

    const created = await beta.client.post<{ store: { id: string } }>(
      "/api/organizations/current/stores",
      { name: "متجر بيتا" },
    );
    const betaStoreId = created.body.data!.store.id;

    const { token, cookie } = await issueToken();

    const { response } = await postLogin({
      token,
      cookie,
      body: { email: alpha.email, password: alpha.password },
    });
    expect(response.status).toBe(200);

    const value = setCookieOf(response, SESSION_COOKIE_NAME)
      .slice(`${SESSION_COOKIE_NAME}=`.length)
      .split(";")[0]!;
    const client = new ApiClient();
    client.cookies.set(SESSION_COOKIE_NAME, value);

    const own = await client.get<{ organization: { id: string } }>("/api/organizations/current");
    expect(own.body.data?.organization.id).toBe(alpha.organizationId);

    const foreign = await client.get(`/api/organizations/current/stores/${betaStoreId}`);
    expect(foreign.status).toBe(404);
    expect(foreign.body.error?.code).toBe("TENANT_ISOLATION_VIOLATION");
  });
});
