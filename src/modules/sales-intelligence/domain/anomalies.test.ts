import { describe, expect, it } from "vitest";

import type { AnalysisPeriod, Coverage } from "@/modules/intelligence/domain/types";
import { metric, salesMetrics } from "@/test/sales-fixtures";

import { detectAnomalies } from "./anomalies";

const PERIOD: AnalysisPeriod = {
  key: "30d",
  from: new Date("2026-09-22T00:00:00.000Z"),
  to: new Date("2026-10-22T00:00:00.000Z"),
  days: 30,
};

const PREVIOUS: AnalysisPeriod = {
  key: "30d",
  from: new Date("2026-08-23T00:00:00.000Z"),
  to: new Date("2026-09-21T23:59:59.999Z"),
  days: 30,
};

const COVERAGE: Coverage = {
  requestedFrom: PERIOD.from.toISOString(),
  requestedTo: PERIOD.to.toISOString(),
  firstOrderAt: "2026-06-01T00:00:00.000Z",
  lastOrderAt: "2026-10-21T00:00:00.000Z",
  status: "complete",
  notes: [],
};

function input(overrides: Partial<Parameters<typeof detectAnomalies>[0]> = {}) {
  return {
    metrics: salesMetrics(),
    hasBaseline: true,
    ordersSynced: true,
    syncIncomplete: false,
    coverage: COVERAGE,
    period: PERIOD,
    previous: PREVIOUS,
    ...overrides,
  };
}

describe("sales anomalies", () => {
  it("detects the five rules with their exact thresholds", () => {
    const report = detectAnomalies(input());
    const byType = Object.fromEntries(report.anomalies.map((item) => [item.type, item]));

    expect(report.baseline.available).toBe(true);
    expect(Object.keys(byType).sort()).toEqual([
      "aov_change",
      "cancellation_spike",
      "completion_drop",
      "orders_drop",
      "revenue_drop",
    ]);

    expect(byType.revenue_drop?.severity).toBe("high"); // −37.5% ≤ −35
    expect(byType.revenue_drop?.observed).toBe(1000);
    expect(byType.revenue_drop?.baseline).toBe(1600);
    expect(byType.revenue_drop?.threshold).toBe(20);

    expect(byType.orders_drop?.severity).toBe("medium"); // −37.5% > −40
    expect(byType.orders_drop?.observed).toBe(5);
    expect(byType.orders_drop?.baseline).toBe(8);

    expect(byType.aov_change?.severity).toBe("medium"); // +25%
    expect(byType.aov_change?.change).toBe(25);

    expect(byType.cancellation_spike?.severity).toBe("high"); // +20 points
    expect(byType.cancellation_spike?.unit).toBe("points");

    expect(byType.completion_drop?.severity).toBe("high"); // 60% vs 100%
  });

  it("produces nothing when every measured change is small", () => {
    const report = detectAnomalies(
      input({
        metrics: salesMetrics({
          orders: metric(10),
          completedOrders: metric(8),
          cancelledOrders: metric(1),
          otherStatusOrders: metric(1),
          previousOrders: metric(10),
          previousCompletedOrders: metric(8),
          previousCancelledOrders: metric(1),
          cancellationRate: metric(10),
          recognizedRevenue: metric(2000),
          previousRecognizedRevenue: metric(2000),
          averageOrderValue: metric(250),
          previousAverageOrderValue: metric(250),
          ordersGrowthPercent: metric(0),
          revenueGrowthPercent: metric(0),
          averageOrderValueGrowthPercent: metric(0),
        }),
      }),
    );

    expect(report.anomalies).toHaveLength(0);
    expect(report.suppressed).toHaveLength(0);
    expect(report.baseline.available).toBe(true);
  });

  it("fires exactly at the revenue threshold and not below it", () => {
    const atThreshold = detectAnomalies(
      input({
        metrics: salesMetrics({
          revenueGrowthPercent: metric(-20),
          ordersGrowthPercent: metric(0),
          averageOrderValueGrowthPercent: metric(0),
          cancellationRate: metric(10),
          previousCancelledOrders: metric(1),
        }),
      }),
    );
    expect(atThreshold.anomalies.map((item) => item.type)).toContain("revenue_drop");

    const below = detectAnomalies(
      input({
        metrics: salesMetrics({
          revenueGrowthPercent: metric(-19.9),
          ordersGrowthPercent: metric(0),
          averageOrderValueGrowthPercent: metric(0),
          cancellationRate: metric(10),
          previousCancelledOrders: metric(1),
        }),
      }),
    );
    expect(below.anomalies.map((item) => item.type)).not.toContain("revenue_drop");
  });

  it("suppresses money rules for mixed currencies but keeps the order count rule", () => {
    const report = detectAnomalies(
      input({
        metrics: salesMetrics({
          currency: {
            value: null,
            availability: "unavailable",
            basis: null,
            reason: "mixed_currency",
          },
          revenueGrowthPercent: {
            value: null,
            availability: "unavailable",
            basis: null,
            reason: "mixed_currency",
          },
          averageOrderValueGrowthPercent: {
            value: null,
            availability: "unavailable",
            basis: null,
            reason: "mixed_currency",
          },
        }),
      }),
    );

    expect(report.anomalies.map((item) => item.type)).toContain("orders_drop");
    expect(report.anomalies.map((item) => item.type)).not.toContain("revenue_drop");
    expect(report.suppressed).toContainEqual({ rule: "revenue_drop", reason: "mixed_currency" });
    expect(report.suppressed).toContainEqual({ rule: "aov_change", reason: "mixed_currency" });
  });

  it("refuses every rule without a baseline window", () => {
    const report = detectAnomalies(input({ hasBaseline: false }));

    expect(report.baseline.available).toBe(false);
    expect(report.baseline.reason).toBe("no_baseline_period");
    expect(report.anomalies).toHaveLength(0);
  });

  it("refuses every rule when the baseline has too few orders", () => {
    const report = detectAnomalies(input({ metrics: salesMetrics({ previousOrders: metric(3) }) }));

    expect(report.anomalies).toHaveLength(0);
    expect(report.suppressed).toContainEqual({
      rule: "all",
      reason: "insufficient_baseline_orders",
    });
  });

  it("refuses every rule while a sync is failing", () => {
    const report = detectAnomalies(input({ syncIncomplete: true }));

    expect(report.anomalies).toHaveLength(0);
    expect(report.suppressed).toContainEqual({ rule: "all", reason: "orders_sync_incomplete" });
  });

  it("refuses every rule when orders were never synced", () => {
    const report = detectAnomalies(input({ ordersSynced: false }));
    expect(report.suppressed).toContainEqual({ rule: "all", reason: "orders_not_synced" });
  });

  it("refuses every rule for an empty store", () => {
    const report = detectAnomalies(
      input({ coverage: { ...COVERAGE, status: "empty", firstOrderAt: null, lastOrderAt: null } }),
    );
    expect(report.suppressed).toContainEqual({ rule: "all", reason: "no_orders_stored" });
  });

  it("produces stable ids and the compared windows in the payload", () => {
    const report = detectAnomalies(input());
    const anomaly = report.anomalies.find((item) => item.type === "revenue_drop")!;

    expect(anomaly.id).toBe("anomaly:revenue_drop:2026-09-22");
    expect(anomaly.period.previousFrom).toBe(PREVIOUS.from.toISOString());
    expect(anomaly.period.previousTo).toBe(PREVIOUS.to.toISOString());
    expect(anomaly.evidence.length).toBeGreaterThanOrEqual(3);
    expect(anomaly.recommendedAction.length).toBeGreaterThan(0);
  });
});
