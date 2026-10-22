import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { permissionsForRole } from "@/modules/identity/domain/permissions";
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
import { closeTestDb } from "@/test/db/client";

/**
 * Sales intelligence on real PostgreSQL with RLS.
 *
 * Every store in this suite is populated through the real Salla sync against the
 * local protocol simulator — no row is inserted by hand — so the assertions sit
 * on top of the same code path a merchant would exercise.
 *
 * The suite proves: the hand-computable numbers, explicit `unavailable` on empty
 * and partial stores, the anomaly arithmetic, CSV parity with the API, tenant
 * isolation (including the export route), period/granularity validation, and the
 * absence of customer PII in every payload.
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

interface MetricValue<T> {
  value: T | null;
  availability: "available" | "partial" | "unavailable";
  basis: string | null;
  reason: string | null;
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
    resources: Array<{ resource: string; status: string; lastSuccessAt: string | null }>;
    staleResources: string[];
  };
  data: T;
}

interface OverviewData {
  metrics: {
    orders: MetricValue<number>;
    completedOrders: MetricValue<number>;
    cancelledOrders: MetricValue<number>;
    otherStatusOrders: MetricValue<number>;
    draftOrders: MetricValue<number>;
    cancellationRate: MetricValue<number>;
    recognizedRevenue: MetricValue<number>;
    averageOrderValue: MetricValue<number>;
    currency: MetricValue<string>;
    ordersGrowthPercent: MetricValue<number>;
    revenueGrowthPercent: MetricValue<number>;
    averageOrderValueGrowthPercent: MetricValue<number>;
    previousOrders: MetricValue<number>;
    previousRecognizedRevenue: MetricValue<number>;
    previousAverageOrderValue: MetricValue<number>;
  };
  confidence: {
    level: string;
    ordersSynced: boolean;
    baselineAvailable: boolean;
    mixedCurrency: boolean;
  };
  seasonality: { available: boolean; verdict: string };
  discounts: { available: boolean; reason: string };
  anomalies: { total: number; byType: Record<string, number> };
  alerts: Array<{ id: string; kind: string; advisoryOnly: boolean; severity: string }>;
}

interface TrendsData {
  granularity: string;
  currency: MetricValue<string>;
  buckets: Array<{
    key: string;
    from: string;
    to: string;
    history: string;
    orders: MetricValue<number>;
    revenue: MetricValue<number>;
    averageOrderValue: MetricValue<number>;
  }>;
  previous: { period: { from: string; to: string }; buckets: unknown[] } | null;
}

interface AnomaliesData {
  baseline: { available: boolean; reason: string | null; from: string; to: string };
  anomalies: Array<{
    id: string;
    type: string;
    severity: string;
    observed: number;
    baseline: number;
    threshold: number;
    unit: string;
    change: number;
    evidence: Array<{ label: string; value: string | number | null }>;
    period: { from: string; to: string; previousFrom: string; previousTo: string };
  }>;
  suppressed: Array<{ rule: string; reason: string }>;
  alerts: Array<{ id: string; advisoryOnly: boolean }>;
}

interface DiscountsData {
  available: boolean;
  reason: string;
  amount: MetricValue<number>;
  discountRate: MetricValue<number>;
  source: { usedEndpoint: string; documentedIn: string; note: string };
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

function order(index: number, date: string, slug: string, amount: string, draft = false) {
  return {
    id: 700000 + index,
    external_reference_id: `EXT-${date}-${index}`,
    reference_id: `REF-${date}-${index}`,
    total: { amount, currency: "SAR" },
    date: { date, timezone_type: 3, timezone: "Asia/Riyadh" },
    source: "web",
    status: { id: slug === "canceled" ? 2 : 1, name: slug, slug },
    draft,
    payment_method: "mada",
    is_pending_payment: false,
    items: [{ name: "بند", quantity: 1, thumbnail: null }],
    customer: customer(index),
  };
}

/** One window: 3 completed (100/200/300), 1 canceled (50), 1 draft (999). */
function seedOrders(): void {
  mock.customers = [customer(1), customer(2), customer(3)];

  mock.orders = [
    order(1, "2026-10-11 12:00:00.000000", "completed", "100.00"),
    order(2, "2026-10-12 12:00:00.000000", "completed", "200.00"),
    order(3, "2026-10-13 12:00:00.000000", "completed", "300.00"),
    order(4, "2026-10-14 12:00:00.000000", "canceled", "50.00"),
    order(5, "2026-10-15 12:00:00.000000", "completed", "999.00", true),
  ];
}

/**
 * Two equal windows, hand-computable:
 * current 2026-10-10 → 10-16: 4 orders, 600 SAR, AOV 200, one cancellation.
 * previous 2026-10-03 → 10-09: 4 orders, 400 SAR, AOV 100, no cancellations.
 */
function seedTwoPeriods(): void {
  mock.customers = [customer(1), customer(2), customer(3)];

  mock.orders = [
    // Outside both windows: it only proves the mirror's history predates them.
    order(0, "2026-10-01 12:00:00.000000", "completed", "100.00"),

    order(11, "2026-10-04 12:00:00.000000", "completed", "90.00"),
    order(12, "2026-10-05 12:00:00.000000", "completed", "90.00"),
    order(13, "2026-10-06 12:00:00.000000", "completed", "90.00"),
    order(14, "2026-10-07 12:00:00.000000", "completed", "90.00"),
    order(15, "2026-10-08 12:00:00.000000", "completed", "90.00"),

    order(1, "2026-10-11 12:00:00.000000", "completed", "100.00"),
    order(2, "2026-10-12 12:00:00.000000", "completed", "200.00"),
    order(3, "2026-10-13 12:00:00.000000", "completed", "300.00"),
    order(4, "2026-10-14 12:00:00.000000", "canceled", "50.00"),
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

const WINDOW = "period=custom&from=2026-10-10&to=2026-10-16";

function base(owner: StoreFixture): string {
  return `/api/organizations/current/stores/${owner.storeId}/sales-intelligence`;
}

function csvRows(csv: string): string[][] {
  return csv
    .replace(/^\uFEFF/, "")
    .trimEnd()
    .split("\r\n")
    .map((line) => line.split(","));
}

describe("sales intelligence — computed from mirrored data", () => {
  it("reports revenue, orders, AOV, and cancellation from the real mirror", async () => {
    const owner = await ownerWithStore("sales-owner@example.test");
    await connect(owner);
    seedCatalogue();
    seedOrders();
    await syncStore(owner);

    const response = await owner.client.get<Envelope<OverviewData>>(
      `${base(owner)}/overview?period=30d`,
    );

    expect(response.status).toBe(200);
    const envelope = response.body.data!;
    const metrics = envelope.data.metrics;

    expect(envelope.storeId).toBe(owner.storeId);
    expect(envelope.coverage.status).toBe("partial");
    expect(envelope.coverage.notes).toContain("history_starts_after_window");

    // 5 mirrored orders, one draft → 4 counted; 3 completed, 1 canceled.
    expect(metrics.orders.value).toBe(4);
    expect(metrics.completedOrders.value).toBe(3);
    expect(metrics.cancelledOrders.value).toBe(1);
    expect(metrics.draftOrders.value).toBe(1);
    expect(metrics.cancellationRate.value).toBe(25);

    // 100 + 200 + 300; canceled and draft excluded from money.
    expect(metrics.recognizedRevenue.value).toBe(600);
    expect(metrics.averageOrderValue.value).toBe(200);
    expect(metrics.currency.value).toBe("SAR");

    // No previous-window coverage → refused, not zero.
    expect(metrics.previousOrders.value).toBeNull();
    expect(metrics.revenueGrowthPercent.reason).toBe("no_baseline_period");

    expect(envelope.data.confidence.level).toBe("medium");
    expect(envelope.data.confidence.baselineAvailable).toBe(false);
    expect(envelope.data.seasonality.verdict).toBe("insufficient_history");
    expect(envelope.data.discounts).toMatchObject({
      available: false,
      reason: "discount_not_mirrored",
    });
  });

  it("returns chartable buckets with real values and a previous series", async () => {
    const owner = await ownerWithStore("sales-trends@example.test");
    await connect(owner);
    seedCatalogue();
    seedTwoPeriods();
    await syncStore(owner);

    const response = await owner.client.get<Envelope<TrendsData>>(
      `${base(owner)}/trends?${WINDOW}&granularity=day`,
    );

    expect(response.status).toBe(200);
    const data = response.body.data!.data;

    expect(data.buckets).toHaveLength(7);
    expect(data.buckets.map((bucket) => bucket.key)).toEqual([
      "2026-10-10",
      "2026-10-11",
      "2026-10-12",
      "2026-10-13",
      "2026-10-14",
      "2026-10-15",
      "2026-10-16",
    ]);

    // Empty day inside covered history is a truthful zero.
    expect(data.buckets[0]?.orders.value).toBe(0);
    expect(data.buckets[0]?.revenue.value).toBe(0);

    expect(data.buckets[1]?.revenue.value).toBe(100);
    expect(data.buckets[2]?.revenue.value).toBe(200);
    expect(data.buckets[3]?.revenue.value).toBe(300);
    // Canceled-only day: counted as an order, contributes no money.
    expect(data.buckets[4]?.orders.value).toBe(1);
    expect(data.buckets[4]?.revenue.value).toBe(0);

    expect(data.previous).not.toBeNull();
    expect(data.previous?.buckets).toHaveLength(7);
    expect(data.previous?.period.from.slice(0, 10)).toBe("2026-10-03");
  });

  it("computes growth and fires anomalies from two hand-computable windows", async () => {
    const owner = await ownerWithStore("sales-growth@example.test");
    await connect(owner);
    seedCatalogue();
    seedTwoPeriods();
    await syncStore(owner);

    const overview = await owner.client.get<Envelope<OverviewData>>(
      `${base(owner)}/overview?${WINDOW}`,
    );
    expect(overview.status).toBe(200);
    const metrics = overview.body.data!.data.metrics;

    expect(metrics.orders.value).toBe(4);
    expect(metrics.recognizedRevenue.value).toBe(600);
    expect(metrics.averageOrderValue.value).toBe(200);
    expect(metrics.previousOrders.value).toBe(5);
    expect(metrics.previousRecognizedRevenue.value).toBe(450);
    expect(metrics.previousAverageOrderValue.value).toBe(90);

    expect(metrics.ordersGrowthPercent.value).toBe(-20);
    expect(metrics.revenueGrowthPercent.value).toBeCloseTo(33.3, 1);
    expect(metrics.averageOrderValueGrowthPercent.value).toBeCloseTo(122.2, 1);

    const anomalies = await owner.client.get<Envelope<AnomaliesData>>(
      `${base(owner)}/anomalies?${WINDOW}`,
    );
    expect(anomalies.status).toBe(200);
    const report = anomalies.body.data!.data;
    const byType = Object.fromEntries(report.anomalies.map((item) => [item.type, item]));

    expect(report.baseline.available).toBe(true);
    expect(report.baseline.from.slice(0, 10)).toBe("2026-10-03");

    // AOV 90 → 200, cancellations 0% → 25%, completion 100% → 75%.
    expect(byType.aov_change?.severity).toBe("high");
    expect(byType.cancellation_spike?.observed).toBe(25);
    expect(byType.cancellation_spike?.baseline).toBe(0);
    expect(byType.completion_drop?.observed).toBe(75);
    expect(byType.revenue_drop).toBeUndefined();
    expect(byType.orders_drop).toBeUndefined();

    for (const anomaly of report.anomalies) {
      expect(anomaly.evidence.length).toBeGreaterThan(0);
      expect(anomaly.period.previousFrom.slice(0, 10)).toBe("2026-10-03");
    }

    expect(report.alerts.length).toBeGreaterThan(0);
    expect(report.alerts.every((alert) => alert.advisoryOnly)).toBe(true);
  });

  it("keeps discount analysis explicitly unavailable with its source", async () => {
    const owner = await ownerWithStore("sales-discounts@example.test");
    await connect(owner);
    seedCatalogue();
    seedOrders();
    await syncStore(owner);

    const response = await owner.client.get<Envelope<DiscountsData>>(
      `${base(owner)}/discounts?period=30d`,
    );

    expect(response.status).toBe(200);
    const data = response.body.data!.data;

    expect(data.available).toBe(false);
    expect(data.reason).toBe("discount_not_mirrored");
    expect(data.amount.value).toBeNull();
    expect(data.amount.reason).toBe("discount_not_mirrored");
    expect(data.discountRate.value).toBeNull();
    expect(data.source.usedEndpoint).toContain("orders");
    expect(data.source.documentedIn).toContain("amounts.discounts");
  });

  it("exports a CSV that matches the API numbers", async () => {
    const owner = await ownerWithStore("sales-export@example.test");
    await connect(owner);
    seedCatalogue();
    seedOrders();
    await syncStore(owner);

    const overview = await owner.client.get<Envelope<OverviewData>>(
      `${base(owner)}/overview?period=30d`,
    );
    const metrics = overview.body.data!.data.metrics;

    const exported = await owner.client.getText(`${base(owner)}/export?period=30d&dataset=summary`);

    expect(exported.status).toBe(200);
    expect(exported.headers.get("content-type")).toContain("text/csv");
    expect(exported.headers.get("content-disposition")).toContain("attachment");

    const rows = csvRows(exported.text);
    expect(rows[0]).toEqual([
      "metric",
      "label_ar",
      "value",
      "availability",
      "basis",
      "reason",
      "currency",
    ]);

    const revenue = rows.find((row) => row[0] === "recognizedRevenue")!;
    expect(Number(revenue[2])).toBe(metrics.recognizedRevenue.value);
    expect(revenue[3]).toBe("available");
    expect(revenue[6]).toBe("SAR");

    const orders = rows.find((row) => row[0] === "orders")!;
    expect(Number(orders[2])).toBe(metrics.orders.value);

    // Unavailable metrics stay blank instead of becoming zeros.
    const growth = rows.find((row) => row[0] === "revenueGrowthPercent")!;
    expect(growth[2]).toBe("");
    expect(growth[5]).toBe("no_baseline_period");

    // No customer identity anywhere in the file.
    expect(exported.text).not.toContain("@example.test");
    expect(exported.text).not.toContain("5000000");
    expect(exported.text).not.toContain("customer");
  });

  it("exports anomalies with the arithmetic that fired them", async () => {
    const owner = await ownerWithStore("sales-export-anomalies@example.test");
    await connect(owner);
    seedCatalogue();
    seedTwoPeriods();
    await syncStore(owner);

    const exported = await owner.client.getText(
      `${base(owner)}/export?${WINDOW}&dataset=anomalies`,
    );

    expect(exported.status).toBe(200);
    const rows = csvRows(exported.text);

    expect(rows[0]).toEqual([
      "type",
      "severity",
      "metric",
      "observed",
      "baseline",
      "threshold",
      "unit",
      "change",
      "recommendation",
      "rationale",
      "period_from",
      "period_to",
      "previous_from",
      "previous_to",
    ]);

    const aov = rows.find((row) => row[0] === "aov_change")!;
    expect(aov[3]).toBe("200");
    expect(aov[4]).toBe("90");
    expect(Number(aov[7])).toBeCloseTo(122.2, 1);

    const revenue = rows.find((row) => row[0] === "revenue_drop");
    expect(revenue).toBeUndefined();
  });

  it("refuses every rule on an empty store and says why", async () => {
    const owner = await ownerWithStore("sales-empty@example.test");
    await connect(owner);

    const overview = await owner.client.get<Envelope<OverviewData>>(
      `${base(owner)}/overview?period=30d`,
    );
    expect(overview.status).toBe(200);

    const envelope = overview.body.data!;
    expect(envelope.coverage.status).toBe("empty");
    expect(envelope.data.metrics.orders.value).toBeNull();
    expect(envelope.data.metrics.orders.reason).toBe("orders_not_synced");
    expect(envelope.data.metrics.recognizedRevenue.reason).toBe("orders_not_synced");
    expect(envelope.data.metrics.averageOrderValue.reason).toBe("orders_not_synced");
    expect(envelope.data.confidence.level).toBe("low");

    const anomalies = await owner.client.get<Envelope<AnomaliesData>>(
      `${base(owner)}/anomalies?period=30d`,
    );
    expect(anomalies.body.data!.data.anomalies).toHaveLength(0);

    const trends = await owner.client.get<Envelope<TrendsData>>(`${base(owner)}/trends?period=7d`);
    const bucket = trends.body.data!.data.buckets[0]!;
    expect(bucket.orders.value).toBeNull();
    expect(bucket.revenue.value).toBeNull();
  });

  it("marks the last good numbers partial after a failed sync", async () => {
    const owner = await ownerWithStore("sales-partial@example.test");
    await connect(owner);
    seedCatalogue();
    seedOrders();
    await syncStore(owner);

    mock.behaviour.dataStatus = 500;
    await owner.client.post(`/api/organizations/current/stores/${owner.storeId}/data/sync`, {
      resource: "orders",
    });

    const response = await owner.client.get<Envelope<OverviewData>>(
      `${base(owner)}/overview?period=30d`,
    );

    expect(response.status).toBe(200);
    const metrics = response.body.data!.data.metrics;

    expect(metrics.orders.value).toBe(4);
    expect(metrics.orders.availability).toBe("partial");
    expect(metrics.orders.reason).toBe("orders_sync_incomplete");

    // Money keeps Phase 07 semantics (the stored totals are still correct), but
    // confidence drops and a data-quality alert explains why.
    expect(response.body.data!.data.confidence.level).toBe("low");
    expect(response.body.data!.data.alerts).toContainEqual(
      expect.objectContaining({ kind: "data_quality" }),
    );

    const ordersState = response.body.data!.freshness.resources.find(
      (item) => item.resource === "orders",
    );
    expect(ordersState?.status).toBe("failed");
    expect(ordersState?.lastSuccessAt).not.toBeNull();
  });

  it("isolates tenants on every endpoint and on the export", async () => {
    const ownerA = await ownerWithStore("sales-tenant-a@example.test");
    await connect(ownerA);
    seedCatalogue();
    seedOrders();
    await syncStore(ownerA);

    const ownerB = await ownerWithStore("sales-tenant-b@example.test");

    for (const path of [
      `/overview?period=30d`,
      `/trends?period=7d`,
      `/anomalies?period=30d`,
      `/discounts?period=30d`,
      `/export?period=30d&dataset=summary`,
    ]) {
      const response = await ownerB.client.get<unknown>(`${base(ownerA)}${path}`);
      expect(response.status).toBe(404);
      expect(JSON.stringify(response.body)).not.toContain(ownerA.storeId);
    }

    // The owner still sees their own data unchanged.
    const own = await ownerA.client.get<Envelope<OverviewData>>(
      `${base(ownerA)}/overview?period=30d`,
    );
    expect(own.status).toBe(200);
    expect(own.body.data!.data.metrics.recognizedRevenue.value).toBe(600);
  });

  it("lets a viewer read but keeps the payload free of identity fields", async () => {
    const owner = await ownerWithStore("sales-viewer-owner@example.test");
    await connect(owner);
    seedCatalogue();
    seedOrders();
    await syncStore(owner);

    const viewer = await inviteAndAccept(owner, "sales-viewer@example.test", "viewer");
    expect(permissionsForRole("viewer")).toContain("store:read");

    const response = await viewer.client.get<Envelope<OverviewData>>(
      `${base(owner)}/overview?period=30d`,
    );
    expect(response.status).toBe(200);

    const serialised = JSON.stringify(response.body);
    expect(serialised).not.toContain("@example.test");
    expect(serialised).not.toContain("5000000");
    expect(serialised).not.toContain("first_name");
    expect(serialised).not.toContain("last_name");
    expect(serialised).not.toContain("mobile");
  });

  it("rejects malformed periods, granularities, and export datasets", async () => {
    const owner = await ownerWithStore("sales-validation@example.test");
    await connect(owner);

    const badPeriod = await owner.client.get(`${base(owner)}/overview?period=1y`);
    expect(badPeriod.status).toBe(422);

    const missingRange = await owner.client.get(`${base(owner)}/trends?period=custom`);
    expect(missingRange.status).toBe(422);

    const reversed = await owner.client.get(
      `${base(owner)}/overview?period=custom&from=2026-10-16&to=2026-10-10`,
    );
    expect(reversed.status).toBe(422);

    const badGranularity = await owner.client.get(
      `${base(owner)}/trends?period=30d&granularity=hour`,
    );
    expect(badGranularity.status).toBe(422);

    const badDataset = await owner.client.get(`${base(owner)}/export?period=30d&dataset=raw`);
    expect(badDataset.status).toBe(422);
  });

  it("requires a signed-in session", async () => {
    const owner = await ownerWithStore("sales-anon@example.test");
    const anonymous = new ApiClient();

    const response = await anonymous.get(`${base(owner)}/overview?period=30d`);
    expect(response.status).toBe(401);
  });
});
