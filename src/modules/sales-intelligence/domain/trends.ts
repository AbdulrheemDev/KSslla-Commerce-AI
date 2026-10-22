import type { OrderMetricRow } from "@/modules/intelligence/domain/sales";
import type { AnalysisPeriod, Metric } from "@/modules/intelligence/domain/types";
import { available, partial, unavailable } from "@/modules/intelligence/domain/types";

import { SALES_THRESHOLDS } from "./thresholds";

/**
 * Time series over the requested window.
 *
 * Three rules shape this module:
 *
 * 1. **UTC everywhere.** Bucket boundaries are UTC midnights, matching the
 *    window definition in `intelligence/domain/period.ts`. A store-local day
 *    would need a timezone Salla does not document per store.
 * 2. **Missing history is not zero.** A bucket that ends before the first
 *    stored order is `unavailable("outside_history")`; a bucket that straddles
 *    the first order is `partial("history_starts_mid_bucket")`. Only a fully
 *    covered bucket may report a zero.
 * 3. **No interpolation.** A bucket either has a number or a reason. The chart
 *    renders a gap, not a line drawn through invented values.
 */

export type TrendGranularity = "day" | "week" | "month";

export const TREND_GRANULARITIES: readonly TrendGranularity[] = ["day", "week", "month"];

export type BucketHistory = "before_history" | "partial_history" | "covered";

export interface SalesOrderRow extends OrderMetricRow {
  orderDate: Date | null;
}

export interface TrendBucket {
  /** UTC start date of the bucket, `YYYY-MM-DD`. */
  key: string;
  from: string;
  to: string;
  history: BucketHistory;
  orders: Metric<number>;
  revenue: Metric<number>;
  averageOrderValue: Metric<number>;
  /** Orders in the bucket that carry a usable total (the AOV denominator). */
  pricedOrders: number;
}

export interface TrendInput {
  period: AnalysisPeriod;
  rows: readonly SalesOrderRow[];
  granularity: TrendGranularity;
  ordersSynced: boolean;
  syncIncomplete: boolean;
  firstOrderAt: Date | null;
  /** Currency of the window, from the Phase 07 sales metrics. */
  currency: Metric<string>;
  /**
   * Equal-length window immediately before `period`, when the caller has it.
   * Buckets are compared **by position**, which is exact for equal-length
   * windows and avoids inventing a date alignment Salla does not define.
   */
  previous?: {
    period: AnalysisPeriod;
    rows: readonly SalesOrderRow[];
  };
}

export interface SalesTrends {
  granularity: TrendGranularity;
  buckets: TrendBucket[];
  /** Previous-window series aligned by index; `null` when no baseline exists. */
  previous: {
    period: { from: string; to: string };
    buckets: TrendBucket[];
  } | null;
  currency: Metric<string>;
  /** Points dropped by the safety cap (always 0 for the supported ranges). */
  truncated: boolean;
}

const DAY_MS = 24 * 60 * 60 * 1000;

function utcDayStart(value: Date): Date {
  return new Date(Date.UTC(value.getUTCFullYear(), value.getUTCMonth(), value.getUTCDate()));
}

function isoDay(value: Date): string {
  return value.toISOString().slice(0, 10);
}

export function bucketStartOf(value: Date, granularity: TrendGranularity): Date {
  const day = utcDayStart(value);

  if (granularity === "day") return day;
  if (granularity === "month") {
    return new Date(Date.UTC(value.getUTCFullYear(), value.getUTCMonth(), 1));
  }

  // Week starts on Monday (UTC): Sunday (0) moves back 6 days, Monday (1) stays.
  const offset = (day.getUTCDay() + 6) % 7;
  return new Date(day.getTime() - offset * DAY_MS);
}

function nextBucket(start: Date, granularity: TrendGranularity): Date {
  if (granularity === "day") return new Date(start.getTime() + DAY_MS);
  if (granularity === "week") return new Date(start.getTime() + 7 * DAY_MS);
  return new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + 1, 1));
}

function amountOf(row: OrderMetricRow): number | null {
  if (row.totalAmount === null || row.currency === null) return null;
  const value = Number(row.totalAmount);
  return Number.isFinite(value) ? value : null;
}

function roundMoney(value: number): number {
  return Math.round(value * 100) / 100;
}

function historyOf(from: Date, to: Date, firstOrderAt: Date | null): BucketHistory {
  if (!firstOrderAt) return "covered";
  if (to.getTime() < firstOrderAt.getTime()) return "before_history";
  if (from.getTime() < firstOrderAt.getTime()) return "partial_history";
  return "covered";
}

interface BucketMetrics {
  orders: Metric<number>;
  revenue: Metric<number>;
  averageOrderValue: Metric<number>;
  pricedOrders: number;
}

function metricsForBucket(
  rows: readonly SalesOrderRow[],
  history: BucketHistory,
  input: TrendInput,
  windowMixedCurrency: boolean,
): BucketMetrics {
  const counted = rows.filter((row) => !row.draft);

  const orders: Metric<number> = !input.ordersSynced
    ? unavailable("orders_not_synced", "count(orders) in bucket")
    : history === "before_history"
      ? unavailable("outside_history", "count(orders) in bucket")
      : history === "partial_history"
        ? partial(counted.length, "count(orders) in bucket", "history_starts_mid_bucket")
        : input.syncIncomplete
          ? partial(counted.length, "count(orders) in bucket", "orders_sync_incomplete")
          : available(counted.length, "count(orders) in bucket");

  const billable = counted.filter((row) => row.statusSlug !== "canceled");

  const revenue: Metric<number> = (() => {
    if (!input.ordersSynced) return unavailable("orders_not_synced", "sum(total_amount) in bucket");
    if (history === "before_history") {
      return unavailable("outside_history", "sum(total_amount) in bucket");
    }
    if (windowMixedCurrency) return unavailable("mixed_currency", "sum(total_amount) in bucket");

    if (billable.length === 0) {
      return history === "partial_history"
        ? partial(0, "sum(total_amount) in bucket", "history_starts_mid_bucket")
        : available(0, "sum(total_amount) in bucket");
    }

    if (input.currency.value === null) {
      return unavailable(input.currency.reason ?? "no_order_totals", "sum(total_amount) in bucket");
    }

    const amounts = billable.map(amountOf);
    const missing = amounts.filter((amount) => amount === null).length;
    const total = roundMoney(amounts.reduce<number>((sum, amount) => sum + (amount ?? 0), 0));

    if (missing > 0) {
      return partial(total, "sum(total_amount) in bucket", "some_orders_missing_total");
    }

    return history === "partial_history"
      ? partial(total, "sum(total_amount) in bucket", "history_starts_mid_bucket")
      : available(total, "sum(total_amount) in bucket");
  })();

  const priced = billable.filter((row) => amountOf(row) !== null).length;

  const averageOrderValue: Metric<number> =
    revenue.value === null
      ? unavailable(revenue.reason ?? "revenue_unavailable", "bucket_revenue / priced_orders")
      : priced === 0
        ? unavailable("no_orders_in_period", "bucket_revenue / priced_orders")
        : revenue.availability === "partial"
          ? partial(
              roundMoney(revenue.value / priced),
              "bucket_revenue / priced_orders",
              revenue.reason ?? "some_orders_missing_total",
            )
          : available(roundMoney(revenue.value / priced), "bucket_revenue / priced_orders");

  return { orders, revenue, averageOrderValue, pricedOrders: priced };
}

function buildBuckets(
  period: AnalysisPeriod,
  rows: readonly SalesOrderRow[],
  input: TrendInput,
  windowMixedCurrency: boolean,
): TrendBucket[] {
  const buckets: TrendBucket[] = [];
  let start = bucketStartOf(period.from, input.granularity);

  while (start.getTime() <= period.to.getTime()) {
    const rawEnd = new Date(nextBucket(start, input.granularity).getTime() - 1);
    const from = new Date(Math.max(start.getTime(), period.from.getTime()));
    const to = new Date(Math.min(rawEnd.getTime(), period.to.getTime()));

    const inBucket = rows.filter(
      (row) =>
        row.orderDate !== null &&
        row.orderDate.getTime() >= from.getTime() &&
        row.orderDate.getTime() <= to.getTime(),
    );

    const history = historyOf(from, to, input.firstOrderAt);
    const metrics = metricsForBucket(inBucket, history, input, windowMixedCurrency);

    buckets.push({
      key: isoDay(start),
      from: from.toISOString(),
      to: to.toISOString(),
      history,
      ...metrics,
    });

    if (buckets.length >= SALES_THRESHOLDS.TREND_MAX_BUCKETS) break;
    start = nextBucket(start, input.granularity);
  }

  return buckets;
}

export function computeSalesTrends(input: TrendInput): SalesTrends {
  const windowMixedCurrency = input.currency.reason === "mixed_currency";

  const buckets = buildBuckets(input.period, input.rows, input, windowMixedCurrency);

  const previous =
    input.previous && input.previous.rows.length >= 0
      ? {
          period: {
            from: input.previous.period.from.toISOString(),
            to: input.previous.period.to.toISOString(),
          },
          buckets: buildBuckets(
            input.previous.period,
            input.previous.rows,
            input,
            windowMixedCurrency,
          ),
        }
      : null;

  return {
    granularity: input.granularity,
    buckets,
    previous,
    currency: input.currency,
    truncated: buckets.length >= SALES_THRESHOLDS.TREND_MAX_BUCKETS,
  };
}
