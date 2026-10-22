import { sql } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { withTenantTransaction } from "@/db/tenant";
import { SESSION_COOKIE_NAME } from "@/modules/identity/domain/session-policy";
import { findUserByEmail } from "@/modules/identity/infrastructure/repositories";
import { closeTestDb, getTestDb } from "@/test/db/client";
import {
  ApiClient,
  DEFAULT_PASSWORD,
  loginViaApi,
  registerViaApi,
  resetState,
} from "@/test/integration/helpers";

describe("authentication", () => {
  beforeEach(resetState);
  afterAll(closeTestDb);

  it("registers a user, organization, owner membership, and session in one flow", async () => {
    const registered = await registerViaApi({
      email: "Owner@Example.com ",
      organizationName: "كشخة",
    });

    const user = await findUserByEmail(getTestDb(), "owner@example.com");
    expect(user).toBeDefined();
    expect(user?.passwordHash).not.toContain(DEFAULT_PASSWORD);
    expect(user?.passwordHash.startsWith("scrypt$16384$8$1$")).toBe(true);

    const membership = await withTenantTransaction(
      getTestDb(),
      { userId: registered.userId, organizationId: registered.organizationId },
      (tx) =>
        tx.execute<{ role: string; status: string; user_id: string }>(
          sql`select role, status, user_id from organization_members`,
        ),
    );

    expect(membership).toHaveLength(1);
    expect(membership[0]?.role).toBe("owner");
    expect(membership[0]?.status).toBe("active");

    const audits = await withTenantTransaction(
      getTestDb(),
      { userId: registered.userId, organizationId: registered.organizationId },
      (tx) =>
        tx.execute<{ action: string; metadata: unknown }>(
          sql`select action, metadata from audit_logs`,
        ),
    );

    const actions = audits.map((row) => row.action);
    expect(actions).toEqual(expect.arrayContaining(["user.registered", "organization.created"]));
    expect(JSON.stringify(audits)).not.toContain("scrypt$");

    const setCookie = registered.client.cookies.get(SESSION_COOKIE_NAME);
    expect(setCookie).toBeTruthy();
  });

  it("sets a hardened session cookie", async () => {
    const client = new ApiClient();
    await client.ensureCsrf();
    const result = await client.post("/api/auth/register", {
      email: "cookie@example.com",
      password: DEFAULT_PASSWORD,
      name: "Cookie Owner",
      organizationName: "Cookie Org",
    });

    expect(result.status).toBe(201);

    const raw = result.response.headers.getSetCookie().join("\n");
    expect(raw).toContain(`${SESSION_COOKIE_NAME}=`);
    expect(raw).toMatch(/HttpOnly/i);
    expect(raw).toMatch(/Secure/i);
    expect(raw).toMatch(/SameSite=lax/i);
    expect(raw).toMatch(/Path=\//i);
    expect(raw).not.toMatch(/Domain=/i);
  });

  it("rejects a duplicate email regardless of case and whitespace", async () => {
    await registerViaApi({ email: "duplicate@example.com", organizationName: "First Org" });

    const client = new ApiClient();
    await client.ensureCsrf();
    const result = await client.post("/api/auth/register", {
      email: "  DUPLICATE@example.com ",
      password: DEFAULT_PASSWORD,
      name: "Second",
      organizationName: "Second Org",
    });

    expect(result.status).toBe(409);
    expect(result.body.error?.code).toBe("CONFLICT");
    expect(result.body.error?.message).not.toContain("duplicate@example.com");
  });

  it("logs in and exposes the session without leaking secrets", async () => {
    await registerViaApi({ email: "login@example.com", organizationName: "Login Org" });

    const { client, status } = await loginViaApi("LOGIN@example.com", DEFAULT_PASSWORD);
    expect(status).toBe(200);

    const session = await client.get<{
      authenticated: boolean;
      user: { email: string };
      role: string;
      permissions: string[];
    }>("/api/auth/session");

    expect(session.status).toBe(200);
    expect(session.body.data?.authenticated).toBe(true);
    expect(session.body.data?.user.email).toBe("login@example.com");
    expect(session.body.data?.role).toBe("owner");
    expect(session.body.data?.permissions).toContain("billing:manage");

    const serialized = JSON.stringify(session.body);
    expect(serialized).not.toContain("passwordHash");
    expect(serialized).not.toContain("sessionTokenHash");
  });

  it("returns the same generic error for a wrong password and an unknown account", async () => {
    await registerViaApi({ email: "known@example.com", organizationName: "Known Org" });

    const wrongPassword = await loginViaApi("known@example.com", "definitely-not-the-password");
    const unknownAccount = await loginViaApi("missing@example.com", "definitely-not-the-password");

    expect(wrongPassword.status).toBe(401);
    expect(unknownAccount.status).toBe(401);
    expect(wrongPassword.body.error?.code).toBe("UNAUTHENTICATED");
    expect(unknownAccount.body.error?.code).toBe("UNAUTHENTICATED");
    expect(wrongPassword.body.error?.message).toBe(unknownAccount.body.error?.message);
  });

  it("revokes the session on logout and rejects the old cookie", async () => {
    const registered = await registerViaApi({
      email: "logout@example.com",
      organizationName: "Logout Org",
    });

    const before = await registered.client.get("/api/auth/session");
    expect(before.body.data).toMatchObject({ authenticated: true });

    const logout = await registered.client.post("/api/auth/logout");
    expect(logout.status).toBe(200);

    const after = await registered.client.get("/api/auth/session");
    expect(after.body.data).toMatchObject({ authenticated: false });
  });

  it("resolves the organization from the session, not from request input", async () => {
    const registered = await registerViaApi({
      email: "tenant@example.com",
      organizationName: "Tenant Org",
    });

    const overview = await registered.client.get<{
      organization: { id: string; name: string };
      role: string;
    }>("/api/organizations/current");

    expect(overview.status).toBe(200);
    expect(overview.body.data?.organization.id).toBe(registered.organizationId);
    expect(overview.body.data?.role).toBe("owner");
  });
});
