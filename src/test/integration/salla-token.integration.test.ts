import { and, eq } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { getDb } from "@/db/client";
import { auditLogs, storeConnections } from "@/db/schema";
import { withTenantTransaction } from "@/db/tenant";
import { connectionAad, decryptSecret, encryptSecret } from "@/lib/crypto";
import { getAccessToken } from "@/modules/integrations/salla/application/token-manager";
import { SallaIntegrationError } from "@/modules/integrations/salla/domain/errors";
import { closeTestDb } from "@/test/db/client";
import {
  callbackViaApi,
  registerViaApi,
  resetState,
  type RegisteredUser,
} from "@/test/integration/helpers";
import { MockSallaServer } from "@/test/integration/mock-salla-server";
import {
  clearMockSalla,
  configureMockSalla,
  stateFromAuthorizationUrl,
} from "@/test/integration/salla-helpers";

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

interface Connected extends RegisteredUser {
  storeId: string;
  connectionId: string;
}

async function connectedStore(email: string): Promise<Connected> {
  const owner = await registerViaApi({
    email,
    organizationName: `مؤسسة ${email}`,
    storeName: "كشخة",
  });

  const storesResponse = await owner.client.get<{ stores: Array<{ id: string }> }>(
    "/api/organizations/current/stores",
  );
  const storeId = storesResponse.body.data!.stores[0]!.id;

  const started = await owner.client.post<{ authorizationUrl: string }>(
    `/api/organizations/current/stores/${storeId}/salla/authorize`,
    undefined,
    undefined,
  );
  const state = stateFromAuthorizationUrl(started.body.data!.authorizationUrl);
  const callback = await callbackViaApi(owner.client, { code: "mock-code", state });
  expect(new URL(callback.location!).searchParams.get("connected")).toBe("1");

  const [connection] = await withTenantTransaction(
    getDb(),
    { organizationId: owner.organizationId },
    (tx) => tx.select().from(storeConnections),
  );

  // Ignore the token exchange that belongs to the connection flow itself.
  mock.requests.length = 0;

  return { ...owner, storeId, connectionId: connection!.id };
}

async function expireAccessToken(owner: RegisteredUser, connectionId: string): Promise<void> {
  await withTenantTransaction(getDb(), { organizationId: owner.organizationId }, (tx) =>
    tx
      .update(storeConnections)
      .set({ accessTokenExpiresAt: new Date(Date.now() - 60_000) })
      .where(eq(storeConnections.id, connectionId)),
  );
}

async function readConnection(owner: RegisteredUser, connectionId: string) {
  const [row] = await withTenantTransaction(
    getDb(),
    { organizationId: owner.organizationId },
    (tx) => tx.select().from(storeConnections).where(eq(storeConnections.id, connectionId)),
  );
  return row!;
}

function tokenFor(owner: RegisteredUser, connectionId: string) {
  return getAccessToken(getDb(), { organizationId: owner.organizationId, connectionId });
}

describe("token manager", () => {
  it("returns the stored token without contacting Salla while it is valid", async () => {
    const owner = await connectedStore("owner@example.com");

    const result = await tokenFor(owner, owner.connectionId);

    expect(result.accessToken).toMatch(/^mock-access-/);
    expect(mock.tokenRequestCount()).toBe(0);
  });

  it("refreshes an expired token exactly once and stores the rotated pair", async () => {
    const owner = await connectedStore("owner@example.com");
    const before = await readConnection(owner, owner.connectionId);
    await expireAccessToken(owner, owner.connectionId);

    const result = await tokenFor(owner, owner.connectionId);

    expect(mock.refreshRequestCount()).toBe(1);
    expect(mock.requests.at(-1)?.form.grant_type).toBe("refresh_token");
    // The client secret travels in the body, as documented, and never in a URL.
    expect(mock.requests.at(-1)?.form.client_secret).toBe("test-client-secret-value");

    const after = await readConnection(owner, owner.connectionId);
    expect(after.tokenVersion).toBe(before.tokenVersion + 1);
    expect(after.lastRefreshAt).not.toBeNull();
    expect(after.accessTokenCiphertext).not.toBe(before.accessTokenCiphertext);
    expect(after.refreshTokenCiphertext).not.toBe(before.refreshTokenCiphertext);
    expect(after.status).toBe("connected");

    const aad = connectionAad({
      provider: "salla",
      organizationId: owner.organizationId,
      storeId: owner.storeId,
    });
    expect(decryptSecret(after.accessTokenCiphertext!, aad)).toBe(result.accessToken);
    expect(decryptSecret(after.refreshTokenCiphertext!, aad)).toMatch(/^mock-refresh-/);

    const audit = await owner.client.get<{ entries: Array<{ action: string }> }>(
      "/api/organizations/current/audit",
    );
    expect(audit.body.data?.entries.map((entry) => entry.action)).toContain(
      "salla.token.refreshed",
    );
  });

  it("performs a single refresh for ten concurrent callers and never reuses a refresh token", async () => {
    const owner = await connectedStore("owner@example.com");
    const before = await readConnection(owner, owner.connectionId);
    await expireAccessToken(owner, owner.connectionId);

    const results = await Promise.all(
      Array.from({ length: 10 }, () => tokenFor(owner, owner.connectionId)),
    );

    expect(mock.refreshRequestCount()).toBe(1);
    expect(new Set(results.map((result) => result.accessToken)).size).toBe(1);

    const after = await readConnection(owner, owner.connectionId);
    expect(after.tokenVersion).toBe(before.tokenVersion + 1);

    // A second wave must be served from the freshly stored token.
    await Promise.all(Array.from({ length: 5 }, () => tokenFor(owner, owner.connectionId)));
    expect(mock.refreshRequestCount()).toBe(1);
  });

  it("moves to reauth_required on invalid_grant and stops calling Salla", async () => {
    const owner = await connectedStore("owner@example.com");
    await expireAccessToken(owner, owner.connectionId);

    // Present a refresh token Salla already considers spent.
    const aad = connectionAad({
      provider: "salla",
      organizationId: owner.organizationId,
      storeId: owner.storeId,
    });
    mock.revokedRefreshTokens.add("mock-spent-refresh");
    await withTenantTransaction(getDb(), { organizationId: owner.organizationId }, (tx) =>
      tx
        .update(storeConnections)
        .set({ refreshTokenCiphertext: encryptSecret("mock-spent-refresh", aad) })
        .where(eq(storeConnections.id, owner.connectionId)),
    );

    const first = await tokenFor(owner, owner.connectionId).catch((error: unknown) => error);
    expect(first).toBeInstanceOf(SallaIntegrationError);
    expect((first as SallaIntegrationError).sallaKind).toBe("invalid_grant");

    const after = await readConnection(owner, owner.connectionId);
    expect(after.status).toBe("reauth_required");
    expect(after.accessTokenCiphertext).toBeNull();
    expect(after.refreshTokenCiphertext).toBeNull();
    expect(after.lastErrorCode).toBe("invalid_grant");

    const callsAfterFailure = mock.tokenRequestCount();
    const second = await tokenFor(owner, owner.connectionId).catch((error: unknown) => error);
    expect((second as { code?: string }).code).toBe("INTEGRATION_AUTH_REQUIRED");
    // No further token endpoint traffic for a connection that needs reauth.
    expect(mock.tokenRequestCount()).toBe(callsAfterFailure);
  });

  it("keeps the connection and its tokens when the network fails", async () => {
    const owner = await connectedStore("owner@example.com");
    const before = await readConnection(owner, owner.connectionId);
    await expireAccessToken(owner, owner.connectionId);
    mock.behaviour.failTokenRequests = true;

    const error = await tokenFor(owner, owner.connectionId).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(SallaIntegrationError);
    expect((error as SallaIntegrationError).sallaKind).toBe("network");

    const during = await readConnection(owner, owner.connectionId);
    expect(during.status).toBe("connected");
    expect(during.accessTokenCiphertext).toBe(before.accessTokenCiphertext);
    expect(during.refreshTokenCiphertext).toBe(before.refreshTokenCiphertext);
    expect(during.refreshLockId).toBeNull();
    expect(during.lastErrorCode).toBe("network");

    mock.behaviour.failTokenRequests = false;
    const recovered = await tokenFor(owner, owner.connectionId);
    expect(recovered.accessToken).toMatch(/^mock-access-/);
    expect((await readConnection(owner, owner.connectionId)).status).toBe("connected");
  });

  it("never writes a token into audit metadata or a token column in plaintext", async () => {
    const owner = await connectedStore("owner@example.com");
    await expireAccessToken(owner, owner.connectionId);
    const result = await tokenFor(owner, owner.connectionId);

    const row = await readConnection(owner, owner.connectionId);
    expect(row.accessTokenCiphertext).not.toContain(result.accessToken);
    expect(row.refreshTokenCiphertext).not.toContain("mock-refresh");

    const entries = await withTenantTransaction(
      getDb(),
      { organizationId: owner.organizationId },
      (tx) => tx.select().from(auditLogs).where(eq(auditLogs.action, "salla.token.refreshed")),
    );

    expect(entries.length).toBe(1);
    const serialized = JSON.stringify(entries[0]!.metadata);
    expect(serialized).not.toContain("mock-access");
    expect(serialized).not.toContain("mock-refresh");
    expect(serialized).not.toContain("test-client-secret-value");
  });

  it("refuses to serve a disconnected connection", async () => {
    const owner = await connectedStore("owner@example.com");

    await withTenantTransaction(getDb(), { organizationId: owner.organizationId }, (tx) =>
      tx
        .update(storeConnections)
        .set({ status: "disconnected" })
        .where(
          and(eq(storeConnections.id, owner.connectionId), eq(storeConnections.provider, "salla")),
        ),
    );

    const error = await tokenFor(owner, owner.connectionId).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(Error);
    expect((error as { code?: string }).code).toBe("INTEGRATION_AUTH_REQUIRED");
    expect(mock.tokenRequestCount()).toBe(0);
  });
});
