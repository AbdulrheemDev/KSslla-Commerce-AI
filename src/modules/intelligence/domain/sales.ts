import type { Metric } from "@/modules/intelligence/domain/types";
import { available, partial, unavailable } from "@/modules/intelligence/domain/types";

/**
 * Sales metrics.
 *
 * Definitions are deliberately narrow, because Salla documents no "sales"
 * endpoint for registered apps:
 *
 * - the population is the **non-draft** orders stored in the window;
 * - `completed` and `canceled` are the two status slugs shown in Salla's own
 *   order examples (List Orders, List Order Statuses). Every other slug —
 *   including merchant-created custom statuses — is counted as `other`, never
 *   guessed into "completed";
 * - money is summed **only** when every counted order shares one currency and
 *   has a total. Adding SAR to USD, or treating a missing total as zero, would
 *   be a fabricated number;
 * - `canceled` orders are counted in the order count but **excluded** from every
 *   money figure: a cancelled order is not revenue.
 */

export interface OrderMetricRow {
  statusSlug: string | null;
  totalAmount: string | null;
  currency: string | null;
  draft: boolean;
}

export interface SalesInput {
  current: readonly OrderMetricRow[];
  previous: readonly OrderMetricRow[];
  /** Has an orders sync ever succeeded for this store? */
  ordersSynced: boolean;
  /** True when the latest orders run failed or was cut short. */
  syncIncomplete: boolean;
  /** Is the previous window inside the stored history? */
  hasBaseline: boolean;
}

export interface SalesMetrics {
  orders: Metric<number>;
  completedOrders: Metric<number>;
  cancelledOrders: Metric<number>;
  otherStatusOrders: Metric<number>;
  totalOrderValue: Metric<number>;
  completedOrderValue: Metric<number>;
  averageOrderValue: Metric<number>;
  ordersGrowthPercent: Metric<number>;
  valueGrowthPercent: Metric<number>;
  currency: Metric<string>;
}

function amountOf(row: OrderMetricRow): number | null {
  if (row.totalAmount === null || row.currency === null) return null;
  const value = Number(row.totalAmount);
  return Number.isFinite(value) ? value : null;
}

function countMetric(value: number, synced: boolean, incomplete: boolean): Metric<number> {
  if (!synced) return unavailable("orders_not_synced");
  if (incomplete) return partial(value, "orders.status_filter", "orders_sync_incomplete");
  return available(value, "orders.status_filter");
}

function roundPercent(value: number): number {
  return Math.round(value * 10) / 10;
}

function growth(current: number, previous: number): Metric<number> {
  if (previous === 0) return unavailable("no_baseline_orders");
  return available(roundPercent(((current - previous) / previous) * 100), "period_over_period");
}

function moneySum(rows: readonly OrderMetricRow[]): number {
  return rows.reduce((total, row) => total + (amountOf(row) ?? 0), 0);
}

function currencySet(rows: readonly OrderMetricRow[]): Set<string> {
  return new Set(
    rows.map((row) => row.currency).filter((value): value is string => value !== null),
  );
}

export function computeSalesMetrics(input: SalesInput): SalesMetrics {
  const current = input.current.filter((row) => !row.draft);
  const previous = input.previous.filter((row) => !row.draft);

  const completed = current.filter((row) => row.statusSlug === "completed");
  const cancelled = current.filter((row) => row.statusSlug === "canceled");
  const other = current.filter(
    (row) => row.statusSlug !== "completed" && row.statusSlug !== "canceled",
  );

  const billable = current.filter((row) => row.statusSlug !== "canceled");
  const priced = billable.filter((row) => amountOf(row) !== null);
  const currencies = currencySet(priced);
  const completedPriced = completed.filter((row) => amountOf(row) !== null);
  const completedCurrencies = currencySet(completedPriced);

  const currency: Metric<string> =
    currencies.size === 0
      ? unavailable("no_order_totals")
      : currencies.size === 1
        ? available([...currencies][0]!, "orders.currency")
        : unavailable("mixed_currency");

  const missingTotals = billable.length - priced.length;

  const totalOrderValue: Metric<number> = !input.ordersSynced
    ? unavailable("orders_not_synced")
    : currencies.size > 1
      ? unavailable("mixed_currency")
      : currencies.size === 0
        ? unavailable("no_order_totals")
        : missingTotals > 0
          ? partial(
              moneySum(billable),
              "sum(orders.total_amount excluding canceled)",
              "some_orders_missing_total",
            )
          : available(moneySum(billable), "sum(orders.total_amount excluding canceled)");

  const completedOrderValue: Metric<number> = !input.ordersSynced
    ? unavailable("orders_not_synced")
    : completed.length === 0
      ? // No completed order is a real zero: the sum is empty by definition.
        available(0, "sum(orders.total_amount where status=completed)")
      : completedCurrencies.size > 1
        ? unavailable("mixed_currency")
        : completedCurrencies.size === 0
          ? unavailable("no_order_totals")
          : completedPriced.length < completed.length
            ? partial(
                moneySum(completed),
                "sum(orders.total_amount where status=completed)",
                "some_orders_missing_total",
              )
            : available(moneySum(completed), "sum(orders.total_amount where status=completed)");

  const averageOrderValue: Metric<number> = !input.ordersSynced
    ? unavailable("orders_not_synced")
    : priced.length === 0
      ? unavailable("no_order_totals")
      : currencies.size > 1
        ? unavailable("mixed_currency")
        : missingTotals > 0
          ? partial(
              roundPercent(moneySum(billable) / priced.length),
              "total_order_value / priced_orders",
              "some_orders_missing_total",
            )
          : available(
              roundPercent(moneySum(billable) / priced.length),
              "total_order_value / priced_orders",
            );

  const ordersGrowthPercent: Metric<number> = !input.ordersSynced
    ? unavailable<number>("orders_not_synced")
    : !input.hasBaseline
      ? unavailable<number>("no_baseline_period")
      : growth(current.length, previous.length);

  const previousBillable = previous.filter((row) => row.statusSlug !== "canceled");
  const previousPriced = previousBillable.filter((row) => amountOf(row) !== null);
  const previousCurrencies = currencySet(previousPriced);

  const valueGrowthPercent: Metric<number> = !input.ordersSynced
    ? unavailable<number>("orders_not_synced")
    : !input.hasBaseline
      ? unavailable<number>("no_baseline_period")
      : currencies.size !== 1 || previousCurrencies.size !== 1
        ? unavailable<number>(currencies.size > 1 ? "mixed_currency" : "no_order_totals")
        : previousPriced.length === 0
          ? unavailable<number>("no_baseline_orders")
          : growth(moneySum(billable), moneySum(previousBillable));

  return {
    orders: countMetric(current.length, input.ordersSynced, input.syncIncomplete),
    completedOrders: countMetric(completed.length, input.ordersSynced, input.syncIncomplete),
    cancelledOrders: countMetric(cancelled.length, input.ordersSynced, input.syncIncomplete),
    otherStatusOrders: countMetric(other.length, input.ordersSynced, input.syncIncomplete),
    totalOrderValue,
    completedOrderValue,
    averageOrderValue,
    ordersGrowthPercent,
    valueGrowthPercent,
    currency,
  };
}
