import type { OrderMetricRow } from "@/modules/intelligence/domain/sales";
import { available, type Metric } from "@/modules/intelligence/domain/types";
import type { SalesOverviewMetrics } from "@/modules/sales-intelligence/domain/metrics";

/**
 * Deterministic fixtures for the sales-intelligence unit tests.
 *
 * The default snapshot describes a store whose revenue fell from 1,600 to
 * 1,000 between two equal windows (8 orders → 5, AOV 200 → 250, one
 * cancellation). Tests override individual fields so every assertion states the
 * exact number it depends on.
 */

export function metric<T>(value: T): Metric<T> {
  return available(value, "test_fixture");
}

export function order(overrides: Partial<OrderMetricRow> = {}): OrderMetricRow {
  return {
    statusSlug: "completed",
    totalAmount: "100.00",
    currency: "SAR",
    draft: false,
    ...overrides,
  };
}

export function salesMetrics(overrides: Partial<SalesOverviewMetrics> = {}): SalesOverviewMetrics {
  return {
    orders: metric(5),
    completedOrders: metric(3),
    cancelledOrders: metric(1),
    otherStatusOrders: metric(1),
    draftOrders: metric(0),
    cancellationRate: metric(20),
    recognizedRevenue: metric(1000),
    completedRevenue: metric(600),
    averageOrderValue: metric(250),
    currency: metric("SAR"),
    previousOrders: metric(8),
    previousCompletedOrders: metric(8),
    previousCancelledOrders: metric(0),
    previousRecognizedRevenue: metric(1600),
    previousAverageOrderValue: metric(200),
    ordersGrowthPercent: metric(-37.5),
    revenueGrowthPercent: metric(-37.5),
    averageOrderValueGrowthPercent: metric(25),
    ...overrides,
  };
}
