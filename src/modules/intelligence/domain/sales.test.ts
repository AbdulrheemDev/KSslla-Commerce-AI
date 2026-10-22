import { describe, expect, it } from "vitest";

import { computeSalesMetrics, type OrderMetricRow } from "@/modules/intelligence/domain/sales";

/**
 * Sales metrics must never invent a number. The cases below cover the three
 * ways a store's data can be unusable — missing totals, mixed currencies,
 * no baseline — and prove each one degrades to `partial` or `unavailable`
 * instead of zero.
 */

function order(overrides: Partial<OrderMetricRow> = {}): OrderMetricRow {
  return {
    statusSlug: "completed",
    totalAmount: "100.00",
    currency: "SAR",
    draft: false,
    ...overrides,
  };
}

const synced = { ordersSynced: true, syncIncomplete: false, hasBaseline: true };

describe("computeSalesMetrics — ordinary store", () => {
  const metrics = computeSalesMetrics({
    current: [
      order(),
      order({ totalAmount: "200.00" }),
      order({ statusSlug: "canceled" }),
      order({ statusSlug: "under_review", totalAmount: "50.00" }),
      order({ draft: true, totalAmount: "999.00" }),
    ],
    previous: [order({ totalAmount: "100.00" }), order({ totalAmount: "100.00" })],
    ...synced,
  });

  it("counts non-draft orders and splits documented statuses", () => {
    expect(metrics.orders).toEqual({
      value: 4,
      availability: "available",
      basis: "orders.status_filter",
      reason: null,
    });
    expect(metrics.completedOrders.value).toBe(2);
    expect(metrics.cancelledOrders.value).toBe(1);
    expect(metrics.otherStatusOrders.value).toBe(1);
  });

  it("sums only orders with a usable total and currency", () => {
    expect(metrics.totalOrderValue.value).toBe(350);
    expect(metrics.totalOrderValue.availability).toBe("available");
    expect(metrics.completedOrderValue.value).toBe(300);
  });

  it("computes AOV over priced orders and growth over the previous window", () => {
    // 350 over the three non-canceled priced orders.
    expect(metrics.averageOrderValue.value).toBe(116.7);
    expect(metrics.ordersGrowthPercent.value).toBe(100);
    expect(metrics.valueGrowthPercent.value).toBe(75);
    expect(metrics.currency.value).toBe("SAR");
  });
});

describe("computeSalesMetrics — degraded data", () => {
  it("refuses to sum mixed currencies", () => {
    const metrics = computeSalesMetrics({
      current: [order(), order({ totalAmount: "50.00", currency: "USD" })],
      previous: [],
      ...synced,
    });

    expect(metrics.totalOrderValue).toEqual({
      value: null,
      availability: "unavailable",
      basis: null,
      reason: "mixed_currency",
    });
    expect(metrics.averageOrderValue.reason).toBe("mixed_currency");
    expect(metrics.currency.reason).toBe("mixed_currency");
  });

  it("marks a sum partial when some orders have no total", () => {
    const metrics = computeSalesMetrics({
      current: [order(), order({ totalAmount: null })],
      previous: [],
      ...synced,
    });

    expect(metrics.totalOrderValue.availability).toBe("partial");
    expect(metrics.totalOrderValue.reason).toBe("some_orders_missing_total");
    expect(metrics.totalOrderValue.value).toBe(100);
  });

  it("returns unavailable when no order carries a total", () => {
    const metrics = computeSalesMetrics({
      current: [order({ totalAmount: null, currency: null })],
      previous: [],
      ...synced,
    });

    expect(metrics.totalOrderValue.reason).toBe("no_order_totals");
    expect(metrics.averageOrderValue.reason).toBe("no_order_totals");
  });

  it("reports zero completed value as a real zero", () => {
    const metrics = computeSalesMetrics({
      current: [order({ statusSlug: "canceled" })],
      previous: [],
      ...synced,
    });

    expect(metrics.completedOrderValue).toEqual({
      value: 0,
      availability: "available",
      basis: "sum(orders.total_amount where status=completed)",
      reason: null,
    });
  });

  it("does not invent growth without a baseline window", () => {
    const metrics = computeSalesMetrics({
      current: [order()],
      previous: [],
      ordersSynced: true,
      syncIncomplete: false,
      hasBaseline: false,
    });

    expect(metrics.ordersGrowthPercent.reason).toBe("no_baseline_period");
    expect(metrics.valueGrowthPercent.reason).toBe("no_baseline_period");
  });

  it("does not divide by a zero previous value", () => {
    const metrics = computeSalesMetrics({
      current: [order()],
      previous: [],
      ...synced,
    });

    expect(metrics.ordersGrowthPercent.reason).toBe("no_baseline_orders");
  });

  it("is unavailable when orders were never synced", () => {
    const metrics = computeSalesMetrics({
      current: [],
      previous: [],
      ordersSynced: false,
      syncIncomplete: false,
      hasBaseline: false,
    });

    expect(metrics.orders.reason).toBe("orders_not_synced");
    expect(metrics.completedOrderValue.reason).toBe("orders_not_synced");
    expect(metrics.totalOrderValue.reason).toBe("orders_not_synced");
    expect(metrics.averageOrderValue.reason).toBe("orders_not_synced");
  });

  it("marks counts partial when the last sync failed", () => {
    const metrics = computeSalesMetrics({
      current: [order()],
      previous: [],
      ordersSynced: true,
      syncIncomplete: true,
      hasBaseline: false,
    });

    expect(metrics.orders.availability).toBe("partial");
    expect(metrics.orders.reason).toBe("orders_sync_incomplete");
  });

  it("treats an empty synced window as a truthful zero", () => {
    const metrics = computeSalesMetrics({
      current: [],
      previous: [order()],
      ...synced,
    });

    expect(metrics.orders.value).toBe(0);
    expect(metrics.totalOrderValue.reason).toBe("no_order_totals");
    expect(metrics.ordersGrowthPercent.value).toBe(-100);
  });
});
