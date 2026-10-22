import { computeSalesMetrics, type OrderMetricRow } from "@/modules/intelligence/domain/sales";
import type { Metric } from "@/modules/intelligence/domain/types";
import { available, partial, unavailable } from "@/modules/intelligence/domain/types";

/**
 * Sales metrics for Phase 08.
 *
 * Phase 07 already defines how an order becomes a number: the population is the
 * non-draft orders in the window, `completed`/`canceled` are the only slugs read
 * by name, canceled orders stay out of every money figure, and money is summed
 * only when a single currency is present and every counted order has a total.
 * This module **wraps those rules** instead of restating them:
 *
 * - `currentRun` is exactly Phase 07's `computeSalesMetrics` for the window;
 * - `previousRun` is the same function applied to the previous window, which is
 *   how the "previous period" numbers keep the same availability semantics.
 *
 * What Phase 08 adds on top: draft-order counting (Phase 07 hides drafts from
 * every metric), cancellation rate, and AOV growth. No rule about zero, partial,
 * mixed currency, or baseline is re-implemented here.
 */

export interface SalesOverviewInput {
  current: readonly OrderMetricRow[];
  previous: readonly OrderMetricRow[];
  ordersSynced: boolean;
  syncIncomplete: boolean;
  hasBaseline: boolean;
}

export interface SalesOverviewMetrics {
  /** Non-draft orders in the window. */
  orders: Metric<number>;
  completedOrders: Metric<number>;
  cancelledOrders: Metric<number>;
  otherStatusOrders: Metric<number>;
  /** Orders the provider marks `draft: true`; counted, never summed. */
  draftOrders: Metric<number>;
  /** `cancelledOrders / orders × 100`, a count ratio, not a money figure. */
  cancellationRate: Metric<number>;
  /** Sum of totals for non-draft, non-canceled, usable, single-currency orders. */
  recognizedRevenue: Metric<number>;
  completedRevenue: Metric<number>;
  averageOrderValue: Metric<number>;
  currency: Metric<string>;

  /** Same measurements on the immediately preceding window. */
  previousOrders: Metric<number>;
  previousCompletedOrders: Metric<number>;
  previousCancelledOrders: Metric<number>;
  previousRecognizedRevenue: Metric<number>;
  previousAverageOrderValue: Metric<number>;

  ordersGrowthPercent: Metric<number>;
  revenueGrowthPercent: Metric<number>;
  averageOrderValueGrowthPercent: Metric<number>;
}

function roundPercent(value: number): number {
  return Math.round(value * 10) / 10;
}

/** Keeps a metric but replaces its value with "no baseline" when there is none. */
function requireBaseline<T>(metric: Metric<T>, hasBaseline: boolean): Metric<T> {
  if (hasBaseline) return metric;
  return unavailable<T>("no_baseline_period", metric.basis);
}

export function computeSalesOverview(input: SalesOverviewInput): SalesOverviewMetrics {
  const currentRun = computeSalesMetrics({
    current: input.current,
    previous: input.previous,
    ordersSynced: input.ordersSynced,
    syncIncomplete: input.syncIncomplete,
    hasBaseline: input.hasBaseline,
  });

  const previousRun = computeSalesMetrics({
    current: input.previous,
    previous: [],
    ordersSynced: input.ordersSynced,
    // A failed run affected the latest window; the previous window's rows are
    // whatever survived. Treating them as complete would overstate the baseline.
    syncIncomplete: false,
    hasBaseline: false,
  });

  const counted = input.current.filter((row) => !row.draft).length;
  const drafts = input.current.filter((row) => row.draft).length;

  const draftOrders: Metric<number> = !input.ordersSynced
    ? unavailable("orders_not_synced", "count(orders where draft = true)")
    : input.syncIncomplete
      ? partial(drafts, "count(orders where draft = true)", "orders_sync_incomplete")
      : available(drafts, "count(orders where draft = true)");

  const cancelled = currentRun.cancelledOrders.value;

  const cancellationRate: Metric<number> =
    cancelled === null
      ? unavailable<number>("orders_not_synced", "cancelled_orders / orders × 100")
      : counted === 0
        ? unavailable<number>("no_orders_in_period", "cancelled_orders / orders × 100")
        : input.syncIncomplete
          ? partial(
              roundPercent((cancelled / counted) * 100),
              "cancelled_orders / orders × 100",
              "orders_sync_incomplete",
            )
          : available(roundPercent((cancelled / counted) * 100), "cancelled_orders / orders × 100");

  const aovGrowth: Metric<number> = (() => {
    if (!input.ordersSynced) return unavailable("orders_not_synced", "aov_period_over_period");
    if (!input.hasBaseline) return unavailable("no_baseline_period", "aov_period_over_period");

    const current = currentRun.averageOrderValue;
    const previous = previousRun.averageOrderValue;

    if (current.value === null) return unavailable(current.reason ?? "no_order_totals");
    if (previous.value === null) {
      return unavailable(
        previous.reason === "no_order_totals"
          ? "no_baseline_orders"
          : (previous.reason ?? "no_baseline_orders"),
        "aov_period_over_period",
      );
    }
    if (previous.value === 0) return unavailable("no_baseline_orders", "aov_period_over_period");
    if (currentRun.currency.value !== previousRun.currency.value) {
      return unavailable("mixed_currency", "aov_period_over_period");
    }

    return available(
      roundPercent(((current.value - previous.value) / previous.value) * 100),
      "aov_period_over_period",
    );
  })();

  return {
    orders: currentRun.orders,
    completedOrders: currentRun.completedOrders,
    cancelledOrders: currentRun.cancelledOrders,
    otherStatusOrders: currentRun.otherStatusOrders,
    draftOrders,
    cancellationRate,
    recognizedRevenue: currentRun.totalOrderValue,
    completedRevenue: currentRun.completedOrderValue,
    averageOrderValue: currentRun.averageOrderValue,
    currency: currentRun.currency,
    previousOrders: requireBaseline(previousRun.orders, input.hasBaseline),
    previousCompletedOrders: requireBaseline(previousRun.completedOrders, input.hasBaseline),
    previousCancelledOrders: requireBaseline(previousRun.cancelledOrders, input.hasBaseline),
    previousRecognizedRevenue: requireBaseline(previousRun.totalOrderValue, input.hasBaseline),
    previousAverageOrderValue: requireBaseline(previousRun.averageOrderValue, input.hasBaseline),
    ordersGrowthPercent: currentRun.ordersGrowthPercent,
    revenueGrowthPercent: currentRun.valueGrowthPercent,
    averageOrderValueGrowthPercent: aovGrowth,
  };
}

/** Metric names in one place, so the UI, CSV, and docs cannot drift apart. */
export const SALES_METRIC_LABELS_AR = {
  orders: "الطلبات",
  completedOrders: "طلبات مكتملة",
  cancelledOrders: "طلبات ملغاة",
  otherStatusOrders: "طلبات بحالات أخرى",
  draftOrders: "مسودّات",
  cancellationRate: "نسبة الإلغاء",
  recognizedRevenue: "الإيراد المعتمد",
  completedRevenue: "إيراد الطلبات المكتملة",
  averageOrderValue: "متوسط قيمة الطلب",
  previousOrders: "طلبات الفترة السابقة",
  previousCompletedOrders: "طلبات مكتملة في الفترة السابقة",
  previousCancelledOrders: "طلبات ملغاة في الفترة السابقة",
  previousRecognizedRevenue: "إيراد الفترة السابقة",
  previousAverageOrderValue: "متوسط الفترة السابقة",
  ordersGrowthPercent: "نمو عدد الطلبات",
  revenueGrowthPercent: "نمو الإيراد",
  averageOrderValueGrowthPercent: "نمو متوسط قيمة الطلب",
} as const;

export type SalesMetricKey = keyof typeof SALES_METRIC_LABELS_AR;

export function salesMetricEntries(
  metrics: SalesOverviewMetrics,
): Array<{ key: SalesMetricKey; label: string; metric: Metric<number> }> {
  return (Object.keys(SALES_METRIC_LABELS_AR) as SalesMetricKey[]).map((key) => ({
    key,
    label: SALES_METRIC_LABELS_AR[key],
    metric: metrics[key],
  }));
}
