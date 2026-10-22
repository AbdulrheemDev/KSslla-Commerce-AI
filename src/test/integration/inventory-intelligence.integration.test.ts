import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";

import type { Metric } from "@/modules/intelligence/domain/types";
import { MEMBERSHIP_ROLES, permissionsForRole } from "@/modules/identity/domain/permissions";
import { getInventoryOverview } from "@/modules/inventory-intelligence/application/inventory-intelligence-service";
import { closeTestDb, getTestDb } from "@/test/db/client";
import { inviteAndAccept } from "@/test/integration/fixtures";
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

/**
 * Inventory intelligence against a real PostgreSQL instance and the Salla
 * simulator.
 *
 * Inventory reaches the database through the **real sync path** (OAuth →
 * catalogue sync → inventory sync → mappers → repositories), so a fixture cannot
 * encode a row shape the provider would never write. Every endpoint is then read
 * through the real HTTP stack, which means these assertions also cover the tenant
 * chain: 401 without a session, 404 for a foreign store, viewer read-only.
 *
 * The last describe block is a regression guard with teeth: it walks the whole
 * JSON payload and fails if any forecast metric carries a number.
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

const LONG_DESCRIPTION =
  "هاتف ذكي بشاشة عالية الدقة وبطارية تدوم يومًا كاملًا، مع كاميرا خلفية مزدوجة وذاكرة داخلية " +
  "تكفي للاستخدام اليومي. يأتي مع شاحن سريع وكابل USB-C وضمان سنة من الوكيل المعتمد.";

/**
 * Five catalogued products and five quantity entries:
 *
 * | product | quantity | expected |
 * |---|---|---|
 * | 1001 | 6 + 1 (two variants) | in stock, 7 units |
 * | 1002 | 0 | out of stock |
 * | 1003 | 3 | low stock |
 * | 1004 | — (no row) | unknown, coverage 80% |
 * | 1006 | 80 | in stock + high quantity |
 * | 1005 | 40, unlimited | unlinked entry |
 */
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
      id: 12,
      name: "سماعات",
      parent_id: 0,
      status: "hidden",
      sort_order: 2,
      update_at: "2024-01-03 10:00:00",
    },
  ];

  mock.products = [
    {
      id: 1001,
      name: "هاتف ذكي",
      sku: "SKU-1",
      type: "product",
      status: "sale",
      description: LONG_DESCRIPTION,
      url: "https://example.test/p/1001",
      main_image: "https://cdn.example.test/p/1001.jpg",
      price: { amount: 999, currency: "SAR" },
      quantity: 7,
      is_available: true,
      updated_at: "2026-10-20 09:00:00",
      categories: [{ id: 10 }],
      metadata: { title: "هاتف ذكي", description: "هاتف ذكي بكاميرا مزدوجة." },
    },
    {
      id: 1002,
      name: "سماعة",
      sku: "SKU-2",
      type: "product",
      status: "sale",
      price: { amount: 149.5, currency: "SAR" },
      quantity: 0,
      is_available: false,
      updated_at: "2024-02-02 09:00:00",
      categories: [{ id: 12 }],
    },
    {
      id: 1003,
      name: "شاحن",
      sku: "SKU-3",
      type: "product",
      status: "sale",
      price: { amount: 59, currency: "SAR" },
      quantity: 3,
      is_available: true,
      updated_at: "2024-02-03 09:00:00",
      categories: [],
    },
    {
      id: 1004,
      name: "حافظة",
      sku: "SKU-4",
      type: "product",
      status: "sale",
      price: { amount: 39, currency: "SAR" },
      quantity: 10,
      is_available: true,
      updated_at: "2024-02-04 09:00:00",
      categories: [{ id: 10 }],
    },
    {
      id: 1006,
      name: "لوحة مفاتيح",
      sku: "SKU-6",
      type: "product",
      status: "sale",
      price: { amount: 199, currency: "SAR" },
      quantity: 80,
      is_available: true,
      updated_at: "2024-02-06 09:00:00",
      categories: [{ id: 10 }],
    },
  ];

  mock.quantities = [
    {
      id: 1001,
      name: "هاتف ذكي",
      sku_id: null,
      sku: "SKU-1",
      quantity: 6,
      sold_quantity: 30,
      price: "999.00",
      unlimited_quantity: false,
      variant: null,
    },
    {
      id: 1001,
      name: "هاتف ذكي",
      sku_id: 9001,
      sku: null,
      quantity: 1,
      sold_quantity: 4,
      price: "999.00",
      unlimited_quantity: false,
      variant: "أسود",
    },
    {
      id: 1002,
      name: "سماعة",
      sku_id: null,
      sku: "SKU-2",
      quantity: 0,
      sold_quantity: 90,
      price: "149.50",
      unlimited_quantity: false,
      variant: null,
    },
    {
      id: 1003,
      name: "شاحن",
      sku_id: null,
      sku: "SKU-3",
      quantity: 3,
      sold_quantity: 12,
      price: 59,
      unlimited_quantity: false,
      variant: null,
    },
    {
      id: 1006,
      name: "لوحة مفاتيح",
      sku_id: null,
      sku: "SKU-6",
      quantity: 80,
      sold_quantity: 2,
      price: "199.00",
      unlimited_quantity: false,
      variant: null,
    },
    {
      id: 1005,
      name: "منتج غير موجود في الكتالوج",
      sku_id: null,
      sku: "SKU-5",
      quantity: 40,
      sold_quantity: 0,
      price: "10.00",
      unlimited_quantity: true,
      variant: null,
    },
  ];
}

async function syncCatalog(owner: StoreFixture): Promise<void> {
  const catalog = await owner.client.post(
    `/api/organizations/current/stores/${owner.storeId}/catalog/sync`,
    { resource: "all" },
  );
  if (catalog.status !== 200)
    throw new Error(`catalogue sync failed: ${JSON.stringify(catalog.body)}`);
}

async function syncInventory(owner: StoreFixture): Promise<void> {
  const data = await owner.client.post(
    `/api/organizations/current/stores/${owner.storeId}/data/sync`,
    { resource: "inventory" },
  );
  if (data.status !== 200) throw new Error(`inventory sync failed: ${JSON.stringify(data.body)}`);
}

async function seedAndSync(owner: StoreFixture): Promise<void> {
  await connect(owner);
  seedCatalog();
  await syncCatalog(owner);
  await syncInventory(owner);
}

function base(owner: StoreFixture): string {
  return `/api/organizations/current/stores/${owner.storeId}/inventory-intelligence`;
}

interface Envelope<T> {
  storeId: string;
  generatedAt: string;
  freshness: { syncedAt: string | null; resources: Array<{ resource: string; status: string }> };
  coverage: {
    status: "complete" | "partial" | "empty";
    productsTracked: number;
    productsTotal: number;
    coveragePercent: Metric<number>;
    inventoryEntries: number;
    unlinkedEntries: number;
    notes: string[];
  };
  confidence: { level: string };
  data: T;
}

interface OverviewMetrics {
  productsTotal: Metric<number>;
  productsTracked: Metric<number>;
  inventoryCoveragePercent: Metric<number>;
  inStock: Metric<number>;
  lowStock: Metric<number>;
  outOfStock: Metric<number>;
  unlimited: Metric<number>;
  unknownStock: Metric<number>;
  highStockQuantity: Metric<number>;
  totalUnits: Metric<number>;
  negativeQuantity: Metric<number>;
  healthScore: Metric<number>;
  daysOfStock: Metric<number>;
  deadStock: Metric<number>;
  reorderQuantity: Metric<number>;
}

interface OverviewData {
  overview: OverviewMetrics;
  counts: {
    productsTotal: number;
    productsTracked: number;
    inStock: number;
    lowStock: number;
    outOfStock: number;
    unlimited: number;
    unknown: number;
    highStockQuantity: number;
    totalUnits: number;
    negativeQuantity: number;
    inventoryEntries: number;
    unlinkedEntries: number;
  };
  issues: Array<{
    id: string;
    severity: string;
    score: number;
    affectedCount: number;
    affectedPercent: number;
    population: string;
    rule: string;
    evidence: string[];
  }>;
  topRecommendations: Array<{
    id: string;
    issueId: string;
    advisoryOnly: true;
    rule: string;
    affectedCount: number;
    evidence: string[];
  }>;
  definitions: Record<string, string>;
  thresholds: Record<string, number | Record<string, number>>;
  thresholdLabels: Record<string, string>;
  unavailableByDesign: Array<{ metric: string; reason: string }>;
}

interface ProductRow {
  id: string;
  name: string;
  status: string;
  stock: Metric<number>;
  unlimited: boolean | null;
  entries: number;
  variants: string[];
  cumulativeSoldQuantity: Metric<number>;
  demand: { dailyDemand: Metric<number> };
  daysOfStock: Metric<number>;
  stockoutRisk: string;
  stockoutRiskReason: string | null;
  highStockQuantity: boolean;
  deadStock: Metric<boolean>;
  excessInventory: Metric<number>;
  reorderQuantity: Metric<number>;
  reorderMissingInputs: string[];
  severity: string | null;
  issues: string[];
}

interface ProductData {
  items: ProductRow[];
  page: number;
  pageCount: number;
  total: number;
  query: string;
  filter: string;
}

interface CategoryRow {
  id: string;
  name: string;
  productCount: number;
  trackedCount: number;
  unknownCount: number;
  inStock: number;
  lowStock: number;
  outOfStock: number;
  unlimited: number;
  highStockQuantity: number;
  coveragePercent: Metric<number>;
  demandRate: Metric<number>;
}

describe("inventory intelligence — snapshot", () => {
  it("reports stock, coverage, and issues from the mirrored rows", async () => {
    const owner = await ownerWithStore("inv-overview@example.com");
    await seedAndSync(owner);

    const response = await owner.client.get<Envelope<OverviewData>>(`${base(owner)}/overview`);
    expect(response.status).toBe(200);

    const body = response.body.data!;

    // 4 of 5 products have a row, and one entry is unlinked: partial, with both
    // reasons named.
    expect(body.coverage.status).toBe("partial");
    expect(body.coverage.productsTotal).toBe(5);
    expect(body.coverage.productsTracked).toBe(4);
    expect(body.coverage.coveragePercent.value).toBe(80);
    expect(body.coverage.inventoryEntries).toBe(6);
    expect(body.coverage.unlinkedEntries).toBe(1);
    expect(body.coverage.notes).toContain("products_without_inventory_record");
    expect(body.coverage.notes).toContain("inventory_entries_unlinked");

    expect(body.data.counts).toMatchObject({
      productsTotal: 5,
      productsTracked: 4,
      inStock: 2,
      lowStock: 1,
      outOfStock: 1,
      unknown: 1,
      highStockQuantity: 1,
      unlinkedEntries: 1,
    });

    // Variant rows are summed: 6 + 1 = 7, not 6 and not 1.
    expect(body.data.overview.totalUnits.value).toBe(7 + 3 + 80);

    // The four forecast metrics never carry a value.
    for (const metric of [
      body.data.overview.daysOfStock,
      body.data.overview.deadStock,
      body.data.overview.reorderQuantity,
    ]) {
      expect(metric).toMatchObject({ value: null, availability: "unavailable" });
      expect(metric.reason).toBeTruthy();
    }

    expect(body.data.unavailableByDesign.map((item) => item.metric)).toEqual(
      expect.arrayContaining([
        "inventory.daysOfStock",
        "inventory.stockoutPrediction",
        "inventory.deadStock",
        "inventory.reorderQuantity",
      ]),
    );

    expect(body.data.definitions).toHaveProperty("daysOfStock");
    expect(body.data.thresholds).toMatchObject({ LOW_STOCK_UNITS: 5, HIGH_STOCK_UNITS: 50 });
    expect(Object.keys(body.data.thresholdLabels).length).toBeGreaterThan(0);

    expect(body.data.issues.map((issue) => issue.id)).toEqual([
      "out_of_stock",
      "low_stock",
      "missing_inventory_record",
      "inventory_entry_unlinked",
    ]);
  });

  it("says the store was never synced instead of showing zeros", async () => {
    const owner = await ownerWithStore("inv-empty@example.com");

    const response = await owner.client.get<Envelope<OverviewData>>(`${base(owner)}/overview`);
    expect(response.status).toBe(200);

    const body = response.body.data!;

    expect(body.coverage.status).toBe("empty");
    expect(body.coverage.coveragePercent.value).toBeNull();
    expect(body.coverage.notes).toContain("inventory_not_synced");
    expect(body.confidence.level).toBe("low");

    expect(body.data.overview.productsTotal).toMatchObject({
      availability: "unavailable",
      reason: "no_products_stored",
      value: null,
    });
    expect(body.data.overview.outOfStock).toMatchObject({
      availability: "unavailable",
      reason: "inventory_not_synced",
      value: null,
    });
    expect(body.data.overview.healthScore.value).toBeNull();
    expect(body.data.issues).toEqual([]);
    expect(body.data.topRecommendations).toEqual([]);
  });

  it("keeps every product unknown when the catalogue synced but inventory never did", async () => {
    const owner = await ownerWithStore("inv-no-inventory@example.com");
    await connect(owner);
    seedCatalog();
    await syncCatalog(owner);

    const response = await owner.client.get<Envelope<OverviewData>>(`${base(owner)}/overview`);
    expect(response.status).toBe(200);

    const body = response.body.data!;

    expect(body.coverage.status).toBe("empty");
    expect(body.data.counts.productsTotal).toBe(5);
    expect(body.data.counts.unknown).toBe(5);
    expect(body.data.counts.outOfStock).toBe(0);
    expect(body.data.overview.outOfStock).toMatchObject({
      availability: "unavailable",
      reason: "inventory_not_synced",
    });
    expect(body.data.overview.unknownStock.value).toBe(5);
    expect(body.data.issues.map((issue) => issue.id)).toEqual(["missing_inventory_record"]);
  });

  it("marks unlimited stock correctly even when the mirror holds zero", async () => {
    const owner = await ownerWithStore("inv-unlimited@example.com");
    await connect(owner);
    seedCatalog();
    await syncCatalog(owner);

    // A documented provider quirk: unlimited products can report quantity 0.
    mock.quantities = [
      {
        id: 1001,
        name: "هاتف ذكي",
        sku_id: null,
        sku: "SKU-1",
        quantity: 0,
        sold_quantity: 5,
        price: "999.00",
        unlimited_quantity: true,
        variant: null,
      },
    ];
    await syncInventory(owner);

    const response = await owner.client.get<Envelope<ProductData>>(`${base(owner)}/products`);
    expect(response.status).toBe(200);

    const phone = response.body.data!.data.items.find((item) => item.name === "هاتف ذكي");
    expect(phone?.status).toBe("unlimited");
    expect(phone?.unlimited).toBe(true);
    expect(phone?.issues).toEqual([]);
    expect(phone?.daysOfStock.reason).toBe("product_demand_not_linked");
  });

  it("paginates, searches, and filters deterministically", async () => {
    const owner = await ownerWithStore("inv-paging@example.com");
    await seedAndSync(owner);

    const first = await owner.client.get<Envelope<ProductData>>(
      `${base(owner)}/products?page=1&pageSize=2`,
    );
    expect(first.status).toBe(200);
    expect(first.body.data!.data).toMatchObject({ page: 1, pageCount: 3, total: 5, pageSize: 2 });

    const outOfStock = await owner.client.get<Envelope<ProductData>>(
      `${base(owner)}/products?filter=out_of_stock`,
    );
    expect(outOfStock.body.data!.data.items.map((item) => item.name)).toEqual(["سماعة"]);
    expect(outOfStock.body.data!.data.total).toBe(1);

    const low = await owner.client.get<Envelope<ProductData>>(
      `${base(owner)}/products?filter=low_stock`,
    );
    expect(low.body.data!.data.items.map((item) => item.name)).toEqual(["شاحن"]);

    const unknown = await owner.client.get<Envelope<ProductData>>(
      `${base(owner)}/products?filter=unknown`,
    );
    expect(unknown.body.data!.data.items.map((item) => item.name)).toEqual(["حافظة"]);

    const high = await owner.client.get<Envelope<ProductData>>(
      `${base(owner)}/products?filter=high_quantity`,
    );
    expect(high.body.data!.data.items.map((item) => item.name)).toEqual(["لوحة مفاتيح"]);

    const search = await owner.client.get<Envelope<ProductData>>(`${base(owner)}/products?q=SKU-3`);
    expect(search.body.data!.data.items.map((item) => item.name)).toEqual(["شاحن"]);

    // Page 99 clamps to the last page rather than returning an empty page.
    const last = await owner.client.get<Envelope<ProductData>>(
      `${base(owner)}/products?page=99&pageSize=2`,
    );
    expect(last.body.data!.data.page).toBe(3);
    expect(last.body.data!.data.items).toHaveLength(1);
  });

  it("aggregates categories from their products, never from sales", async () => {
    const owner = await ownerWithStore("inv-categories@example.com");
    await seedAndSync(owner);

    const response = await owner.client.get<Envelope<{ items: CategoryRow[] }>>(
      `${base(owner)}/categories`,
    );
    expect(response.status).toBe(200);

    const items = response.body.data!.data.items;
    const electronics = items.find((item) => item.name === "إلكترونيات");

    expect(electronics).toMatchObject({
      productCount: 3,
      trackedCount: 2,
      unknownCount: 1,
      // 1001 at 7 units and 1006 at 80 are both in stock; only 1006 crosses the
      // high-quantity threshold.
      inStock: 2,
      lowStock: 0,
      outOfStock: 0,
      highStockQuantity: 1,
    });
    // 2 tracked of 3 catalogued → 66.7, never rounded up to 100.
    expect(electronics?.coveragePercent.value).toBe(66.7);
    expect(electronics?.demandRate).toMatchObject({
      value: null,
      availability: "unavailable",
      reason: "product_demand_not_linked",
    });

    const headphones = items.find((item) => item.name === "سماعات");
    expect(headphones).toMatchObject({ productCount: 1, outOfStock: 1, trackedCount: 1 });
    expect(headphones?.coveragePercent.value).toBe(100);
  });

  it("returns advisory recommendations tied to the issues", async () => {
    const owner = await ownerWithStore("inv-recommendations@example.com");
    await seedAndSync(owner);

    const response = await owner.client.get<
      Envelope<{ items: OverviewData["topRecommendations"]; total: number; advisoryOnly: true }>
    >(`${base(owner)}/recommendations`);
    expect(response.status).toBe(200);

    const body = response.body.data!.data;
    expect(body.advisoryOnly).toBe(true);
    expect(body.total).toBe(4);
    for (const item of body.items) {
      expect(item.advisoryOnly).toBe(true);
      expect(item.rule.length).toBeGreaterThan(0);
      expect(item.affectedCount).toBeGreaterThan(0);
    }
    expect(body.items.map((item) => item.issueId)).toContain("out_of_stock");
  });

  it("keeps every endpoint on one snapshot for the same request", async () => {
    const owner = await ownerWithStore("inv-consistency@example.com");
    await seedAndSync(owner);

    const overview = await owner.client.get<Envelope<OverviewData>>(`${base(owner)}/overview`);
    const issues = await owner.client.get<Envelope<{ items: OverviewData["issues"] }>>(
      `${base(owner)}/issues`,
    );
    const products = await owner.client.get<Envelope<ProductData>>(
      `${base(owner)}/products?pageSize=100`,
    );

    const overviewData = overview.body.data!;
    const issuesData = issues.body.data!;
    const productsData = products.body.data!;

    expect(issuesData.data.items.map((issue) => issue.id)).toEqual(
      overviewData.data.issues.map((issue) => issue.id),
    );
    expect(productsData.data.total).toBe(overviewData.data.counts.productsTotal);
    expect(productsData.coverage.productsTracked).toBe(overviewData.coverage.productsTracked);
    expect(productsData.coverage.coveragePercent.value).toBe(
      overviewData.coverage.coveragePercent.value,
    );
  });
});

describe("inventory intelligence — access control", () => {
  it("rejects an anonymous request with 401", async () => {
    const anonymous = new ApiClient();
    const response = await anonymous.get(
      "/api/organizations/current/stores/x/inventory-intelligence/overview",
    );

    expect(response.status).toBe(401);
  });

  it("returns 404 for a store of another organization", async () => {
    const owner = await ownerWithStore("inv-tenant-a@example.com");
    const stranger = await ownerWithStore("inv-tenant-b@example.com");
    await seedAndSync(owner);

    const response = await stranger.client.get<Envelope<OverviewData>>(`${base(owner)}/overview`);

    expect(response.status).toBe(404);
    // The stranger's own store is empty and untouched.
    const own = await stranger.client.get<Envelope<OverviewData>>(`${base(stranger)}/overview`);
    expect(own.status).toBe(200);
    expect(own.body.data!.coverage.productsTotal).toBe(0);
  });

  it("lets a viewer read and keeps identity fields out of the payload", async () => {
    const owner = await ownerWithStore("inv-viewer-owner@example.com");
    await seedAndSync(owner);

    const viewer = await inviteAndAccept(owner, "inv-viewer@example.com", "viewer");
    expect(permissionsForRole("viewer")).toContain("store:read");

    for (const endpoint of ["overview", "products", "categories", "issues", "recommendations"]) {
      const response = await viewer.client.get(`${base(owner)}/${endpoint}`);
      expect(response.status).toBe(200);

      const serialised = JSON.stringify(response.body);
      expect(serialised).not.toContain("@example.com");
      expect(serialised).not.toContain("mock-access");
      expect(serialised).not.toContain("first_name");
      expect(serialised).not.toContain("mobile");
    }
  });

  it("exposes no write handler on any route", async () => {
    const routes = await Promise.all([
      import("@/app/api/organizations/current/stores/[storeId]/inventory-intelligence/overview/route"),
      import("@/app/api/organizations/current/stores/[storeId]/inventory-intelligence/products/route"),
      import("@/app/api/organizations/current/stores/[storeId]/inventory-intelligence/categories/route"),
      import("@/app/api/organizations/current/stores/[storeId]/inventory-intelligence/issues/route"),
      import("@/app/api/organizations/current/stores/[storeId]/inventory-intelligence/recommendations/route"),
    ]);

    for (const handlers of routes) {
      const record = handlers as Record<string, unknown>;
      expect(typeof record.GET).toBe("function");
      for (const method of ["POST", "PUT", "PATCH", "DELETE"]) {
        expect(record[method]).toBeUndefined();
      }
    }
  });

  it("validates paging and filter parameters with 422", async () => {
    const owner = await ownerWithStore("inv-validation@example.com");

    for (const query of [
      "page=0",
      "page=abc",
      "pageSize=0",
      "pageSize=101",
      "filter=nope",
      `q=${"x".repeat(121)}`,
    ]) {
      const response = await owner.client.get(`${base(owner)}/products?${query}`);
      expect(response.status, query).toBe(422);
    }
  });

  it("runs through the tenant transaction and rejects a cross-organization context", async () => {
    const owner = await ownerWithStore("inv-rls@example.com");
    await seedAndSync(owner);

    const context = {
      userId: owner.userId,
      organizationId: owner.organizationId,
      membershipId: "00000000-0000-0000-0000-000000000000",
      role: "owner",
      permissions: permissionsForRole("owner"),
      user: { id: owner.userId, email: owner.email, name: "مستخدم" },
      organization: { id: owner.organizationId, name: "مؤسسة", slug: "org" },
      sessionId: "00000000-0000-0000-0000-000000000000",
      requestId: null,
    } satisfies Parameters<typeof getInventoryOverview>[1];

    const result = await getInventoryOverview(getTestDb(), context, owner.storeId);
    expect(result.coverage.productsTotal).toBe(5);

    // A forged organization id cannot read another organization's store.
    await expect(
      getInventoryOverview(
        getTestDb(),
        { ...context, organizationId: "00000000-0000-0000-0000-000000000001" },
        owner.storeId,
      ),
    ).rejects.toMatchObject({ code: "TENANT_ISOLATION_VIOLATION" });
  });

  it("holds store:read for every membership role, which is the real gate", async () => {
    for (const role of MEMBERSHIP_ROLES) {
      expect(permissionsForRole(role)).toContain("store:read");
    }
  });
});

/**
 * The regression that this phase exists for: a number must never appear where the
 * evidence does not.
 *
 * Rather than checking three named fields, the test walks the entire payload of
 * every endpoint and inspects every object that looks like a metric. Any
 * forecast-shaped metric carrying a numeric value fails the suite.
 */
describe("inventory intelligence — no forecast without evidence", () => {
  const FORECAST_KEYS = new Set([
    "daysOfStock",
    "deadStock",
    "reorderQuantity",
    "excessInventory",
    "demandRate",
    "dailyDemand",
  ]);

  interface MetricLike {
    value?: unknown;
    availability?: string;
    reason?: string | null;
  }

  function isMetricLike(value: unknown): value is MetricLike {
    return (
      typeof value === "object" && value !== null && "availability" in value && "value" in value
    );
  }

  function walk(
    node: unknown,
    path: string,
    violations: string[],
    seen = new Set<unknown>(),
  ): void {
    if (node === null || typeof node !== "object") return;
    if (seen.has(node)) return;
    seen.add(node);

    if (Array.isArray(node)) {
      node.forEach((entry, index) => walk(entry, `${path}[${index}]`, violations, seen));
      return;
    }

    const record = node as Record<string, unknown>;
    const key = path.split(".").pop() ?? "";

    if (FORECAST_KEYS.has(key) && isMetricLike(record)) {
      if (record.value !== null || record.availability !== "unavailable" || !record.reason) {
        violations.push(`${path} → ${JSON.stringify(record)}`);
      }
    }

    for (const [childKey, child] of Object.entries(record)) {
      walk(child, path ? `${path}.${childKey}` : childKey, violations, seen);
    }
  }

  it("carries no numeric forecast value on any endpoint", async () => {
    const owner = await ownerWithStore("inv-forecast@example.com");
    await seedAndSync(owner);

    const endpoints = ["overview", "products", "categories", "issues", "recommendations"];

    for (const endpoint of endpoints) {
      const response = await owner.client.get(`${base(owner)}/${endpoint}?pageSize=100`);
      expect(response.status).toBe(200);

      const violations: string[] = [];
      walk(response.body.data, endpoint, violations);
      expect(violations, endpoint).toEqual([]);
    }
  });

  it("keeps every product risk unknown with a reason", async () => {
    const owner = await ownerWithStore("inv-risk@example.com");
    await seedAndSync(owner);

    const response = await owner.client.get<Envelope<ProductData>>(
      `${base(owner)}/products?pageSize=100`,
    );
    const items = response.body.data!.data.items;

    expect(items).toHaveLength(5);
    for (const item of items) {
      expect(item.stockoutRisk).toBe("unknown");
      // A product with a row is blocked by demand; a product without one is
      // blocked earlier, by the missing record. Both are `unknown`, neither is a
      // number.
      expect(item.stockoutRiskReason).toBe(
        item.stock.availability === "available"
          ? "product_demand_not_linked"
          : "inventory_record_missing",
      );
      expect(item.daysOfStock.value).toBeNull();
      expect(item.deadStock.value).toBeNull();
      expect(item.excessInventory.value).toBeNull();
      expect(item.reorderQuantity.value).toBeNull();
      expect(item.reorderMissingInputs).toEqual([
        "product_demand_not_linked",
        "lead_time_not_configured",
        "safety_stock_not_configured",
      ]);
      // Cumulative sold quantity is exposed as-is and carries the period caveat.
      if (item.cumulativeSoldQuantity.availability === "available") {
        expect(item.cumulativeSoldQuantity.basis).toContain("cumulative");
      }
    }
  });

  it("never labels high quantity as dead stock, and says why it cannot", async () => {
    const owner = await ownerWithStore("inv-high@example.com");
    await seedAndSync(owner);

    const response = await owner.client.get<Envelope<ProductData>>(
      `${base(owner)}/products?filter=high_quantity`,
    );
    const item = response.body.data!.data.items[0]!;

    expect(item.highStockQuantity).toBe(true);
    expect(item.deadStock.availability).toBe("unavailable");
    expect(item.excessInventory.availability).toBe("unavailable");
    expect(item.issues).not.toContain("dead_stock");
    expect(item.issues).not.toContain("overstock");
  });
});
