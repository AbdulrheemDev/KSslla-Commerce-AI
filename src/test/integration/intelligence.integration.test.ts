import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { AppError } from "@/lib/errors";
import { getIntelligenceDashboard } from "@/modules/intelligence/application/intelligence-service";
import type { TenantContext } from "@/modules/identity/application/types";
import { permissionsForRole } from "@/modules/identity/domain/permissions";
import {
  ApiClient,
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
import { closeTestDb, getTestDb } from "@/test/db/client";

/**
 * Store intelligence on a real PostgreSQL with RLS.
 *
 * The store is populated through the real Salla sync against the local protocol
 * simulator — no row is inserted by hand, so the numbers under test are the ones
 * a real synchronization would produce.
 *
 * The suite proves four things: the metrics match the mirrored data, an empty or
 * partial store degrades to `unavailable`/`partial` instead of zeros, a foreign
 * store is a 404 for another organization, and no customer PII reaches a payload.
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

interface Envelope<T> {
  storeId: string;
  generatedAt: string;
  period: { key: string; from: string; to: string; days: number };
  coverage: {
    requestedFrom: string;
    requestedTo: string;
    firstOrderAt: string | null;
    lastOrderAt: string | null;
    status: "complete" | "partial" | "empty";
    notes: string[];
  };
  freshness: {
    syncedAt: string | null;
    resources: Array<{
      resource: string;
      status: string;
      lastSuccessAt: string | null;
      lastFailureAt: string | null;
      lastErrorCode: string | null;
      stale: boolean;
    }>;
    staleResources: string[];
  };
  data: T;
}

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
  if (!authorizationUrl) throw new Error("authorize failed");

  const callback = await callbackViaApi(owner.client, {
    code: "mock-code",
    state: stateFromAuthorizationUrl(authorizationUrl),
  });

  if (callback.status !== 307) throw new Error(`connection failed: ${callback.status}`);
  mock.requests.length = 0;
}

function seedCatalogue(): void {
  mock.categories = [
    { id: 10, name: "عطور", status: "active", sort_order: 1 },
    { id: 11, name: "هدايا", status: "active", sort_order: 2 },
  ];

  mock.products = [
    {
      id: 1001,
      name: "عطر الفخامة",
      sku: "SKU-1001",
      status: "sale",
      price: { amount: "250.00", currency: "SAR" },
      quantity: 40,
      is_available: true,
      updated_at: "2026-10-01 10:00:00",
      categories: [{ id: 10 }],
      main_image: "https://cdn.example.test/p1.jpg",
    },
    {
      id: 1002,
      name: "شمعة معطرة",
      sku: "SKU-1002",
      status: "sale",
      price: { amount: "90.00", currency: "SAR" },
      quantity: 3,
      is_available: true,
      updated_at: "2026-10-01 10:00:00",
      categories: [{ id: 10 }, { id: 11 }],
      main_image: "https://cdn.example.test/p2.jpg",
    },
    {
      id: 1003,
      name: "منتج بلا تصنيف",
      sku: "SKU-1003",
      status: "sale",
      price: { amount: "15.00", currency: "SAR" },
      quantity: 0,
      is_available: false,
      updated_at: "2026-10-01 10:00:00",
      categories: [],
    },
  ];

  mock.quantities = [
    {
      id: 1001,
      name: "عطر الفخامة",
      sku_id: null,
      sku: "SKU-1001",
      quantity: 40,
      sold_quantity: 30,
      price: "250.00",
      unlimited_quantity: false,
    },
    {
      id: 1002,
      name: "شمعة معطرة",
      sku_id: null,
      sku: "SKU-1002",
      quantity: 2,
      sold_quantity: 12,
      price: "90.00",
      unlimited_quantity: false,
    },
    {
      id: 1003,
      name: "منتج بلا تصنيف",
      sku_id: null,
      sku: "SKU-1003",
      quantity: 0,
      sold_quantity: 0,
      price: "15.00",
      unlimited_quantity: false,
    },
  ];
}

function customer(id: number) {
  return {
    id,
    first_name: "عميل",
    last_name: `${id}`,
    email: `customer${id}@example.test`,
    mobile: { number: 500000000 + id, mobile_code: "+966" },
    created_at: { date: "2026-10-05 10:00:00.000000" },
  };
}

function seedOrders(): void {
  const make = (
    index: number,
    status: { id: number; name: string; slug: string },
    amount: string,
    draft = false,
  ) => ({
    id: 700000 + index,
    external_reference_id: `EXT-${index}`,
    reference_id: `REF-${index}`,
    total: { amount, currency: "SAR" },
    date: {
      date: `2026-10-${String(10 + index).padStart(2, "0")} 12:00:00.000000`,
      timezone_type: 3,
      timezone: "Asia/Riyadh",
    },
    source: "web",
    status,
    draft,
    payment_method: "mada",
    is_pending_payment: false,
    items: [{ name: "بند", quantity: 1, thumbnail: null }],
    customer: customer(index),
  });

  mock.customers = [customer(1), customer(2), customer(3)];

  mock.orders = [
    make(1, { id: 1, name: "تم التنفيذ", slug: "completed" }, "100.00"),
    make(2, { id: 1, name: "تم التنفيذ", slug: "completed" }, "200.00"),
    make(3, { id: 1, name: "تم التنفيذ", slug: "completed" }, "300.00"),
    make(4, { id: 2, name: "ملغي", slug: "canceled" }, "50.00"),
    make(5, { id: 1, name: "تم التنفيذ", slug: "completed" }, "999.00", true),
  ];
}

async function syncStore(owner: StoreFixture): Promise<void> {
  const catalogue = await owner.client.post(
    `/api/organizations/current/stores/${owner.storeId}/catalog/sync`,
    { resource: "all" },
  );
  expect(catalogue.status).toBe(200);

  const data = await owner.client.post(
    `/api/organizations/current/stores/${owner.storeId}/data/sync`,
    { resource: "all" },
  );
  expect(data.status).toBe(200);
}

function contextFor(owner: StoreFixture): TenantContext {
  return {
    userId: owner.userId,
    organizationId: owner.organizationId,
    membershipId: "00000000-0000-0000-0000-000000000000",
    role: "owner",
    permissions: permissionsForRole("owner"),
    user: { id: owner.userId, email: owner.email, name: "مالك" },
    organization: { id: owner.organizationId, name: "مؤسسة", slug: "org" },
    sessionId: "00000000-0000-0000-0000-000000000000",
    requestId: null,
  };
}

describe("intelligence — computed from mirrored data", () => {
  it("reports the store's real sales, products, inventory, and opportunities", async () => {
    const owner = await ownerWithStore("intel-owner@example.test");
    await connect(owner);
    seedCatalogue();
    seedOrders();
    await syncStore(owner);

    const response = await owner.client.get<
      Envelope<{
        sales: {
          orders: { value: number | null; availability: string };
          completedOrders: { value: number | null };
          cancelledOrders: { value: number | null };
          totalOrderValue: { value: number | null; availability: string };
          averageOrderValue: { value: number | null };
          currency: { value: string | null };
          ordersGrowthPercent: { value: number | null; reason: string | null };
        };
        products: {
          total: number;
          outOfStock: number;
          lowStock: number;
          byClass: Record<string, number>;
        };
        inventory: { trackedProducts: number; outOfStock: number };
        health: { score: { value: number | null; availability: string }; grade: string | null };
        opportunities: { total: number; top: Array<{ id: string; type: string }> };
      }>
    >(`/api/organizations/current/stores/${owner.storeId}/intelligence/overview?period=30d`);

    expect(response.status).toBe(200);
    const envelope = response.body.data!;
    const data = envelope.data;

    expect(envelope.storeId).toBe(owner.storeId);
    expect(envelope.period.days).toBe(30);
    expect(envelope.coverage.status).toBe("partial");
    expect(envelope.coverage.notes).toContain("history_starts_after_window");

    // 5 mirrored orders, one of them a draft → 4 counted.
    expect(data.sales.orders.value).toBe(4);
    expect(data.sales.completedOrders.value).toBe(3);
    expect(data.sales.cancelledOrders.value).toBe(1);
    // 100 + 200 + 300; the canceled and draft orders are excluded from money.
    expect(data.sales.totalOrderValue.value).toBe(600);
    expect(data.sales.averageOrderValue.value).toBe(200);
    expect(data.sales.currency.value).toBe("SAR");
    // No previous-window history → growth is refused, not shown as 0.
    expect(data.sales.ordersGrowthPercent.reason).toBe("no_baseline_period");

    expect(data.products.total).toBe(3);
    expect(data.products.outOfStock).toBe(1);
    expect(data.products.lowStock).toBe(1);
    expect(data.products.byClass).toMatchObject({ star: 1, inventory_risk: 1 });
    expect(data.products.byClass.low_performer).toBe(1);

    expect(data.inventory.trackedProducts).toBe(3);
    expect(data.inventory.outOfStock).toBe(1);

    expect(data.health.score.value).not.toBeNull();
    expect(data.health.score.value!).toBeGreaterThan(0);

    expect(data.opportunities.total).toBeGreaterThanOrEqual(2);
  });

  it("classifies products and refuses product-level revenue", async () => {
    const owner = await ownerWithStore("intel-products@example.test");
    await connect(owner);
    seedCatalogue();
    seedOrders();
    await syncStore(owner);

    const response = await owner.client.get<
      Envelope<{
        summary: { total: number; missingCategory: number; missingImage: number };
        items: Array<{
          name: string;
          classification: string;
          revenue: { value: number | null; reason: string | null };
          velocity: { value: number | null };
          unitsSold: { value: number | null };
          stock: { value: number | null };
        }>;
        rankings: { top: Array<{ name: string; unitsSold: number }> };
      }>
    >(`/api/organizations/current/stores/${owner.storeId}/intelligence/products`);

    expect(response.status).toBe(200);
    const data = response.body.data!.data;

    expect(data.summary.total).toBe(3);
    expect(data.summary.missingCategory).toBe(1);
    expect(data.summary.missingImage).toBe(1);

    const perfume = data.items.find((item) => item.name === "عطر الفخامة")!;
    expect(perfume.classification).toBe("star");
    expect(perfume.unitsSold.value).toBe(30);
    expect(perfume.stock.value).toBe(40);
    expect(perfume.revenue.value).toBeNull();
    expect(perfume.revenue.reason).toBe("line_level_data_unavailable");
    expect(perfume.velocity.value).toBeNull();

    expect(data.rankings.top[0]?.name).toBe("عطر الفخامة");
    expect(data.rankings.top[0]?.unitsSold).toBe(30);
  });

  it("raises real opportunities with real evidence", async () => {
    const owner = await ownerWithStore("intel-opps@example.test");
    await connect(owner);
    seedCatalogue();
    seedOrders();
    await syncStore(owner);

    const response = await owner.client.get<
      Envelope<{
        items: Array<{
          type: string;
          severity: string;
          evidence: Array<{ label: string; value: string | number }>;
          recommendedAction: string;
          confidence: "high" | "medium" | "low";
        }>;
        total: number;
        countsByType: Record<string, number>;
      }>
    >(`/api/organizations/current/stores/${owner.storeId}/intelligence/opportunities`);

    expect(response.status).toBe(200);
    const data = response.body.data!.data;

    const types = data.items.map((item) => item.type);
    expect(types).toContain("out_of_stock");
    expect(types).toContain("high_sales_low_stock");

    for (const item of data.items) {
      expect(item.evidence.length).toBeGreaterThan(0);
      expect(item.recommendedAction.length).toBeGreaterThan(0);
      expect(["high", "medium", "low"]).toContain(item.confidence);
      expect(item.severity).toMatch(/^(low|medium|high)$/);
    }

    // Counts cover every raised item, including those beyond the page limit.
    const counted = Object.values(data.countsByType).reduce((sum, value) => sum + value, 0);
    expect(counted).toBe(data.total);
  });

  it("aggregates categories and marks the uncategorised product", async () => {
    const owner = await ownerWithStore("intel-categories@example.test");
    await connect(owner);
    seedCatalogue();
    seedOrders();
    await syncStore(owner);

    const response = await owner.client.get<
      Envelope<{
        totalCategories: number;
        uncategorisedProducts: number;
        items: Array<{ name: string; productCount: number; unitsSold: { value: number | null } }>;
      }>
    >(`/api/organizations/current/stores/${owner.storeId}/intelligence/categories`);

    expect(response.status).toBe(200);
    const data = response.body.data!.data;

    expect(data.totalCategories).toBe(2);
    expect(data.uncategorisedProducts).toBe(1);

    const perfumes = data.items.find((item) => item.name === "عطور")!;
    expect(perfumes.productCount).toBe(2);
    // Many-to-many: the candle counts in both categories, so the sum is 30 + 12.
    expect(perfumes.unitsSold.value).toBe(42);
  });

  it("reports customer aggregates without any customer identity", async () => {
    const owner = await ownerWithStore("intel-customers@example.test");
    await connect(owner);
    seedCatalogue();
    seedOrders();
    await syncStore(owner);

    const response = await owner.client.get<
      Envelope<{
        customers: { value: number | null };
        customersWithOrders: { value: number | null };
        customerRevenue: { value: number | null };
        repeatPurchaseRate: { value: number | null };
      }>
    >(`/api/organizations/current/stores/${owner.storeId}/intelligence/customers`);

    expect(response.status).toBe(200);
    const data = response.body.data!.data;

    // Three distinct customers bought, the canceled order's customer did not.
    expect(data.customersWithOrders.value).toBe(3);
    expect(data.customerRevenue.value).toBe(600);
    expect(data.repeatPurchaseRate.value).toBe(0);

    const serialised = JSON.stringify(response.body);
    expect(serialised).not.toContain("@example.test");
    expect(serialised).not.toContain("5000000");
    expect(serialised).not.toContain("first_name");
    expect(serialised).not.toContain("mobile");
  });
});

describe("intelligence — empty and partial stores", () => {
  it("reports unavailable metrics instead of zeros before the first sync", async () => {
    const owner = await ownerWithStore("intel-empty@example.test");
    await connect(owner);

    const response = await owner.client.get<
      Envelope<{
        sales: {
          orders: { value: number | null; availability: string; reason: string | null };
          totalOrderValue: { value: number | null; reason: string | null };
        };
        products: { total: number };
        health: { score: { value: number | null; reason: string | null }; grade: string | null };
        opportunities: { total: number };
      }>
    >(`/api/organizations/current/stores/${owner.storeId}/intelligence/overview`);

    expect(response.status).toBe(200);
    const envelope = response.body.data!;

    expect(envelope.coverage.status).toBe("empty");
    expect(envelope.coverage.notes).toContain("no_orders_stored");
    expect(envelope.data.sales.orders.value).toBeNull();
    expect(envelope.data.sales.orders.availability).toBe("unavailable");
    expect(envelope.data.sales.orders.reason).toBe("orders_not_synced");
    expect(envelope.data.sales.totalOrderValue.reason).toBe("orders_not_synced");
    expect(envelope.data.products.total).toBe(0);
    expect(envelope.data.health.score.value).toBeNull();
    expect(envelope.data.health.grade).toBeNull();
  });

  it("keeps the last good data but marks it partial after a failed sync", async () => {
    const owner = await ownerWithStore("intel-partial@example.test");
    await connect(owner);
    seedCatalogue();
    seedOrders();
    await syncStore(owner);

    // A later failed run must not erase the last good data, but it must show.
    mock.behaviour.dataStatus = 500;
    await owner.client.post(`/api/organizations/current/stores/${owner.storeId}/data/sync`, {
      resource: "orders",
    });

    const response = await owner.client.get<
      Envelope<{
        sales: { orders: { value: number | null; availability: string; reason: string | null } };
      }>
    >(`/api/organizations/current/stores/${owner.storeId}/intelligence/overview?period=30d`);

    expect(response.status).toBe(200);
    const envelope = response.body.data!;

    expect(envelope.coverage.notes).toContain("orders_sync_incomplete");
    expect(envelope.data.sales.orders.value).toBe(4);
    expect(envelope.data.sales.orders.availability).toBe("partial");
    expect(envelope.data.sales.orders.reason).toBe("orders_sync_incomplete");

    const orders = envelope.freshness.resources.find((item) => item.resource === "orders");
    expect(orders?.status).toBe("failed");
    expect(orders?.lastSuccessAt).not.toBeNull();
  });

  it("reports a truthful zero for a covered window with no orders", async () => {
    const owner = await ownerWithStore("intel-today@example.test");
    await connect(owner);
    seedCatalogue();
    // Orders exist only in the past; today's window is empty but not "zero error".
    seedOrders();
    await syncStore(owner);

    const response = await owner.client.get<
      Envelope<{
        sales: { orders: { value: number | null; availability: string } };
        coverage: { status: string };
      }>
    >(`/api/organizations/current/stores/${owner.storeId}/intelligence/overview?period=today`);

    expect(response.status).toBe(200);
    const envelope = response.body.data!;

    // The mirror covers the window (history starts before it), so "0 orders
    // today" is a fact — unlike an unsynced store, where the same number would
    // be a guess.
    expect(envelope.period.days).toBe(1);
    expect(envelope.coverage.status).toBe("complete");
    expect(envelope.data.sales.orders.value).toBe(0);
    expect(envelope.data.sales.orders.availability).toBe("available");
  });
});

describe("intelligence — security", () => {
  it("returns 404 for another organization's store (IDOR)", async () => {
    const ownerA = await ownerWithStore("intel-a@example.test");
    await connect(ownerA);
    seedCatalogue();
    seedOrders();
    await syncStore(ownerA);

    const ownerB = await ownerWithStore("intel-b@example.test");

    for (const endpoint of [
      "overview",
      "products",
      "categories",
      "inventory",
      "customers",
      "opportunities",
    ]) {
      const response = await ownerB.client.get(
        `/api/organizations/current/stores/${ownerA.storeId}/intelligence/${endpoint}`,
      );

      expect(response.status).toBe(404);
    }
  });

  it("returns 404 for an unknown store id", async () => {
    const owner = await ownerWithStore("intel-unknown@example.test");
    await connect(owner);

    const response = await owner.client.get(
      `/api/organizations/current/stores/00000000-0000-0000-0000-000000000000/intelligence/overview`,
    );

    expect(response.status).toBe(404);
  });

  it("rejects an unauthenticated request", async () => {
    const owner = await ownerWithStore("intel-anon@example.test");
    await connect(owner);

    // A fresh client holds no session cookie.
    const anonymous = new ApiClient();
    const response = await anonymous.get(
      `/api/organizations/current/stores/${owner.storeId}/intelligence/overview`,
    );

    expect(response.status).toBe(401);
  });

  it("rejects an unsupported or malformed period", async () => {
    const owner = await ownerWithStore("intel-period@example.test");
    await connect(owner);

    for (const query of [
      "period=1y",
      "period=custom",
      "period=custom&from=2026-10-05&to=2026-10-01",
      "period=custom&from=2026-02-31&to=2026-03-05",
    ]) {
      const response = await owner.client.get(
        `/api/organizations/current/stores/${owner.storeId}/intelligence/overview?${query}`,
      );

      expect(response.status).toBe(422);
    }
  });

  it("refuses another organization at the service layer too", async () => {
    const ownerA = await ownerWithStore("intel-service-a@example.test");
    await connect(ownerA);
    const ownerB = await ownerWithStore("intel-service-b@example.test");

    await expect(
      getIntelligenceDashboard(getTestDb(), contextFor(ownerB), ownerA.storeId, {
        period: "30d",
      }),
    ).rejects.toBeInstanceOf(AppError);
  });

  it("is a read model: two calls return the same numbers", async () => {
    const owner = await ownerWithStore("intel-readonly@example.test");
    await connect(owner);
    seedCatalogue();
    seedOrders();
    await syncStore(owner);

    const first = await owner.client.get<Envelope<{ sales: unknown; products: unknown }>>(
      `/api/organizations/current/stores/${owner.storeId}/intelligence/overview?period=30d`,
    );
    await owner.client.get(
      `/api/organizations/current/stores/${owner.storeId}/intelligence/opportunities`,
    );
    const second = await owner.client.get<Envelope<{ sales: unknown; products: unknown }>>(
      `/api/organizations/current/stores/${owner.storeId}/intelligence/overview?period=30d`,
    );

    expect(second.body.data?.data.sales).toEqual(first.body.data?.data.sales);
    expect(second.body.data?.data.products).toEqual(first.body.data?.data.products);
  });
});
