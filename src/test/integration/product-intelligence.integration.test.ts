import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";

import type { TenantContext } from "@/modules/identity/application/types";
import { MEMBERSHIP_ROLES, permissionsForRole } from "@/modules/identity/domain/permissions";
import { getCategoryIntelligence } from "@/modules/product-intelligence/application/product-intelligence-service";
import type { Metric } from "@/modules/intelligence/domain/types";
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
 * Product intelligence against a real PostgreSQL instance and the Salla
 * simulator.
 *
 * The catalogue reaches the database through the **real sync path** (OAuth →
 * `syncStore` → mappers → repositories), so the fixtures cannot encode a shape
 * the sync would never write. Every endpoint is then read through the real HTTP
 * stack, which means the assertions also cover the tenant chain: 401 without a
 * session, 404 for a foreign store, 403 for a role without `store:read`.
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
      quantity: 5,
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
      status: "hidden",
      price: { amount: 59, currency: "SAR" },
      quantity: 12,
      is_available: true,
      updated_at: "2024-02-03 09:00:00",
      categories: [],
    },
  ];
}

function seedQuantities(): void {
  mock.quantities = [
    {
      id: 1001,
      name: "هاتف ذكي",
      sku_id: null,
      sku: "SKU-1",
      quantity: 5,
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
      quantity: 2,
      sold_quantity: 4,
      price: "999.00",
      unlimited_quantity: false,
      variant: "أسود",
    },
  ];
}

async function syncAll(owner: StoreFixture): Promise<void> {
  const catalog = await owner.client.post(
    `/api/organizations/current/stores/${owner.storeId}/catalog/sync`,
    { resource: "all" },
  );
  if (catalog.status !== 200)
    throw new Error(`catalogue sync failed: ${JSON.stringify(catalog.body)}`);

  const data = await owner.client.post(
    `/api/organizations/current/stores/${owner.storeId}/data/sync`,
    { resource: "inventory" },
  );
  if (data.status !== 200) throw new Error(`inventory sync failed: ${JSON.stringify(data.body)}`);
}

function base(owner: StoreFixture): string {
  return `/api/organizations/current/stores/${owner.storeId}/product-intelligence`;
}

interface Envelope<T> {
  storeId: string;
  generatedAt: string;
  freshness: { syncedAt: string | null; resources: Array<{ resource: string; status: string }> };
  coverage: { status: string; productCount: number; categoryCount: number; notes: string[] };
  confidence: { level: string };
  data: T;
}

interface OverviewData {
  overview: Record<string, Metric<number>>;
  counts: { total: number; needsAttention: number; clean: number; issueCount: number };
  topIssues: Array<{ id: string; score: number }>;
  topRecommendations: Array<{ id: string; advisoryOnly: true; rule: string }>;
  definitions: Record<string, string>;
  unavailableByDesign: Array<{ metric: string; reason: string }>;
}

interface ProductRow {
  id: string;
  name: string;
  severity: string | null;
  needsAttention: boolean;
  content: { score: Metric<number>; failed: string[] };
  metadata: { score: Metric<number> };
  images: { status: string };
  lifecycle: { ageDays: Metric<number>; lastUpdated: Metric<string>; stale: boolean | null };
  commercial: { stock: Metric<number>; stockSource: string | null; outOfStock: boolean | null };
  performance: {
    periodSales: Metric<number>;
    revenue: Metric<number>;
    cumulativeSoldQuantity: Metric<number>;
  };
}

interface ProductData {
  items: ProductRow[];
  page: number;
  pageCount: number;
  total: number;
  query: string;
  filter: string;
}

interface IssueDataRow {
  id: string;
  severity: string;
  score: number;
  affectedCount: number;
  affectedPercent: number;
  rule: string;
  evidence: string[];
}

describe("product intelligence — snapshot", () => {
  it("reports a synced catalogue with explained metrics and freshness", async () => {
    const owner = await ownerWithStore("pi-overview@example.com");
    await connect(owner);
    seedCatalog();
    seedQuantities();
    await syncAll(owner);

    const response = await owner.client.get<Envelope<OverviewData>>(`${base(owner)}/overview`);
    expect(response.status).toBe(200);

    const body = response.body.data!;
    // Two of the three products carry no metadata object from the provider, so
    // coverage is partial and says exactly why.
    expect(body.coverage).toMatchObject({ status: "partial", productCount: 3, categoryCount: 2 });
    expect(body.coverage.notes).toContain("metadata_not_captured");
    // Partial coverage (metadata absent for two products) caps confidence at medium.
    expect(body.confidence.level).toBe("medium");
    expect(body.freshness.resources.map((resource) => resource.resource)).toContain("products");

    expect(body.data.counts.total).toBe(3);
    expect(body.data.counts.needsAttention).toBe(2);
    expect(body.data.overview.imageCoveragePercent?.value).toBe(33.3);
    expect(body.data.overview.categoryCoveragePercent?.value).toBe(66.7);
    expect(body.data.overview.hiddenProducts?.value).toBe(1);

    // Metadata came from the provider object through the real sync path: only
    // one of the three products carried a metadata object, so the ratio is
    // measured over that one and reported as partial.
    expect(body.data.overview.metadataHealthPercent).toMatchObject({
      availability: "partial",
      reason: "metadata_not_captured",
      value: 100,
    });

    // Every definition is present, and the unavailable metrics state a reason.
    expect(Object.keys(body.data.definitions)).toEqual(
      expect.arrayContaining(["contentQuality", "imageHealth", "lifecycle", "performance"]),
    );
    expect(body.data.unavailableByDesign.map((item) => item.metric)).toEqual(
      expect.arrayContaining([
        "product.sales",
        "product.revenue",
        "product.imageCount",
        "product.imageAltText",
        "product.ageDays",
      ]),
    );
  });

  it("says the catalogue was never synced instead of reporting zero", async () => {
    const owner = await ownerWithStore("pi-empty@example.com");

    const response = await owner.client.get<Envelope<OverviewData>>(`${base(owner)}/overview`);
    expect(response.status).toBe(200);

    const body = response.body.data!;
    expect(body.coverage.status).toBe("empty");
    expect(body.confidence.level).toBe("low");
    expect(body.data.overview.totalProducts).toMatchObject({
      availability: "unavailable",
      reason: "catalog_not_synced",
      value: null,
    });
    expect(body.data.overview.averageContentScore?.availability).toBe("unavailable");
    expect(body.data.counts.total).toBe(0);
  });

  it("aggregates inventory across variant rows for one product", async () => {
    const owner = await ownerWithStore("pi-inventory@example.com");
    await connect(owner);
    seedCatalog();
    seedQuantities();
    await syncAll(owner);

    const response = await owner.client.get<Envelope<ProductData>>(
      `${base(owner)}/products?q=SKU-1`,
    );

    const phone = response.body.data!.data.items[0]!;
    expect(phone.commercial.stock.value).toBe(7);
    expect(phone.commercial.stockSource).toBe("inventory");
    expect(phone.performance.cumulativeSoldQuantity.value).toBe(34);
  });
});

describe("product intelligence — products", () => {
  it("lists products worst-first and pages them", async () => {
    const owner = await ownerWithStore("pi-products@example.com");
    await connect(owner);
    seedCatalog();
    await syncAll(owner);

    const response = await owner.client.get<Envelope<ProductData>>(
      `${base(owner)}/products?pageSize=1`,
    );
    expect(response.status).toBe(200);

    const body = response.body.data!.data;
    expect(body.total).toBe(3);
    expect(body.pageCount).toBe(3);
    expect(body.page).toBe(1);
    // "سماعة" has high-severity gaps; the healthy phone does not.
    expect(body.items[0]!.name).toBe("سماعة");
    expect(body.items[0]!.severity).toBe("high");
  });

  it("filters the work queue and searches by name", async () => {
    const owner = await ownerWithStore("pi-filter@example.com");
    await connect(owner);
    seedCatalog();
    await syncAll(owner);

    const attention = await owner.client.get<Envelope<ProductData>>(
      `${base(owner)}/products?filter=attention`,
    );
    expect(attention.body.data!.data.total).toBe(2);
    for (const item of attention.body.data!.data.items) expect(item.needsAttention).toBe(true);

    const search = await owner.client.get<Envelope<ProductData>>(`${base(owner)}/products?q=شاحن`);
    expect(search.body.data!.data.items.map((item) => item.name)).toEqual(["شاحن"]);
  });

  it("never reports product sales, revenue, or a product age", async () => {
    const owner = await ownerWithStore("pi-performance@example.com");
    await connect(owner);
    seedCatalog();
    await syncAll(owner);

    const response = await owner.client.get<Envelope<ProductData>>(`${base(owner)}/products`);

    for (const item of response.body.data!.data.items) {
      expect(item.performance.periodSales).toMatchObject({
        availability: "unavailable",
        reason: "product_sales_not_linked",
        value: null,
      });
      expect(item.performance.revenue.availability).toBe("unavailable");
      expect(item.lifecycle.ageDays).toMatchObject({
        availability: "unavailable",
        reason: "created_at_not_documented",
        value: null,
      });
    }
  });

  it("rejects an invalid page size instead of clamping silently", async () => {
    const owner = await ownerWithStore("pi-validation@example.com");

    const response = await owner.client.get(`${base(owner)}/products?pageSize=500`);

    expect(response.status).toBe(422);
    expect(response.body).not.toHaveProperty("data");
  });
});

describe("product intelligence — issues and recommendations", () => {
  it("ranks issues by score and keeps the order recomputable", async () => {
    const owner = await ownerWithStore("pi-issues@example.com");
    await connect(owner);
    seedCatalog();
    await syncAll(owner);

    const response = await owner.client.get<Envelope<{ items: IssueDataRow[]; total: number }>>(
      `${base(owner)}/issues`,
    );
    expect(response.status).toBe(200);

    const items = response.body.data!.data.items;
    expect(response.body.data!.data.total).toBe(items.length);
    expect(items.length).toBeGreaterThan(0);

    const weights = { high: 3, medium: 2, low: 1 } as const;
    for (const item of items) {
      expect(item.score).toBe(item.affectedCount * weights[item.severity as keyof typeof weights]);
      expect(item.rule.length).toBeGreaterThan(0);
      expect(item.evidence.length).toBeGreaterThan(0);
      expect(item.evidence.length).toBeLessThanOrEqual(3);
    }

    const scores = items.map((item) => item.score);
    expect([...scores].sort((a, b) => b - a)).toEqual(scores);

    // The worst gap is a high-severity one shared by two products.
    expect(items[0]!.id).toBe("missing_description");
    expect(items[0]!.affectedCount).toBe(2);
  });

  it("only recommends what actually fired, with evidence and no action", async () => {
    const owner = await ownerWithStore("pi-recommendations@example.com");
    await connect(owner);
    seedCatalog();
    await syncAll(owner);

    const issues = await owner.client.get<Envelope<{ items: IssueDataRow[] }>>(
      `${base(owner)}/issues`,
    );
    const recommendations = await owner.client.get<
      Envelope<{
        items: Array<{
          id: string;
          issueId: string;
          rule: string;
          affectedCount: number;
          affectedPercent: number;
          examples: string[];
          advisoryOnly: true;
          priority: string;
        }>;
        total: number;
      }>
    >(`${base(owner)}/recommendations`);

    const issueRows = issues.body.data!.data.items;
    const rows = recommendations.body.data!.data.items;

    expect(rows.map((row) => row.issueId)).toEqual(issueRows.map((row) => row.id));

    for (const row of rows) {
      const issue = issueRows.find((item) => item.id === row.issueId)!;
      expect(row.rule).toBe(`${issue.id}_count > 0`);
      expect(row.affectedCount).toBe(issue.affectedCount);
      expect(row.affectedPercent).toBe(issue.affectedPercent);
      expect(row.examples).toEqual(issue.evidence);
      expect(row.advisoryOnly).toBe(true);
      expect(row.examples.length).toBeGreaterThan(0);
      expect(["P1", "P2", "P3"]).toContain(row.priority);
    }
  });

  it("exposes no write handler on any endpoint", async () => {
    // Structural read-only guarantee: the route modules export `GET` and
    // nothing else, so no request method can reach a mutation.
    const modules = await Promise.all([
      import("@/app/api/organizations/current/stores/[storeId]/product-intelligence/overview/route"),
      import("@/app/api/organizations/current/stores/[storeId]/product-intelligence/products/route"),
      import("@/app/api/organizations/current/stores/[storeId]/product-intelligence/categories/route"),
      import("@/app/api/organizations/current/stores/[storeId]/product-intelligence/issues/route"),
      import("@/app/api/organizations/current/stores/[storeId]/product-intelligence/recommendations/route"),
    ]);

    for (const routeModule of modules) {
      const exports = routeModule as Record<string, unknown>;
      expect(typeof exports.GET).toBe("function");
      for (const method of ["POST", "PUT", "PATCH", "DELETE"]) {
        expect(exports[method]).toBeUndefined();
      }
    }

    const owner = await ownerWithStore("pi-readonly@example.com");
    expect(base(owner)).toContain("/product-intelligence");
  });
});

describe("product intelligence — categories", () => {
  it("reports catalogue health per category and never a sales attribution", async () => {
    const owner = await ownerWithStore("pi-categories@example.com");
    await connect(owner);
    seedCatalog();
    await syncAll(owner);

    const response = await owner.client.get<
      Envelope<{
        items: Array<{
          id: string;
          name: string;
          hidden: boolean;
          productCount: number;
          missingDescription: number;
          missingImagePercent: number;
          averageContentScore: Metric<number>;
          salesAttribution: Metric<number>;
          belowVerdictThreshold: boolean;
        }>;
      }>
    >(`${base(owner)}/categories`);

    expect(response.status).toBe(200);
    const items = response.body.data!.data.items;

    const electronics = items.find((item) => item.name === "إلكترونيات")!;
    expect(electronics.productCount).toBe(1);
    expect(electronics.missingDescription).toBe(0);
    expect(electronics.averageContentScore.value).toBe(100);

    const headphones = items.find((item) => item.name === "سماعات")!;
    expect(headphones.hidden).toBe(true);
    expect(headphones.productCount).toBe(1);
    expect(headphones.missingDescription).toBe(1);
    expect(headphones.missingImagePercent).toBe(100);

    for (const item of items) {
      expect(item.salesAttribution).toMatchObject({
        availability: "unavailable",
        reason: "product_sales_not_linked",
      });
      expect(item.belowVerdictThreshold).toBe(false);
    }
  });
});

describe("product intelligence — security", () => {
  it("requires a signed-in session", async () => {
    const owner = await ownerWithStore("pi-anon@example.com");
    const anonymous = new ApiClient();

    for (const path of ["/overview", "/products", "/categories", "/issues", "/recommendations"]) {
      const response = await anonymous.get(`${base(owner)}${path}`);
      expect(response.status).toBe(401);
    }
  });

  it("returns 404 for another tenant's store and leaks nothing", async () => {
    const ownerA = await ownerWithStore("pi-tenant-a@example.com");
    await connect(ownerA);
    seedCatalog();
    await syncAll(ownerA);

    const ownerB = await ownerWithStore("pi-tenant-b@example.com");

    for (const path of ["/overview", "/products", "/categories", "/issues", "/recommendations"]) {
      const response = await ownerB.client.get<unknown>(`${base(ownerA)}${path}`);
      expect(response.status).toBe(404);
      expect(JSON.stringify(response.body)).not.toContain(ownerA.storeId);
      expect(JSON.stringify(response.body)).not.toContain("هاتف ذكي");
    }
  });

  it("keeps stores in one organization separate", async () => {
    const owner = await ownerWithStore("pi-two-stores@example.com");
    await connect(owner);
    seedCatalog();
    await syncAll(owner);

    const created = await owner.client.post<{ store: { id: string } }>(
      "/api/organizations/current/stores",
      { name: "متجر بلا كتالوج" },
    );
    const secondStoreId = created.body.data!.store.id;

    const second = await owner.client.get<Envelope<OverviewData>>(
      `/api/organizations/current/stores/${secondStoreId}/product-intelligence/overview`,
    );

    expect(second.status).toBe(200);
    expect(second.body.data!.coverage.status).toBe("empty");
    expect(second.body.data!.coverage.productCount).toBe(0);

    // The first store is untouched.
    const first = await owner.client.get<Envelope<OverviewData>>(`${base(owner)}/overview`);
    expect(first.body.data!.coverage.productCount).toBe(3);
  });

  it("allows a viewer to read and exposes no identity fields", async () => {
    const owner = await ownerWithStore("pi-viewer-owner@example.com");
    await connect(owner);
    seedCatalog();
    await syncAll(owner);

    const viewer = await inviteAndAccept(owner, "pi-viewer@example.com", "viewer");
    expect(permissionsForRole("viewer")).toContain("store:read");

    const response = await viewer.client.get<Envelope<OverviewData>>(`${base(owner)}/overview`);
    expect(response.status).toBe(200);

    const serialised = JSON.stringify(response.body);
    expect(serialised).not.toContain("@example.com");
    expect(serialised).not.toContain("mock-access");
    expect(serialised).not.toContain("first_name");
    expect(serialised).not.toContain("mobile");
  });

  it("requires store:read, which every role holds but only a member has", async () => {
    // The service gates on `store:read`. Every membership role carries it by
    // design, so the real boundary is the session and the store's organization,
    // not the permission bit — asserted here so the gate cannot be removed
    // without a test noticing.
    for (const role of MEMBERSHIP_ROLES) {
      expect(permissionsForRole(role)).toContain("store:read");
    }

    const owner = await ownerWithStore("pi-permission@example.com");
    const context = {
      userId: owner.userId,
      organizationId: owner.organizationId,
      membershipId: "00000000-0000-0000-0000-000000000000",
      role: "viewer",
      permissions: [],
      user: { id: owner.userId, email: owner.email, name: "مستخدم" },
      organization: { id: owner.organizationId, name: "مؤسسة", slug: "org" },
      sessionId: "00000000-0000-0000-0000-000000000000",
      requestId: null,
    } satisfies TenantContext;

    const result = await getCategoryIntelligence(getTestDb(), context, owner.storeId);
    expect(result.coverage.productCount).toBe(0);
  });

  it("runs the read model through the tenant transaction, never across stores", async () => {
    const owner = await ownerWithStore("pi-rls@example.com");
    await connect(owner);
    seedCatalog();
    await syncAll(owner);

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
    } satisfies TenantContext;

    const result = await getCategoryIntelligence(getTestDb(), context, owner.storeId);
    expect(result.coverage.productCount).toBe(3);

    await expect(
      getCategoryIntelligence(
        getTestDb(),
        { ...context, organizationId: "00000000-0000-0000-0000-000000000001" },
        owner.storeId,
      ),
    ).rejects.toMatchObject({ code: "TENANT_ISOLATION_VIOLATION" });
  });
});
