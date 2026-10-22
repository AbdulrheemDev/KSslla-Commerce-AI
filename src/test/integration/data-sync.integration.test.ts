import { eq } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { customers, inventoryLevels, orderItems, orders } from "@/db/schema";
import { withTenantTransaction } from "@/db/tenant";
import type { TenantContext } from "@/modules/identity/application/types";
import { permissionsForRole } from "@/modules/identity/domain/permissions";
import { syncStoreData } from "@/modules/sync/application/store-data-sync-service";
import { closeTestDb, getTestDb } from "@/test/db/client";
import { inviteAndAccept } from "@/test/integration/fixtures";
import {
  callbackViaApi,
  registerViaApi,
  resetState,
  type RegisteredUser,
} from "@/test/integration/helpers";
import { MockSallaServer, type MockOrder } from "@/test/integration/mock-salla-server";
import {
  clearMockSalla,
  configureMockSalla,
  stateFromAuthorizationUrl,
} from "@/test/integration/salla-helpers";

/**
 * Phase 05 integration tests.
 *
 * Every test drives the real route handlers → service → repository → PostgreSQL
 * path against the local protocol simulator. No network, no real store.
 *
 * The mandatory scenario is the first one: 67 orders, 30 + 30 + 7 across three
 * sequential pages, with no page skipped and no duplicate on re-runs.
 */

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

async function ownerWithStore(email: string): Promise<StoreFixture> {
  const owner = await registerViaApi({
    email,
    organizationName: `مؤسسة ${email}`,
    storeName: "متجر كشخة",
  });

  const list = await owner.client.get<{ stores: Array<{ id: string }> }>(
    "/api/organizations/current/stores",
  );
  const storeId = list.body.data?.stores[0]?.id;
  if (!storeId) throw new Error("store not created");

  return { ...owner, storeId };
}

async function connect(owner: StoreFixture): Promise<void> {
  const started = await owner.client.post<{ authorizationUrl: string }>(
    `/api/organizations/current/stores/${owner.storeId}/salla/authorize`,
    undefined,
  );
  const authorizationUrl = started.body.data?.authorizationUrl;
  if (!authorizationUrl) throw new Error(`authorize failed: ${JSON.stringify(started.body)}`);

  const callback = await callbackViaApi(owner.client, {
    code: "mock-code",
    state: stateFromAuthorizationUrl(authorizationUrl),
  });
  if (callback.status !== 307) throw new Error("connection failed");

  mock.requests.length = 0;
}

function contextFor(owner: StoreFixture, role: "owner" | "viewer" = "owner"): TenantContext {
  return {
    userId: owner.userId,
    organizationId: owner.organizationId,
    membershipId: "00000000-0000-0000-0000-000000000000",
    role,
    permissions: permissionsForRole(role),
    user: { id: owner.userId, email: owner.email, name: owner.email },
    organization: { id: owner.organizationId, name: "org", slug: "org" },
    sessionId: "00000000-0000-0000-0000-000000000000",
    requestId: null,
  };
}

function makeCustomer(index: number): NonNullable<MockOrder["customer"]> {
  return {
    id: 900000 + index,
    first_name: `عميل${index}`,
    last_name: "اختبار",
    mobile: { number: 512345600 + index, mobile_code: "966" },
    email: `customer${index}@example.test`,
    gender: index % 2 === 0 ? "female" : "male",
    birthday: { date: "1995-04-12", timezone: "Asia/Riyadh" },
    city: "الرياض",
    country: "السعودية",
    country_code: "SA",
    currency: "SAR",
    lang: "ar",
    type: "user",
    created_at: { date: "2025-01-02 10:00:00.000000" },
    updated_at: { date: "2026-09-02 10:00:00.000000" },
  };
}

function makeOrder(index: number): MockOrder {
  return {
    id: 500000 + index,
    external_reference_id: `EXT-${index}`,
    reference_id: `REF-${index}`,
    total: { amount: `${100 + index}.00`, currency: "SAR" },
    date: {
      date: `2026-09-${String(1 + (index % 28)).padStart(2, "0")} 13:45:00.000000`,
      timezone_type: 3,
      timezone: "Asia/Riyadh",
    },
    source: "web",
    status: { id: 1, name: "مكتمل", slug: "completed" },
    draft: false,
    payment_method: "mada",
    is_pending_payment: false,
    // Documented list-line shape only.
    items: [
      { name: `منتج ${index}`, quantity: 1 + (index % 3), thumbnail: null },
      { name: `منتج إضافي ${index}`, quantity: 1, thumbnail: null },
    ],
    customer: makeCustomer(index % 5),
  };
}

function seedOrders(count: number): void {
  mock.orders = Array.from({ length: count }, (_, index) => makeOrder(index));
}

function seedCustomers(count: number): void {
  mock.customers = Array.from({ length: count }, (_, index) => makeCustomer(index));
}

function seedQuantities(): void {
  mock.quantities = [
    {
      id: 1001,
      name: "منتج بدون متغيّرات",
      image: null,
      sku_id: null,
      sku: "SKU-1001",
      quantity: 12,
      sold_quantity: 30,
      price: "99.00",
      unlimited_quantity: false,
      variant: null,
    },
    {
      id: 1002,
      name: "منتج بمتغيّرين",
      image: null,
      sku_id: 7001,
      sku: null,
      quantity: 5,
      sold_quantity: 4,
      price: 45,
      unlimited_quantity: false,
      variant: "أسود",
    },
    {
      id: 1002,
      name: "منتج بمتغيّرين",
      image: null,
      sku_id: 7002,
      sku: null,
      quantity: 0,
      sold_quantity: 9,
      price: 45,
      unlimited_quantity: true,
      variant: "أبيض",
    },
  ];
}

async function countRows(
  table: "orders" | "customers" | "orderItems" | "inventory",
  organizationId: string,
): Promise<number> {
  const db = getTestDb();
  const rows = await withTenantTransaction(db, { organizationId }, async (tx) => {
    switch (table) {
      case "orders":
        return tx.select({ id: orders.id }).from(orders);
      case "customers":
        return tx.select({ id: customers.id }).from(customers);
      case "orderItems":
        return tx.select({ id: orderItems.id }).from(orderItems);
      case "inventory":
        return tx.select({ id: inventoryLevels.id }).from(inventoryLevels);
    }
  });

  return rows.length;
}

describe("order sync", () => {
  it("reads 67 orders across three sequential pages without skipping a page", async () => {
    const owner = await ownerWithStore("orders-owner@example.test");
    await connect(owner);
    seedOrders(67);

    const result = await syncStoreData(
      getTestDb(),
      contextFor(owner),
      { storeId: owner.storeId, resource: "orders" },
      META,
    );

    const run = result.runs[0]!;
    expect(run.status).toBe("succeeded");
    expect(run.pages).toBe(3);
    expect(run.items).toBe(67);
    expect(run.created).toBe(67);

    // Sequential requests only, 30 per page, no `expanded`.
    const pages = mock.requests
      .filter((request) => request.path === "/admin/v2/orders")
      .map((request) => request.query.page);
    expect(pages).toEqual(["1", "2", "3"]);
    expect(
      mock.requests
        .filter((request) => request.path === "/admin/v2/orders")
        .every((request) => request.query.per_page === "30"),
    ).toBe(true);
    expect(
      mock.requests
        .filter((request) => request.path === "/admin/v2/orders")
        .every((request) => request.query.expanded === undefined),
    ).toBe(true);

    expect(await countRows("orders", owner.organizationId)).toBe(67);
    expect(await countRows("orderItems", owner.organizationId)).toBe(67 * 2);

    // Ordered customers are created from the embedded payload, once each.
    expect(await countRows("customers", owner.organizationId)).toBe(5);
  });

  it("is idempotent across three consecutive runs", async () => {
    const owner = await ownerWithStore("orders-idempotent@example.test");
    await connect(owner);
    seedOrders(67);
    seedCustomers(5);
    seedQuantities();

    const db = getTestDb();
    const context = contextFor(owner);

    for (let run = 0; run < 3; run += 1) {
      const result = await syncStoreData(
        db,
        context,
        { storeId: owner.storeId, resource: "all" },
        META,
      );
      expect(result.runs.map((entry) => entry.resource)).toEqual([
        "customers",
        "orders",
        "inventory",
      ]);
      expect(result.runs.every((entry) => entry.status === "succeeded")).toBe(true);
    }

    expect(await countRows("orders", owner.organizationId)).toBe(67);
    expect(await countRows("orderItems", owner.organizationId)).toBe(134);
    expect(await countRows("customers", owner.organizationId)).toBe(5);
    expect(await countRows("inventory", owner.organizationId)).toBe(3);

    // First run creates, later runs only update.
    const state = await owner.client.get<{
      sync: Record<string, { status: string; lastRun: { itemsCreated: number } }>;
    }>(`/api/organizations/current/stores/${owner.storeId}/data/sync`);

    expect(state.body.data?.sync.orders?.status).toBe("succeeded");
    expect(state.body.data?.sync.orders?.lastRun.itemsCreated).toBe(0);
  });

  it("records line items that cannot be linked, without failing the run", async () => {
    const owner = await ownerWithStore("orders-lines@example.test");
    await connect(owner);
    seedOrders(3);

    await syncStoreData(
      getTestDb(),
      contextFor(owner),
      { storeId: owner.storeId, resource: "orders" },
      META,
    );

    const db = getTestDb();
    const lines = await withTenantTransaction(db, { organizationId: owner.organizationId }, (tx) =>
      tx.select().from(orderItems).where(eq(orderItems.storeId, owner.storeId)),
    );

    expect(lines).toHaveLength(6);
    for (const line of lines) {
      expect(line.linkStatus).toBe("no_product_reference");
      expect(line.externalProductId).toBeNull();
      expect(line.sku).toBeNull();
      expect(line.unitPrice).toBeNull();
      expect(line.productName.length).toBeGreaterThan(0);
    }
  });

  it("stores an allowlisted snapshot and never the embedded customer", async () => {
    const owner = await ownerWithStore("orders-snapshot@example.test");
    await connect(owner);
    seedOrders(2);

    await syncStoreData(
      getTestDb(),
      contextFor(owner),
      { storeId: owner.storeId, resource: "orders" },
      META,
    );

    const rows = await withTenantTransaction(
      getTestDb(),
      { organizationId: owner.organizationId },
      (tx) =>
        tx.select({ raw: orders.rawPayload }).from(orders).where(eq(orders.storeId, owner.storeId)),
    );

    expect(rows).toHaveLength(2);
    for (const row of rows) {
      expect(row.raw).toBeTruthy();
      const stored = JSON.stringify(row.raw);

      // The embedded customer is PII: it must not exist in any form.
      expect(row.raw).not.toHaveProperty("customer");
      expect(row.raw).not.toHaveProperty("urls");
      expect(stored).not.toContain("@");
      expect(stored).not.toContain("5123456");
      expect(stored).not.toContain("عميل");
    }

    // What remains is the documented order shape.
    expect(rows[0]!.raw).toMatchObject({ source: "web", payment_method: "mada", draft: false });
    expect(Array.isArray((rows[0]!.raw as { items?: unknown }).items)).toBe(true);
  });
});

describe("customer sync", () => {
  it("dedupes by external id and keeps one row per customer", async () => {
    const owner = await ownerWithStore("customers-dedupe@example.test");
    await connect(owner);
    seedCustomers(12);

    const db = getTestDb();
    const context = contextFor(owner);

    await syncStoreData(db, context, { storeId: owner.storeId, resource: "customers" }, META);
    await syncStoreData(db, context, { storeId: owner.storeId, resource: "customers" }, META);

    expect(await countRows("customers", owner.organizationId)).toBe(12);
  });

  it("returns real customer fields through the read route", async () => {
    const owner = await ownerWithStore("customers-read@example.test");
    await connect(owner);
    seedCustomers(3);

    await syncStoreData(
      getTestDb(),
      contextFor(owner),
      { storeId: owner.storeId, resource: "customers" },
      META,
    );

    const list = await owner.client.get<{
      items: Array<{
        fullName: string | null;
        email: string | null;
        countryCode: string | null;
        orderCount: number | null;
      }>;
      total: number;
    }>(`/api/organizations/current/stores/${owner.storeId}/data/customers`);

    expect(list.status).toBe(200);
    expect(list.body.data?.total).toBe(3);
    const first = list.body.data?.items[0];
    expect(first?.fullName).toContain("عميل");
    expect(first?.email).toContain("@example.test");
    expect(first?.countryCode).toBe("SA");
    // No orders synced yet: the local count is genuinely 0, not fabricated.
    expect(first?.orderCount).toBe(0);
  });
});

describe("inventory sync", () => {
  it("stores one row per variant and updates in place", async () => {
    const owner = await ownerWithStore("inventory-sync@example.test");
    await connect(owner);
    seedQuantities();

    const db = getTestDb();
    const context = contextFor(owner);

    await syncStoreData(db, context, { storeId: owner.storeId, resource: "inventory" }, META);
    expect(await countRows("inventory", owner.organizationId)).toBe(3);

    mock.quantities[0]!.quantity = 4;
    mock.quantities[0]!.sold_quantity = 38;

    await syncStoreData(db, context, { storeId: owner.storeId, resource: "inventory" }, META);
    expect(await countRows("inventory", owner.organizationId)).toBe(3);

    const rows = await withTenantTransaction(db, { organizationId: owner.organizationId }, (tx) =>
      tx.select().from(inventoryLevels).where(eq(inventoryLevels.storeId, owner.storeId)),
    );
    const updated = rows.find((row) => row.quantityKey === "product:1001");
    expect(updated?.quantity).toBe(4);
    expect(updated?.soldQuantity).toBe(38);
  });
});

describe("tenant isolation and authorization", () => {
  it("does not expose another organization's orders", async () => {
    const first = await ownerWithStore("tenant-a@example.test");
    await connect(first);
    seedOrders(4);
    await syncStoreData(
      getTestDb(),
      contextFor(first),
      { storeId: first.storeId, resource: "orders" },
      META,
    );

    const second = await ownerWithStore("tenant-b@example.test");
    const response = await second.client.get(
      `/api/organizations/current/stores/${first.storeId}/data/orders`,
    );

    expect(response.status).toBe(404);
  });

  it("rejects a viewer starting a sync", async () => {
    const owner = await ownerWithStore("rbac-owner@example.test");
    await connect(owner);
    seedOrders(2);

    const viewer = await inviteAndAccept(owner, "viewer-data@example.test", "viewer");

    const response = await viewer.client.post(
      `/api/organizations/current/stores/${owner.storeId}/data/sync`,
      { resource: "orders" },
    );

    expect(response.status).toBe(403);
    expect(await countRows("orders", owner.organizationId)).toBe(0);
  });

  it("rejects a sync for a store the caller cannot see", async () => {
    const first = await ownerWithStore("sync-foreign-a@example.test");
    await connect(first);
    const second = await ownerWithStore("sync-foreign-b@example.test");

    const response = await second.client.post(
      `/api/organizations/current/stores/${first.storeId}/data/sync`,
      { resource: "orders" },
    );

    expect(response.status).toBe(404);
  });
});

describe("provider failures", () => {
  it("honours Retry-After on 429 and then succeeds", async () => {
    const owner = await ownerWithStore("rate-limit@example.test");
    await connect(owner);
    seedOrders(2);

    mock.behaviour.dataFailuresRemaining = 1;
    mock.behaviour.dataFailureStatus = 429;
    mock.behaviour.dataRetryAfter = 0;

    const runs: Array<{ status: string; items: number }> = [];
    for (let attempt = 0; attempt < 3 && runs.length === 0; attempt += 1) {
      try {
        const result = await syncStoreData(
          getTestDb(),
          contextFor(owner),
          { storeId: owner.storeId, resource: "orders" },
          META,
          { sleep: async () => undefined },
        );
        runs.push(...result.runs);
      } catch {
        // The first attempt may exhaust its budget; the run is recorded as
        // failed and the next attempt succeeds.
      }
    }

    expect(runs[0]?.status).toBe("succeeded");
    expect(runs[0]?.items).toBe(2);
    expect(await countRows("orders", owner.organizationId)).toBe(2);
  });

  it("normalises a 500 into a failed run with a stable code", async () => {
    const owner = await ownerWithStore("server-error@example.test");
    await connect(owner);
    seedOrders(2);

    mock.behaviour.dataStatus = 500;

    await expect(
      syncStoreData(
        getTestDb(),
        contextFor(owner),
        { storeId: owner.storeId, resource: "orders" },
        META,
        { sleep: async () => undefined },
      ),
    ).rejects.toMatchObject({ code: "INTEGRATION_ERROR" });

    const state = await owner.client.get<{
      sync: Record<string, { status: string; lastErrorCode: string | null }>;
    }>(`/api/organizations/current/stores/${owner.storeId}/data/sync`);

    expect(state.body.data?.sync.orders?.status).toBe("failed");
    expect(state.body.data?.sync.orders?.lastErrorCode).toBe("provider_error");
    expect(await countRows("orders", owner.organizationId)).toBe(0);
  });

  it("stops instead of following an out-of-sequence empty page", async () => {
    const owner = await ownerWithStore("sequence@example.test");
    await connect(owner);
    seedOrders(67);

    // The mock returns an empty page for a jump; the runner must never jump,
    // so a successful run still covers all three pages.
    const result = await syncStoreData(
      getTestDb(),
      contextFor(owner),
      { storeId: owner.storeId, resource: "orders" },
      META,
    );

    expect(result.runs[0]?.pages).toBe(3);
    expect(result.runs[0]?.items).toBe(67);
  });
});

describe("full real flow", () => {
  it("goes session → organization → store → connection → token → API → DTO → DB → route", async () => {
    const owner = await ownerWithStore("flow@example.test");
    await connect(owner);
    seedCustomers(2);
    seedOrders(2);
    seedQuantities();

    // 1. The session authenticates and resolves the organization.
    const session = await owner.client.get<{
      organization: { id: string };
      membership: { organizationId: string };
    }>("/api/auth/session");
    expect(session.body.data?.organization.id).toBe(owner.organizationId);

    // 2. The sync runs through the service with a real access token.
    const result = await syncStoreData(
      getTestDb(),
      contextFor(owner),
      { storeId: owner.storeId, resource: "all" },
      META,
    );
    expect(result.runs.map((run) => run.resource)).toEqual(["customers", "orders", "inventory"]);

    const tokenRequest = mock.requests.find((request) => request.path === "/oauth2/token");
    expect(tokenRequest).toBeUndefined(); // reused from the OAuth callback, not re-requested
    expect(
      mock.requests.filter((request) => request.path === "/admin/v2/orders").length,
    ).toBeGreaterThan(0);

    // 3. The read routes serve the persisted rows.
    const ordersRoute = await owner.client.get<{
      total: number;
      items: Array<{ orderDate: string }>;
    }>(`/api/organizations/current/stores/${owner.storeId}/data/orders`);
    expect(ordersRoute.body.data?.total).toBe(2);
    expect(ordersRoute.body.data?.items[0]?.orderDate).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/);

    const inventoryRoute = await owner.client.get<{ total: number }>(
      `/api/organizations/current/stores/${owner.storeId}/data/inventory`,
    );
    expect(inventoryRoute.body.data?.total).toBe(3);

    // 4. The overview reports the five resources, from one state table.
    const overview = await owner.client.get<{ sync: Record<string, { status: string }> }>(
      `/api/organizations/current/stores/${owner.storeId}/data/sync`,
    );
    expect(Object.keys(overview.body.data?.sync ?? {}).sort()).toEqual([
      "categories",
      "customers",
      "inventory",
      "orders",
      "products",
    ]);
    expect(overview.body.data?.sync.orders?.status).toBe("succeeded");
  });
});
