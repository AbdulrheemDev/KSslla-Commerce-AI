import type { Metric } from "@/modules/intelligence/domain/types";
import { available, partial, unavailable } from "@/modules/intelligence/domain/types";

/**
 * Customer intelligence — aggregate only.
 *
 * The output contains **no** names, e-mails, phones, addresses, or per-customer
 * rows. Everything is a count or an average, because the purpose is a store-level
 * picture and customer rows are personal data (ADR-042).
 *
 * `newCustomers` is deliberately `partial` when the mirror holds customers whose
 * `source_created_at` is unknown: Salla's `List Customers` payload does not
 * document `created_at` (only the order-embedded customer does), so a customer
 * discovered without an order has no creation date. Counting them as "new" would
 * mislabel a first sync as a spike of new customers.
 */

export interface CustomerMetricRow {
  id: string;
  sourceCreatedAt: Date | null;
}

export interface CustomerOrderAggregate {
  customerId: string;
  orders: number;
  /** Sum of order totals in the dominant currency; null when unusable. */
  total: number | null;
}

export interface CustomerInput {
  customers: readonly CustomerMetricRow[];
  aggregates: readonly CustomerOrderAggregate[];
  period: { from: Date; to: Date };
  customersSynced: boolean;
  customersSyncIncomplete: boolean;
  /** Single currency across the aggregated orders, or null when mixed/absent. */
  currency: string | null;
}

export interface CustomerIntelligence {
  customers: Metric<number>;
  newCustomers: Metric<number>;
  returningCustomers: Metric<number>;
  customersWithOrders: Metric<number>;
  ordersPerCustomer: Metric<number>;
  repeatPurchaseRate: Metric<number>;
  averageRevenuePerCustomer: Metric<number>;
  customerRevenue: Metric<number>;
  currency: string | null;
}

function percent(value: number): number {
  return Math.round(value * 10) / 10;
}

export function computeCustomerIntelligence(input: CustomerInput): CustomerIntelligence {
  const { customers, aggregates, period } = input;

  const knownIds = new Set(customers.map((row) => row.id));

  // Aggregates are keyed by local customer id, which only exists for orders
  // already linked during sync. Unlinked orders are not attributed to anyone.
  const linked = aggregates.filter((row) => knownIds.has(row.customerId));

  const withOrders = linked.filter((row) => row.orders > 0);
  const returning = withOrders.filter((row) => row.orders >= 2);

  const missingCreatedAt = customers.filter((row) => row.sourceCreatedAt === null).length;
  const newInPeriod = customers.filter(
    (row) =>
      row.sourceCreatedAt !== null &&
      row.sourceCreatedAt.getTime() >= period.from.getTime() &&
      row.sourceCreatedAt.getTime() <= period.to.getTime(),
  ).length;

  const totalOrders = withOrders.reduce((sum, row) => sum + row.orders, 0);
  const revenue = linked.every((row) => row.total !== null)
    ? linked.reduce((sum, row) => sum + (row.total ?? 0), 0)
    : null;

  const customersMetric: Metric<number> = !input.customersSynced
    ? unavailable("customers_not_synced")
    : input.customersSyncIncomplete
      ? partial(customers.length, "count(customers)", "customers_sync_incomplete")
      : available(customers.length, "count(customers)");

  const newCustomersMetric: Metric<number> =
    customers.length === 0
      ? input.customersSynced
        ? available(0, "count(customers where source_created_at in window)")
        : unavailable("customers_not_synced")
      : input.customersSynced
        ? missingCreatedAt > 0
          ? partial(
              newInPeriod,
              "count(customers where source_created_at in window)",
              "source_created_at_missing_for_some_customers",
            )
          : available(newInPeriod, "count(customers where source_created_at in window)")
        : unavailable("customers_not_synced");

  const withOrdersMetric: Metric<number> =
    withOrders.length === 0
      ? available(0, "count(customers with >=1 order)")
      : available(withOrders.length, "count(customers with >=1 order)");

  const returningMetric: Metric<number> = available(
    returning.length,
    "count(customers with >=2 orders)",
  );

  const ordersPerCustomer: Metric<number> =
    withOrders.length === 0
      ? unavailable("no_customers_with_orders")
      : available(
          Math.round((totalOrders / withOrders.length) * 10) / 10,
          "orders / customers_with_orders",
        );

  const repeatPurchaseRate: Metric<number> =
    withOrders.length === 0
      ? unavailable("no_customers_with_orders")
      : available(
          percent((returning.length / withOrders.length) * 100),
          "returning / customers_with_orders",
        );

  const customerRevenue: Metric<number> =
    linked.length === 0
      ? available(0, "sum(orders.total_amount for linked orders)")
      : input.currency === null
        ? unavailable("mixed_currency")
        : revenue === null
          ? partial(
              linked.reduce((sum, row) => sum + (row.total ?? 0), 0),
              "sum(orders.total_amount for linked orders)",
              "some_orders_missing_total",
            )
          : available(revenue, "sum(orders.total_amount for linked orders)");

  const averageRevenuePerCustomer: Metric<number> =
    withOrders.length === 0 || customerRevenue.value === null
      ? unavailable(
          customerRevenue.value === null ? "revenue_unavailable" : "no_customers_with_orders",
        )
      : available(
          Math.round(customerRevenue.value / withOrders.length),
          "customer_revenue / customers_with_orders",
        );

  return {
    customers: customersMetric,
    newCustomers: newCustomersMetric,
    returningCustomers: returningMetric,
    customersWithOrders: withOrdersMetric,
    ordersPerCustomer,
    repeatPurchaseRate,
    averageRevenuePerCustomer,
    customerRevenue,
    currency: input.currency,
  };
}
