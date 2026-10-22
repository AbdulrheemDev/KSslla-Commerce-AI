import { describe, expect, it } from "vitest";

import { order } from "@/test/sales-fixtures";

import { computeSalesOverview } from "./metrics";

const base = {
  ordersSynced: true,
  syncIncomplete: false,
  hasBaseline: true,
};

describe("sales overview metrics", () => {
  it("counts orders, drafts, and cancellations without mixing them", () => {
    const metrics = computeSalesOverview({
      ...base,
      current: [
        order({ totalAmount: "100.00" }),
        order({ totalAmount: "200.00" }),
        order({ totalAmount: "300.00" }),
        order({ statusSlug: "in_progress", totalAmount: "400.00" }),
        order({ statusSlug: "canceled", totalAmount: "50.00" }),
        order({ draft: true, totalAmount: "999.00" }),
      ],
      previous: [],
    });

    expect(metrics.orders.value).toBe(5);
    expect(metrics.completedOrders.value).toBe(3);
    expect(metrics.cancelledOrders.value).toBe(1);
    expect(metrics.otherStatusOrders.value).toBe(1);
    expect(metrics.draftOrders.value).toBe(1);
    // 100 + 200 + 300 + 400; the canceled and the draft are excluded.
    expect(metrics.recognizedRevenue.value).toBe(1000);
    expect(metrics.averageOrderValue.value).toBe(250);
    expect(metrics.cancellationRate.value).toBe(20);
    expect(metrics.currency.value).toBe("SAR");
  });

  it("computes growth only when the previous window has a baseline", () => {
    const metrics = computeSalesOverview({
      ...base,
      current: [order({ totalAmount: "250.00" })],
      previous: [order({ totalAmount: "200.00" }), order({ totalAmount: "200.00" })],
    });

    expect(metrics.ordersGrowthPercent.value).toBe(-50);
    expect(metrics.revenueGrowthPercent.value).toBe(-37.5);
    expect(metrics.averageOrderValueGrowthPercent.value).toBe(25);
    expect(metrics.previousRecognizedRevenue.value).toBe(400);
    expect(metrics.previousAverageOrderValue.value).toBe(200);
  });

  it("refuses growth and baseline numbers without a covered previous window", () => {
    const metrics = computeSalesOverview({
      ...base,
      hasBaseline: false,
      current: [order()],
      previous: [],
    });

    expect(metrics.ordersGrowthPercent.reason).toBe("no_baseline_period");
    expect(metrics.revenueGrowthPercent.reason).toBe("no_baseline_period");
    expect(metrics.averageOrderValueGrowthPercent.reason).toBe("no_baseline_period");
    expect(metrics.previousOrders.value).toBeNull();
    expect(metrics.previousOrders.reason).toBe("no_baseline_period");
    expect(metrics.previousRecognizedRevenue.value).toBeNull();
  });

  it("reports unavailable — not zero — when orders were never synced", () => {
    const metrics = computeSalesOverview({
      ...base,
      ordersSynced: false,
      current: [],
      previous: [],
    });

    expect(metrics.orders.value).toBeNull();
    expect(metrics.orders.reason).toBe("orders_not_synced");
    expect(metrics.recognizedRevenue.reason).toBe("orders_not_synced");
    expect(metrics.averageOrderValue.reason).toBe("orders_not_synced");
    expect(metrics.cancellationRate.reason).toBe("orders_not_synced");
    expect(metrics.draftOrders.reason).toBe("orders_not_synced");
  });

  it("marks counts partial when the latest sync failed", () => {
    const metrics = computeSalesOverview({
      ...base,
      syncIncomplete: true,
      current: [order()],
      previous: [order()],
    });

    expect(metrics.orders.value).toBe(1);
    expect(metrics.orders.availability).toBe("partial");
    expect(metrics.orders.reason).toBe("orders_sync_incomplete");
    expect(metrics.cancellationRate.availability).toBe("partial");
  });

  it("never adds different currencies", () => {
    const metrics = computeSalesOverview({
      ...base,
      current: [
        order({ totalAmount: "100.00", currency: "SAR" }),
        order({ totalAmount: "100.00", currency: "AED" }),
      ],
      previous: [],
    });

    expect(metrics.orders.value).toBe(2);
    expect(metrics.currency.reason).toBe("mixed_currency");
    expect(metrics.recognizedRevenue.value).toBeNull();
    expect(metrics.recognizedRevenue.reason).toBe("mixed_currency");
    expect(metrics.averageOrderValue.value).toBeNull();
  });

  it("marks revenue partial when an order has no total", () => {
    const metrics = computeSalesOverview({
      ...base,
      current: [order({ totalAmount: "100.00" }), order({ totalAmount: null, currency: null })],
      previous: [],
    });

    expect(metrics.recognizedRevenue.value).toBe(100);
    expect(metrics.recognizedRevenue.availability).toBe("partial");
    expect(metrics.recognizedRevenue.reason).toBe("some_orders_missing_total");
  });

  it("handles a cancelled-only window without inventing revenue", () => {
    const metrics = computeSalesOverview({
      ...base,
      current: [order({ statusSlug: "canceled", totalAmount: "50.00" })],
      previous: [],
    });

    expect(metrics.orders.value).toBe(1);
    expect(metrics.cancelledOrders.value).toBe(1);
    expect(metrics.cancellationRate.value).toBe(100);
    expect(metrics.recognizedRevenue.value).toBeNull();
    expect(metrics.averageOrderValue.value).toBeNull();
  });

  it("refuses a cancellation rate when there are no orders", () => {
    const metrics = computeSalesOverview({
      ...base,
      current: [],
      previous: [],
    });

    expect(metrics.orders.value).toBe(0);
    expect(metrics.cancellationRate.value).toBeNull();
    expect(metrics.cancellationRate.reason).toBe("no_orders_in_period");
  });

  it("does not fabricate AOV growth when the previous AOV is unavailable", () => {
    const metrics = computeSalesOverview({
      ...base,
      current: [order({ totalAmount: "300.00" })],
      previous: [order({ totalAmount: null, currency: null })],
    });

    expect(metrics.averageOrderValueGrowthPercent.value).toBeNull();
  });
});
