import { and, eq } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { productCategories, products, storeConnections, stores } from "@/db/schema";
import { withTenantTransaction } from "@/db/tenant";
import { permissionsForRole } from "@/modules/identity/domain/permissions";
import type { TenantContext } from "@/modules/identity/application/types";
import { syncStore } from "@/modules/catalog/application/sync-service";
import { closeTestDb, getTestDb } from "@/test/db/client";
import {
  callbackViaApi,
  registerViaApi,
  resetState,
  type RegisteredUser,
} from "@/test/integration/helpers";
import { inviteAndAccept } from "@/test/integration/fixtures";
import {
  clearMockSalla,
  configureMockSalla,
  stateFromAuthorizationUrl,
} from "@/test/integration/salla-helpers";
import { MockSallaServer } from "@/test/integration/mock-salla-server";

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

const META = { ipHash: "test-ip", userAgent: "vitest", requestId: null };

async function ownerWithStore(email: string, storeName = "متجر كشخة"): Promise<StoreFixture> {
  const owner = await registerViaApi({
    email,
    organizationName: `مؤسسة ${email}`,
    storeName,
  });

  const list = await owner.client.get<{ stores: Array<{ id: string }> }>(
    "/api/organizations/current/stores",
  );
  const storeId = list.body.data?.stores[0]?.id;
  if (!storeId) throw new Error("store not created");

  return { ...owner, storeId };
}

async function createSecondStore(owner: StoreFixture): Promise<string> {
  const created = await owner.client.post<{ store: { id: string } }>(
    "/api/organizations/current/stores",
    { name: "متجر ثانٍ" },
  );
  const id = created.body.data?.store.id;
  if (!id) throw new Error(`second store failed: ${JSON.stringify(created.body)}`);
  return id;
}

async function connect(owner: StoreFixture, storeId = owner.storeId): Promise<void> {
  const started = await owner.client.post<{ authorizationUrl: string }>(
    `/api/organizations/current/stores/${storeId}/salla/authorize`,
    undefined,
  );
  const authorizationUrl = started.body.data?.authorizationUrl;
  if (!authorizationUrl) throw new Error(`authorize failed: ${JSON.stringify(started.body)}`);

  const callback = await callbackViaApi(owner.client, {
    code: "mock-code",
    state: stateFromAuthorizationUrl(authorizationUrl),
  });
  if (callback.status !== 307) throw new Error("connection failed");

  // Token requests from the OAuth flow are not part of the sync assertions.
  mock.requests.length = 0;
}

function seedCatalog(): void {
  mock.categories = [
    {
      id: 10,
      name: "إلكترونيات",
      parent_id: 0,
      status: "active",
      sort_order: 0,
      update_at: "2024-01-01 10:00:00",
    },
    {
      id: 11,
      name: "جوالات",
      parent_id: 10,
      status: "active",
      sort_order: 1,
      update_at: "2024-01-02 10:00:00",
    },
    {
      id: 12,
      name: "سماعات",
      parent_id: 10,
      status: "hidden",
      sort_order: 2,
      update_at: "2024-01-03 10:00:00",
    },
  ];

  mock.products = [
    {
      id: 1001,
      name: "هاتف",
      sku: "SKU-1",
      type: "product",
      status: "sale",
      price: { amount: 999, currency: "SAR" },
      quantity: 5,
      is_available: true,
      updated_at: "2024-02-01 09:00:00",
      categories: [{ id: 11 }],
    },
    {
      id: 1002,
      name: "سماعة",
      sku: "SKU-2",
      type: "product",
      status: "sale",
      price: { amount: "149.5", currency: "SAR" },
      quantity: 0,
      is_available: false,
      updated_at: "2024-02-02 09:00:00",
      categories: [{ id: 12 }, { id: 10 }],
    },
    {
      id: 1003,
      name: "شاحن",
      sku: "SKU-3",
      type: "product",
      status: "hidden",
      price: { amount: 59, currency: "SAR" },
      quantity: 12,
      is_available: true,
      updated_at: "2024-02-03 09:00:00",
      categories: [],
    },
  ];
}

function contextFor(owner: RegisteredUser, role: "owner" | "manager" | "viewer" = "owner") {
  return {
    userId: owner.userId,
    organizationId: owner.organizationId,
    membershipId: "00000000-0000-0000-0000-000000000000",
    role,
    permissions: permissionsForRole(role),
    user: { id: owner.userId, email: owner.email, name: "مستخدم" },
    organization: { id: owner.organizationId, name: "مؤسسة", slug: "org" },
    sessionId: "00000000-0000-0000-0000-000000000000",
    requestId: null,
  } satisfies TenantContext;
}

async function syncViaApi(
  owner: StoreFixture,
  resource: "all" | "products" | "categories" = "all",
) {
  return owner.client.post<{
    runs: Array<{
      resource: string;
      status: string;
      pages: number;
      items: number;
      created: number;
      updated: number;
      linked: number;
    }>;
  }>(`/api/organizations/current/stores/${owner.storeId}/catalog/sync`, { resource });
}

describe("catalogue sync", () => {
  it("syncs categories before products and stores relationships", async () => {
    const owner = await ownerWithStore("catalog-owner@example.com");
    await connect(owner);
    seedCatalog();

    const response = await syncViaApi(owner);
    expect(response.status).toBe(200);
    expect(response.body.data?.runs.map((run) => run.resource)).toEqual(["categories", "products"]);

    const categories = await owner.client.get<{
      items: Array<{ name: string; parentName: string | null; productCount: number }>;
    }>(`/api/organizations/current/stores/${owner.storeId}/catalog/categories`);
    expect(categories.status).toBe(200);
    const phones = categories.body.data!.items.find((item) => item.name === "جوالات");
    expect(phones?.parentName).toBe("إلكترونيات");

    const products = await owner.client.get<{
      items: Array<{ name: string; sku: string; categories: Array<{ name: string }> }>;
      total: number;
    }>(`/api/organizations/current/stores/${owner.storeId}/catalog/products`);
    expect(products.body.data?.total).toBe(3);

    const charger = products.body.data!.items.find((item) => item.name === "شاحن");
    expect(charger?.categories).toEqual([]);
    const headset = products.body.data!.items.find((item) => item.name === "سماعة");
    expect(headset?.categories.map((category) => category.name).sort()).toEqual([
      "إلكترونيات",
      "سماعات",
    ]);

    const audit = await owner.client.get<{
      entries: Array<{ action: string; metadata: Record<string, unknown> }>;
    }>("/api/organizations/current/audit");

    const actions = audit.body.data?.entries.map((entry) => entry.action) ?? [];
    expect(actions).toContain("salla.categories.sync_started");
    expect(actions).toContain("salla.categories.sync_completed");
    expect(actions).toContain("salla.products.sync_started");
    expect(actions).toContain("salla.products.sync_completed");
    expect(JSON.stringify(audit.body.data)).not.toContain("mock-access");
  });

  it("is idempotent: a second run creates nothing and duplicates nothing", async () => {
    const owner = await ownerWithStore("catalog-idempotent@example.com");
    await connect(owner);
    seedCatalog();

    await syncViaApi(owner);
    const second = await syncViaApi(owner);

    expect(second.status).toBe(200);
    const productRun = second.body.data!.runs.find((run) => run.resource === "products")!;
    expect(productRun.created).toBe(0);
    expect(productRun.updated).toBe(3);
    expect(productRun.items).toBe(3);

    const db = getTestDb();
    const rows = await withTenantTransaction(db, { organizationId: owner.organizationId }, (tx) =>
      tx.select().from(products).where(eq(products.storeId, owner.storeId)),
    );
    expect(rows).toHaveLength(3);
  });

  it("walks pages sequentially and stops at the last page", async () => {
    const owner = await ownerWithStore("catalog-pages@example.com");
    await connect(owner);
    mock.products = Array.from({ length: 65 }, (_, index) => ({
      id: 2000 + index,
      name: `منتج ${index}`,
      status: "sale",
      price: { amount: 10 + index, currency: "SAR" },
      categories: [],
    }));

    const response = await syncViaApi(owner, "products");
    expect(response.status).toBe(200);
    expect(response.body.data!.runs[0]!.pages).toBe(3);
    expect(response.body.data!.runs[0]!.items).toBe(65);
    expect(mock.cataloguePages("products")).toEqual([1, 2, 3]);
  });

  it("updates a changed product in place", async () => {
    const owner = await ownerWithStore("catalog-update@example.com");
    await connect(owner);
    seedCatalog();
    await syncViaApi(owner, "products");

    mock.products[0] = {
      ...mock.products[0]!,
      name: "هاتف محدّث",
      price: { amount: 1, currency: "SAR" },
    };
    await syncViaApi(owner, "products");

    const list = await owner.client.get<{ items: Array<{ name: string }> }>(
      `/api/organizations/current/stores/${owner.storeId}/catalog/products`,
    );
    expect(list.body.data!.items.map((item) => item.name)).toContain("هاتف محدّث");
    expect(list.body.data!.items).toHaveLength(3);
  });

  it("removes a category link that Salla no longer reports", async () => {
    const owner = await ownerWithStore("catalog-relink@example.com");
    await connect(owner);
    seedCatalog();
    await syncViaApi(owner, "all");

    mock.products[1] = { ...mock.products[1]!, categories: [] };
    await syncViaApi(owner, "products");

    const db = getTestDb();
    const links = await withTenantTransaction(db, { organizationId: owner.organizationId }, (tx) =>
      tx.select().from(productCategories).where(eq(productCategories.storeId, owner.storeId)),
    );
    expect(links).toHaveLength(1);
  });

  it("never deletes a product that disappears from the listing", async () => {
    const owner = await ownerWithStore("catalog-nodelete@example.com");
    await connect(owner);
    seedCatalog();
    await syncViaApi(owner, "products");

    mock.products = mock.products.slice(0, 2);
    await syncViaApi(owner, "products");

    const list = await owner.client.get<{ total: number }>(
      `/api/organizations/current/stores/${owner.storeId}/catalog/products`,
    );
    expect(list.body.data?.total).toBe(3);
  });

  it("isolates products between tenants and stores", async () => {
    const owner = await ownerWithStore("catalog-tenant-a@example.com");
    await connect(owner);
    seedCatalog();
    await syncViaApi(owner, "all");

    const outsider = await ownerWithStore("catalog-tenant-b@example.com");
    await connect(outsider, outsider.storeId);

    const foreign = await outsider.client.get(
      `/api/organizations/current/stores/${owner.storeId}/catalog/products`,
    );
    expect(foreign.status).toBe(404);

    const foreignSync = await outsider.client.post(
      `/api/organizations/current/stores/${owner.storeId}/catalog/sync`,
      { resource: "products" },
    );
    expect(foreignSync.status).toBe(404);

    const secondStore = await createSecondStore(owner);
    const empty = await owner.client.get<{ total: number }>(
      `/api/organizations/current/stores/${secondStore}/catalog/products`,
    );
    expect(empty.body.data?.total).toBe(0);
  });

  it("refuses a viewer and allows a manager", async () => {
    const owner = await ownerWithStore("catalog-roles@example.com");
    await connect(owner);
    seedCatalog();

    const viewer = await inviteAndAccept(owner, "viewer-catalog@example.com", "viewer");
    const viewerSync = await viewer.client.post(
      `/api/organizations/current/stores/${owner.storeId}/catalog/sync`,
      { resource: "products" },
    );
    expect(viewerSync.status).toBe(403);

    const manager = await inviteAndAccept(owner, "manager-catalog@example.com", "manager");
    const managerSync = await manager.client.post(
      `/api/organizations/current/stores/${owner.storeId}/catalog/sync`,
      { resource: "products" },
    );
    expect(managerSync.status).toBe(200);
  });

  it("keeps one catalogue lane per store across resources", async () => {
    const owner = await ownerWithStore("catalog-lane@example.com");
    await connect(owner);
    seedCatalog();
    mock.behaviour.catalogDelayMs = 300;

    const db = getTestDb();
    const context = contextFor(owner);

    const first = syncStore(db, context, { storeId: owner.storeId, resource: "categories" }, META);
    for (let i = 0; i < 100 && mock.catalogRequestCount("categories") === 0; i += 1) {
      await new Promise((resolve) => setTimeout(resolve, 10));
    }

    await expect(
      syncStore(db, context, { storeId: owner.storeId, resource: "products" }, META),
    ).rejects.toMatchObject({
      code: "CONFLICT",
      details: { reason: "sync_in_progress" },
    });

    await first;
  });

  it("rejects an unsupported sync resource with a 422 error envelope", async () => {
    const owner = await ownerWithStore("catalog-invalid@example.com");
    await connect(owner);

    const result = await owner.client.post(
      `/api/organizations/current/stores/${owner.storeId}/catalog/sync`,
      { resource: "orders" },
    );

    expect(result.status).toBe(422);
    expect(result.body).not.toHaveProperty("data");
    expect(
      (result.body as unknown as { error: { code: string; message: string } }).error,
    ).toMatchObject({ code: "VALIDATION_FAILED" });
  });

  it("runs exactly one sync for ten concurrent requests", async () => {
    const owner = await ownerWithStore("catalog-concurrent@example.com");
    await connect(owner);
    seedCatalog();
    mock.behaviour.catalogDelayMs = 250;

    const db = getTestDb();
    const context = contextFor(owner);

    const results = await Promise.all(
      Array.from({ length: 10 }, () =>
        syncStore(db, context, { storeId: owner.storeId, resource: "products" }, META)
          .then(() => "ok" as const)
          .catch((error: { code?: string; details?: { reason?: string } }) => ({
            code: error.code,
            reason: error.details?.reason,
          })),
      ),
    );

    const successes = results.filter((result) => result === "ok").length;
    const conflicts = results.filter(
      (result) => typeof result === "object" && result.code === "CONFLICT",
    ).length;

    expect(successes).toBe(1);
    expect(conflicts).toBe(9);
    expect(mock.cataloguePages("products")).toEqual([1]);
  });

  it("waits for Retry-After on 429 and then succeeds", async () => {
    const owner = await ownerWithStore("catalog-429@example.com");
    await connect(owner);
    seedCatalog();
    mock.behaviour.catalogFailureStatus = 429;
    mock.behaviour.catalogRetryAfter = 2;
    mock.behaviour.catalogFailuresRemaining = 1;

    const sleeps: number[] = [];
    const db = getTestDb();

    const result = await syncStore(
      db,
      contextFor(owner),
      { storeId: owner.storeId, resource: "products" },
      META,
      { sleep: async (ms) => void sleeps.push(ms) },
    );

    expect(result.runs[0]!.status).toBe("succeeded");
    expect(sleeps).toEqual([2000]);
    expect(mock.catalogRequestCount("products")).toBe(2);
  });

  it("stops after the retry budget on persistent 5xx", async () => {
    const owner = await ownerWithStore("catalog-500@example.com");
    await connect(owner);
    seedCatalog();
    mock.behaviour.catalogStatus = 500;
    mock.behaviour.catalogFailuresRemaining = 99;

    const response = await syncViaApi(owner, "products");
    expect(response.status).toBe(502);
    expect(mock.catalogRequestCount("products")).toBe(3);

    const connection = await owner.client.get<{ connection: { status: string } }>(
      `/api/organizations/current/stores/${owner.storeId}/salla/connection`,
    );
    expect(connection.body.data?.connection.status).toBe("connected");
  });

  it("fails the run on a malformed payload without storing corrupt rows", async () => {
    const owner = await ownerWithStore("catalog-malformed@example.com");
    await connect(owner);
    seedCatalog();
    mock.behaviour.catalogMalformed = true;

    const response = await syncViaApi(owner, "products");
    expect(response.status).toBe(502);

    const list = await owner.client.get<{ total: number }>(
      `/api/organizations/current/stores/${owner.storeId}/catalog/products`,
    );
    expect(list.body.data?.total).toBe(0);

    const status = await owner.client.get<{
      sync: { products: { status: string; lastRun: { errorCode: string } | null } };
    }>(`/api/organizations/current/stores/${owner.storeId}/catalog/sync`);
    expect(status.body.data?.sync.products.status).toBe("failed");
    expect(status.body.data?.sync.products.lastRun?.errorCode).toBe("invalid_response");
  });

  it("fails the run when the provider repeats a page", async () => {
    const owner = await ownerWithStore("catalog-loop@example.com");
    await connect(owner);
    mock.products = Array.from({ length: 65 }, (_, index) => ({
      id: 3000 + index,
      name: `منتج ${index}`,
      status: "sale",
      categories: [],
    }));
    mock.behaviour.catalogRepeatPage = true;

    const response = await syncViaApi(owner, "products");
    expect(response.status).toBe(502);
    expect(mock.cataloguePages("products")).toEqual([1, 2]);
  });

  it("requires catalog scopes and asks for a reconnect", async () => {
    const owner = await ownerWithStore("catalog-scope@example.com");
    await connect(owner);

    const db = getTestDb();
    await withTenantTransaction(db, { organizationId: owner.organizationId }, (tx) =>
      tx
        .update(storeConnections)
        .set({ scopes: ["offline_access"] })
        .where(eq(storeConnections.storeId, owner.storeId)),
    );

    const response = await syncViaApi(owner, "products");
    expect(response.status).toBe(409);
    expect(response.body.error?.code).toBe("INTEGRATION_AUTH_REQUIRED");
    expect(mock.catalogRequestCount("products")).toBe(0);
  });

  it("marks the connection for reauthorization when refresh fails", async () => {
    const owner = await ownerWithStore("catalog-reauth@example.com");
    await connect(owner);
    seedCatalog();

    mock.invalidateAccessTokens();
    mock.behaviour.rejectRefresh = true;

    const response = await syncViaApi(owner, "products");
    expect(response.status).toBe(409);
    expect(response.body.error?.code).toBe("INTEGRATION_AUTH_REQUIRED");

    const connection = await owner.client.get<{
      connection: { status: string; accessTokenExpiresAt: string | null };
    }>(`/api/organizations/current/stores/${owner.storeId}/salla/connection`);

    expect(connection.body.data?.connection.status).toBe("reauth_required");
  });

  it("refuses to sync a disconnected store", async () => {
    const owner = await ownerWithStore("catalog-disconnected@example.com");
    await connect(owner);

    await owner.client.delete(
      `/api/organizations/current/stores/${owner.storeId}/salla/connection`,
    );

    const response = await syncViaApi(owner, "products");
    expect(response.status).toBe(409);
    expect(response.body.error?.code).toBe("INTEGRATION_NOT_CONNECTED");
  });

  it("keeps committed pages when a later page fails", async () => {
    const owner = await ownerWithStore("catalog-partial@example.com");
    await connect(owner);
    mock.products = Array.from({ length: 65 }, (_, index) => ({
      id: 4000 + index,
      name: `منتج ${index}`,
      status: "sale",
      categories: [],
    }));

    // Page 1 succeeds; every request from the second one fails.
    mock.behaviour.catalogStatus = 500;
    mock.behaviour.catalogFailFrom = 2;

    const response = await syncViaApi(owner, "products");
    expect(response.status).toBe(502);

    const list = await owner.client.get<{ total: number }>(
      `/api/organizations/current/stores/${owner.storeId}/catalog/products`,
    );
    expect(list.body.data?.total).toBe(30);

    // A clean retry is safe: the first page is an upsert, not a duplicate.
    mock.behaviour.catalogFailFrom = null;
    mock.behaviour.catalogStatus = null;
    const retry = await syncViaApi(owner, "products");
    expect(retry.status).toBe(200);

    const after = await owner.client.get<{ total: number }>(
      `/api/organizations/current/stores/${owner.storeId}/catalog/products`,
    );
    expect(after.body.data?.total).toBe(65);
  });

  it("records sync state that survives a failed run", async () => {
    const owner = await ownerWithStore("catalog-state@example.com");
    await connect(owner);
    seedCatalog();

    await syncViaApi(owner, "products");
    const before = await owner.client.get<{
      sync: { products: { status: string; lastSuccessAt: string | null } };
    }>(`/api/organizations/current/stores/${owner.storeId}/catalog/sync`);

    expect(before.body.data?.sync.products.status).toBe("succeeded");
    const successAt = before.body.data!.sync.products.lastSuccessAt;
    expect(successAt).not.toBeNull();

    mock.behaviour.catalogStatus = 500;
    mock.behaviour.catalogFailuresRemaining = 99;
    await syncViaApi(owner, "products");

    const after = await owner.client.get<{
      sync: {
        products: { status: string; lastSuccessAt: string | null; lastErrorCode: string | null };
      };
    }>(`/api/organizations/current/stores/${owner.storeId}/catalog/sync`);

    expect(after.body.data?.sync.products.status).toBe("failed");
    expect(after.body.data?.sync.products.lastSuccessAt).toBe(successAt);
    expect(after.body.data?.sync.products.lastErrorCode).toBe("provider_error");
  });

  it("applies row-level security so another tenant sees no rows", async () => {
    const owner = await ownerWithStore("catalog-rls-a@example.com");
    await connect(owner);
    seedCatalog();
    await syncViaApi(owner, "all");

    const outsider = await ownerWithStore("catalog-rls-b@example.com");
    const db = getTestDb();

    const visible = await withTenantTransaction(
      db,
      { organizationId: outsider.organizationId },
      (tx) => tx.select().from(products),
    );

    expect(visible).toHaveLength(0);
  });

  it("uses the store status when no connection exists", async () => {
    const owner = await ownerWithStore("catalog-noconnection@example.com");
    const db = getTestDb();

    const store = await withTenantTransaction(db, { organizationId: owner.organizationId }, (tx) =>
      tx
        .select({ status: stores.status })
        .from(stores)
        .where(and(eq(stores.id, owner.storeId), eq(stores.organizationId, owner.organizationId))),
    );

    expect(store[0]?.status).toBe("not_connected");
  });
});
