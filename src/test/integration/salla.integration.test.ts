import { eq } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { storeConnections, oauthStates, stores } from "@/db/schema";
import { withTenantTransaction } from "@/db/tenant";
import { decryptSecret, connectionAad } from "@/lib/crypto";
import { closeTestDb, getTestDb } from "@/test/db/client";
import { callbackViaApi, resetState, type RegisteredUser } from "@/test/integration/helpers";
import { inviteAndAccept } from "@/test/integration/fixtures";
import {
  clearMockSalla,
  configureMockSalla,
  stateFromAuthorizationUrl,
} from "@/test/integration/salla-helpers";
import { MockSallaServer } from "@/test/integration/mock-salla-server";
import { registerViaApi } from "@/test/integration/helpers";

const mock = new MockSallaServer();

beforeAll(async () => {
  await mock.start();
});

afterAll(async () => {
  await mock.stop();
  closeTestDb();
});

beforeEach(async () => {
  await resetState();
  mock.reset();
  configureMockSalla(mock.url);
});

afterEach(() => {
  clearMockSalla();
});

interface StoreFixture extends RegisteredUser {
  storeId: string;
}

async function ownerWithStore(email: string, storeName = "كشخة"): Promise<StoreFixture> {
  const owner = await registerViaApi({
    email,
    organizationName: `مؤسسة ${email}`,
    storeName,
  });

  const storesResponse = await owner.client.get<{ stores: Array<{ id: string }> }>(
    "/api/organizations/current/stores",
  );
  const storeId = storesResponse.body.data?.stores[0]?.id;
  if (!storeId) throw new Error("store not created during registration");

  return { ...owner, storeId };
}

async function startAuthorization(owner: StoreFixture) {
  return owner.client.post<{ authorizationUrl: string; expiresAt: string }>(
    `/api/organizations/current/stores/${owner.storeId}/salla/authorize`,
    undefined,
    undefined,
  );
}

async function connectStore(owner: StoreFixture) {
  const started = await startAuthorization(owner);
  const authorizationUrl = started.body.data?.authorizationUrl;
  if (!authorizationUrl) throw new Error(`authorize failed: ${JSON.stringify(started.body)}`);

  const state = stateFromAuthorizationUrl(authorizationUrl);
  const callback = await callbackViaApi(owner.client, { code: "mock-code", state });

  return { authorizationUrl, state, callback };
}

function locationParams(location: string | null): URLSearchParams {
  if (!location) throw new Error("missing redirect location");
  return new URL(location).searchParams;
}

describe("Salla OAuth start", () => {
  it("returns an official authorization URL with a state and only read scopes", async () => {
    const owner = await ownerWithStore("owner@example.com");

    const response = await startAuthorization(owner);
    expect(response.status).toBe(200);

    const url = new URL(response.body.data!.authorizationUrl);
    expect(url.origin).toBe(mock.url);
    expect(url.pathname).toBe("/oauth2/auth");
    expect(url.searchParams.get("client_id")).toBe("test-client-id");
    expect(url.searchParams.get("response_type")).toBe("code");
    expect(url.searchParams.get("redirect_uri")).toBe(
      "http://localhost:3000/api/integrations/salla/callback",
    );
    expect(url.searchParams.get("scope")).toBe(
      "offline_access products.read categories.read orders.read customers.read",
    );
    expect(url.searchParams.get("state")).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(response.body.data!.authorizationUrl).not.toContain("test-client-secret-value");

    const rows = await withTenantTransaction(
      getTestDb(),
      { organizationId: owner.organizationId },
      (tx) => tx.select().from(oauthStates),
    );
    expect(rows).toHaveLength(1);
    // Only the hash is stored, never the state itself.
    expect(rows[0]!.stateHash).not.toContain(url.searchParams.get("state")!);
  });

  it("creates the connection row in `authorizing` state without tokens", async () => {
    const owner = await ownerWithStore("owner@example.com");
    await startAuthorization(owner);

    const [connection] = await withTenantTransaction(
      getTestDb(),
      { organizationId: owner.organizationId },
      (tx) => tx.select().from(storeConnections),
    );

    expect(connection?.status).toBe("authorizing");
    expect(connection?.accessTokenCiphertext).toBeNull();
    expect(connection?.refreshTokenCiphertext).toBeNull();
  });

  it("records an audit event without secrets", async () => {
    const owner = await ownerWithStore("owner@example.com");
    await startAuthorization(owner);

    const audit = await owner.client.get<{ entries: Array<{ action: string; metadata: unknown }> }>(
      "/api/organizations/current/audit",
    );

    const started = audit.body.data?.entries.find(
      (event) => event.action === "salla.authorization.started",
    );
    expect(started).toBeDefined();
    const serialized = JSON.stringify(audit.body);
    expect(serialized).not.toContain("test-client-secret-value");
    expect(serialized).not.toContain("mock-access");
  });

  it("forbids viewers and unauthenticated callers", async () => {
    const owner = await ownerWithStore("owner@example.com");
    const viewer = await inviteAndAccept(owner, "viewer@example.com", "viewer");
    // The viewer was invited to the owner's organization; use the owner's store.
    const response = await viewer.client.post(
      `/api/organizations/current/stores/${owner.storeId}/salla/authorize`,
      undefined,
      undefined,
    );

    expect(response.status).toBe(403);
    expect(response.body.error?.code).toBe("FORBIDDEN");
  });

  it("allows an admin with store:connect", async () => {
    const owner = await ownerWithStore("owner@example.com");
    const admin = await inviteAndAccept(owner, "admin@example.com", "admin");

    const response = await admin.client.post<{ authorizationUrl: string }>(
      `/api/organizations/current/stores/${owner.storeId}/salla/authorize`,
      undefined,
      undefined,
    );

    expect(response.status).toBe(200);
    expect(response.body.data?.authorizationUrl).toContain("response_type=code");
  });

  it("returns 404 for a store belonging to another organization", async () => {
    const owner = await ownerWithStore("owner@example.com");
    const stranger = await ownerWithStore("stranger@example.com");

    const response = await stranger.client.post(
      `/api/organizations/current/stores/${owner.storeId}/salla/authorize`,
      undefined,
      undefined,
    );

    expect(response.status).toBe(404);
  });

  it("refuses to start when the Salla app is not configured", async () => {
    const owner = await ownerWithStore("owner@example.com");
    clearMockSalla();

    const response = await startAuthorization(owner);

    expect(response.status).toBe(503);
    expect(response.body.error?.code).toBe("INTEGRATION_NOT_CONFIGURED");
    configureMockSalla(mock.url);
  });
});

describe("Salla OAuth callback", () => {
  it("connects the store, persists encrypted tokens, and audits", async () => {
    const owner = await ownerWithStore("owner@example.com");
    const { callback } = await connectStore(owner);

    expect(callback.status).toBe(307);
    const params = locationParams(callback.location);
    expect(params.get("connected")).toBe("1");

    const [connection] = await withTenantTransaction(
      getTestDb(),
      { organizationId: owner.organizationId },
      (tx) => tx.select().from(storeConnections),
    );

    expect(connection?.status).toBe("connected");
    expect(connection?.externalStoreId).toBe("847769313");
    expect(connection?.externalUserId).toBe("1689171978");
    expect(connection?.scopes).toEqual([
      "offline_access",
      "products.read",
      "categories.read",
      "orders.read",
      "customers.read",
    ]);
    expect(connection?.connectedAt).not.toBeNull();

    // Ciphertext must not contain the token, and must decrypt with the tenant AAD.
    expect(connection?.accessTokenCiphertext).not.toContain("mock-access");
    expect(connection?.refreshTokenCiphertext).not.toContain("mock-refresh");

    const aad = connectionAad({
      provider: "salla",
      organizationId: owner.organizationId,
      storeId: owner.storeId,
    });
    expect(decryptSecret(connection!.accessTokenCiphertext!, aad)).toMatch(/^mock-access-/);

    const [store] = await withTenantTransaction(
      getTestDb(),
      { organizationId: owner.organizationId },
      (tx) => tx.select().from(stores).where(eq(stores.id, owner.storeId)),
    );
    expect(store?.status).toBe("connected");

    const audit = await owner.client.get<{ entries: Array<{ action: string }> }>(
      "/api/organizations/current/audit",
    );
    const actions = audit.body.data?.entries.map((event) => event.action) ?? [];
    expect(actions).toContain("salla.authorization.succeeded");
    expect(actions).toContain("salla.connection.created");
  });

  it("stores the authorization code nowhere and never echoes tokens", async () => {
    const owner = await ownerWithStore("owner@example.com");
    const { callback } = await connectStore(owner);

    expect(callback.location).not.toContain("mock-access");
    expect(callback.location).not.toContain("mock-refresh");

    const connectionResponse = await owner.client.get(
      `/api/organizations/current/stores/${owner.storeId}/salla/connection`,
    );
    const serialized = JSON.stringify(connectionResponse.body);

    expect(serialized).not.toContain("mock-access");
    expect(serialized).not.toContain("mock-refresh");
    expect(serialized).not.toContain("Ciphertext");
    expect(serialized).not.toContain("test-client-secret-value");
  });

  it("rejects a replayed state", async () => {
    const owner = await ownerWithStore("owner@example.com");
    const started = await startAuthorization(owner);
    const state = stateFromAuthorizationUrl(started.body.data!.authorizationUrl);

    const first = await callbackViaApi(owner.client, { code: "mock-code", state });
    expect(locationParams(first.location).get("connected")).toBe("1");

    const second = await callbackViaApi(owner.client, { code: "mock-code-2", state });
    expect(locationParams(second.location).get("salla_error")).toBe("state_replayed");
  });

  it("rejects an expired state", async () => {
    const owner = await ownerWithStore("owner@example.com");
    const started = await startAuthorization(owner);
    const state = stateFromAuthorizationUrl(started.body.data!.authorizationUrl);

    await withTenantTransaction(getTestDb(), { organizationId: owner.organizationId }, (tx) =>
      tx
        .update(oauthStates)
        .set({ expiresAt: new Date(Date.now() - 60_000) })
        .where(eq(oauthStates.storeId, owner.storeId)),
    );

    const callback = await callbackViaApi(owner.client, { code: "mock-code", state });
    expect(locationParams(callback.location).get("salla_error")).toBe("state_expired");
  });

  it("rejects a state created for a different session", async () => {
    const owner = await ownerWithStore("owner@example.com");
    const started = await startAuthorization(owner);
    const state = stateFromAuthorizationUrl(started.body.data!.authorizationUrl);

    // A second user in the same organization, holding the leaked state.
    const admin = await inviteAndAccept(owner, "admin@example.com", "admin");
    const callback = await callbackViaApi(admin.client, { code: "mock-code", state });

    expect(locationParams(callback.location).get("salla_error")).toBe("session_mismatch");
  });

  it("rejects a forged state", async () => {
    const owner = await ownerWithStore("owner@example.com");
    await startAuthorization(owner);

    const callback = await callbackViaApi(owner.client, {
      code: "mock-code",
      state: "A".repeat(43),
    });

    expect(locationParams(callback.location).get("salla_error")).toBe("invalid_state");
  });

  it("handles a provider error without exposing the raw description", async () => {
    const owner = await ownerWithStore("owner@example.com");
    const started = await startAuthorization(owner);
    const state = stateFromAuthorizationUrl(started.body.data!.authorizationUrl);

    const callback = await callbackViaApi(owner.client, {
      state,
      error: "access_denied",
      error_description: "Leaked internal detail",
    });

    expect(locationParams(callback.location).get("salla_error")).toBe("access_denied");
    expect(callback.location).not.toContain("Leaked internal detail");
  });

  it("reports a missing code", async () => {
    const owner = await ownerWithStore("owner@example.com");
    const started = await startAuthorization(owner);
    const state = stateFromAuthorizationUrl(started.body.data!.authorizationUrl);

    const callback = await callbackViaApi(owner.client, { state });
    expect(locationParams(callback.location).get("salla_error")).toBe("missing_code");
  });

  it("maps an invalid_grant token exchange to a clean failure", async () => {
    const owner = await ownerWithStore("owner@example.com");
    mock.behaviour.authorizationCodeError = "invalid_grant";

    const { callback } = await connectStore(owner);

    expect(locationParams(callback.location).get("salla_error")).toBe("exchange_failed");
    expect(callback.location).not.toContain("invalid_grant");

    const [connection] = await withTenantTransaction(
      getTestDb(),
      { organizationId: owner.organizationId },
      (tx) => tx.select().from(storeConnections),
    );
    expect(connection?.status).toBe("error");
    expect(connection?.accessTokenCiphertext).toBeNull();
  });

  it("redirects to login when the callback arrives without a session", async () => {
    const owner = await ownerWithStore("owner@example.com");
    const started = await startAuthorization(owner);
    const state = stateFromAuthorizationUrl(started.body.data!.authorizationUrl);

    const empty = new Map<string, string>();
    const { buildCallbackRequest } = await import("@/test/integration/salla-helpers");
    const { GET } = await import("@/app/api/integrations/salla/callback/route");
    const response = await GET(buildCallbackRequest({ code: "x", state }, empty));

    const location = response.headers.get("location");
    expect(location).toContain("/login");

    // The state is still valid: the user can finish after signing in.
    const callback = await callbackViaApi(owner.client, { code: "mock-code", state });
    expect(locationParams(callback.location).get("connected")).toBe("1");
  });

  it("builds redirects from APP_URL, not from a forged Host header", async () => {
    const owner = await ownerWithStore("owner@example.com");
    const started = await startAuthorization(owner);
    const state = stateFromAuthorizationUrl(started.body.data!.authorizationUrl);

    const { buildCallbackRequest } = await import("@/test/integration/salla-helpers");
    const { GET } = await import("@/app/api/integrations/salla/callback/route");
    const request = buildCallbackRequest({ code: "mock-code", state }, owner.client.cookies);
    request.headers.set("host", "evil.example.com");

    const response = await GET(request);
    const location = response.headers.get("location") ?? "";

    expect(location.startsWith("http://localhost:3000/")).toBe(true);
    expect(location).not.toContain("evil.example.com");
  });

  it("rejects reuse of an authorization code sent by Salla", async () => {
    const owner = await ownerWithStore("owner@example.com");
    const first = await connectStore(owner);
    expect(locationParams(first.callback.location).get("connected")).toBe("1");

    const secondStart = await startAuthorization(owner);
    const state = stateFromAuthorizationUrl(secondStart.body.data!.authorizationUrl);
    mock.behaviour.authorizationCodeError = "invalid_grant";
    const second = await callbackViaApi(owner.client, { code: "mock-code", state });

    expect(locationParams(second.location).get("salla_error")).toBe("exchange_failed");
  });
});

describe("store identity and linking", () => {
  it("prevents one Salla store from linking to two internal stores", async () => {
    const owner = await ownerWithStore("owner@example.com", "المتجر الأول");
    await connectStore(owner);

    const created = await owner.client.post<{ store: { id: string } }>(
      "/api/organizations/current/stores",
      { name: "المتجر الثاني" },
    );
    const secondStoreId = created.body.data?.store.id;
    expect(secondStoreId).toBeDefined();

    const started = await owner.client.post<{ authorizationUrl: string }>(
      `/api/organizations/current/stores/${secondStoreId}/salla/authorize`,
      undefined,
      undefined,
    );
    const state = stateFromAuthorizationUrl(started.body.data!.authorizationUrl);
    const callback = await callbackViaApi(owner.client, { code: "mock-code-2", state });

    expect(locationParams(callback.location).get("salla_error")).toBe("already_linked");

    const rows = await withTenantTransaction(
      getTestDb(),
      { organizationId: owner.organizationId },
      (tx) => tx.select().from(storeConnections).where(eq(storeConnections.status, "connected")),
    );
    expect(rows).toHaveLength(1);
  });

  it("reconnects without creating a duplicate connection", async () => {
    const owner = await ownerWithStore("owner@example.com");
    await connectStore(owner);

    const before = await withTenantTransaction(
      getTestDb(),
      { organizationId: owner.organizationId },
      (tx) => tx.select().from(storeConnections),
    );

    const second = await connectStore(owner);
    expect(locationParams(second.callback.location).get("connected")).toBe("1");

    const after = await withTenantTransaction(
      getTestDb(),
      { organizationId: owner.organizationId },
      (tx) => tx.select().from(storeConnections),
    );

    expect(after).toHaveLength(1);
    expect(after[0]!.id).toBe(before[0]!.id);
    expect(after[0]!.accessTokenCiphertext).not.toBe(before[0]!.accessTokenCiphertext);

    const audit = await owner.client.get<{ entries: Array<{ action: string }> }>(
      "/api/organizations/current/audit",
    );
    const actions = audit.body.data?.entries.map((event) => event.action) ?? [];
    expect(actions).toContain("salla.connection.updated");
  });

  it("disconnects locally, wipes credentials, and keeps the internal store", async () => {
    const owner = await ownerWithStore("owner@example.com");
    await connectStore(owner);

    const response = await owner.client.delete<{
      connection: { status: string; connected: boolean };
    }>(`/api/organizations/current/stores/${owner.storeId}/salla/connection`, {
      storeId: owner.storeId,
    });

    expect(response.status).toBe(200);
    expect(response.body.data!.connection.status).toBe("disconnected");

    const [connection] = await withTenantTransaction(
      getTestDb(),
      { organizationId: owner.organizationId },
      (tx) => tx.select().from(storeConnections),
    );
    expect(connection?.status).toBe("disconnected");
    expect(connection?.accessTokenCiphertext).toBeNull();
    expect(connection?.refreshTokenCiphertext).toBeNull();
    expect(connection?.revokedAt).not.toBeNull();

    const [store] = await withTenantTransaction(
      getTestDb(),
      { organizationId: owner.organizationId },
      (tx) => tx.select().from(stores).where(eq(stores.id, owner.storeId)),
    );
    expect(store).toBeDefined();
    expect(store?.status).toBe("not_connected");

    const audit = await owner.client.get<{ entries: Array<{ action: string }> }>(
      "/api/organizations/current/audit",
    );
    expect(audit.body.data?.entries.map((event) => event.action)).toContain(
      "salla.connection.disconnected",
    );
  });

  it("forbids a viewer from disconnecting", async () => {
    const owner = await ownerWithStore("owner@example.com");
    await connectStore(owner);
    const viewer = await inviteAndAccept(owner, "viewer@example.com", "viewer");

    const response = await viewer.client.delete(
      `/api/organizations/current/stores/${owner.storeId}/salla/connection`,
      { storeId: owner.storeId },
    );

    expect(response.status).toBe(403);
  });

  it("hides another tenant's connection", async () => {
    const owner = await ownerWithStore("owner@example.com");
    await connectStore(owner);
    const stranger = await ownerWithStore("stranger@example.com");

    const response = await stranger.client.get(
      `/api/organizations/current/stores/${owner.storeId}/salla/connection`,
    );

    expect(response.status).toBe(404);
  });

  it("reports an honest health status", async () => {
    const response = await fetch_health();
    expect(response.status).toBe(200);
    expect(response.body.integrations.salla.configured).toBe(true);
    expect(response.body.integrations.salla.oauthMode).toBe("custom");
    expect(JSON.stringify(response.body)).not.toContain("test-client-secret-value");
  });
});

interface HealthBody {
  status: string;
  integrations: {
    salla: { configured: boolean; oauthMode: string; oauthImplemented: boolean };
  };
}

async function fetch_health(): Promise<{ status: number; body: HealthBody }> {
  const { GET } = await import("@/app/api/health/route");
  const response = await GET();
  return { status: response.status, body: (await response.json()) as HealthBody };
}
