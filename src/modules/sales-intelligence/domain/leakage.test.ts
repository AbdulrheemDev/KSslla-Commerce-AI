import { describe, expect, it } from "vitest";

import { metric, salesMetrics } from "@/test/sales-fixtures";

import { detectLeakage, UNAVAILABLE_LEAKAGE_SIGNALS } from "./leakage";

const base = {
  hasBaseline: true,
  ordersSynced: true,
  syncIncomplete: false,
};

describe("sales leakage", () => {
  it("always states which leak metrics have no data source", () => {
    const report = detectLeakage({ ...base, metrics: salesMetrics() }, "2026-09-22");

    expect(report.unavailable.map((item) => item.reason)).toEqual([
      "traffic_not_available",
      "conversion_not_available",
      "cart_data_not_available",
    ]);
    expect(UNAVAILABLE_LEAKAGE_SIGNALS).toHaveLength(3);
  });

  it("flags a cancellation-rate spike with both rates in the evidence", () => {
    const report = detectLeakage({ ...base, metrics: salesMetrics() }, "2026-09-22");
    const signal = report.signals.find((item) => item.type === "cancellation_rate_spike");

    expect(signal).toBeDefined();
    expect(signal?.severity).toBe("high"); // +20 points
    expect(signal?.evidence).toContainEqual({
      label: "نسبة الإلغاء الحالية",
      value: 20,
      unit: "%",
    });
    expect(signal?.rationale).toContain("10");
  });

  it("does not flag a cancellation spike when the rate stays below the floor", () => {
    const report = detectLeakage(
      {
        ...base,
        metrics: salesMetrics({
          orders: metric(20),
          cancelledOrders: metric(1),
          cancellationRate: metric(5),
          previousCancelledOrders: metric(0),
          previousOrders: metric(20),
          ordersGrowthPercent: metric(0),
          revenueGrowthPercent: metric(0),
          averageOrderValueGrowthPercent: metric(0),
        }),
      },
      "2026-09-22",
    );

    expect(report.signals.map((item) => item.type)).not.toContain("cancellation_rate_spike");
  });

  it("flags orders stuck outside completed/canceled", () => {
    const report = detectLeakage(
      {
        ...base,
        metrics: salesMetrics({
          orders: metric(10),
          completedOrders: metric(6),
          cancelledOrders: metric(0),
          otherStatusOrders: metric(4),
          cancellationRate: metric(0),
        }),
      },
      "2026-09-22",
    );

    const signal = report.signals.find((item) => item.type === "stuck_orders");
    expect(signal).toBeDefined();
    expect(signal?.severity).toBe("medium"); // 40%
    expect(signal?.evidence).toContainEqual({ label: "الحصة", value: 40, unit: "%" });
  });

  it("flags a draft pile only past both thresholds", () => {
    const below = detectLeakage(
      { ...base, metrics: salesMetrics({ draftOrders: metric(9), orders: metric(5) }) },
      "2026-09-22",
    );
    expect(below.signals.map((item) => item.type)).not.toContain("draft_pile");

    const above = detectLeakage(
      { ...base, metrics: salesMetrics({ draftOrders: metric(12), orders: metric(5) }) },
      "2026-09-22",
    );
    const signal = above.signals.find((item) => item.type === "draft_pile");
    expect(signal).toBeDefined();
    expect(signal?.severity).toBe("low");
  });

  it("detects the same revenue with fewer dirhams per order", () => {
    const report = detectLeakage(
      {
        ...base,
        metrics: salesMetrics({
          ordersGrowthPercent: metric(-2),
          revenueGrowthPercent: metric(-30),
          averageOrderValueGrowthPercent: metric(-28),
        }),
      },
      "2026-09-22",
    );

    expect(report.signals.map((item) => item.type)).toEqual(
      expect.arrayContaining([
        "revenue_decline_with_stable_orders",
        "aov_decline_with_stable_orders",
      ]),
    );
  });

  it("does not claim a leak when volume itself collapsed", () => {
    const report = detectLeakage(
      {
        ...base,
        metrics: salesMetrics({
          ordersGrowthPercent: metric(-40),
          revenueGrowthPercent: metric(-45),
          averageOrderValueGrowthPercent: metric(-8),
          cancellationRate: metric(0),
          previousCancelledOrders: metric(0),
        }),
      },
      "2026-09-22",
    );

    expect(report.signals.map((item) => item.type)).not.toContain(
      "revenue_decline_with_stable_orders",
    );
  });

  it("keeps current-window signals but skips comparisons without a baseline", () => {
    const report = detectLeakage(
      {
        ...base,
        hasBaseline: false,
        metrics: salesMetrics({ otherStatusOrders: metric(3) }),
      },
      "2026-09-22",
    );

    expect(report.signals.map((item) => item.type)).toContain("stuck_orders");
    expect(report.skipped).toContainEqual({ rule: "comparisons", reason: "no_baseline_period" });
  });

  it("produces nothing while the sync is incomplete", () => {
    const report = detectLeakage(
      { ...base, syncIncomplete: true, metrics: salesMetrics({ otherStatusOrders: metric(4) }) },
      "2026-09-22",
    );

    expect(report.signals).toHaveLength(0);
    expect(report.skipped).toContainEqual({ rule: "all", reason: "orders_sync_incomplete" });
  });

  it("produces nothing when orders were never synced", () => {
    const report = detectLeakage(
      { ...base, ordersSynced: false, metrics: salesMetrics() },
      "2026-09-22",
    );

    expect(report.signals).toHaveLength(0);
    expect(report.skipped).toContainEqual({ rule: "all", reason: "orders_not_synced" });
  });
});
