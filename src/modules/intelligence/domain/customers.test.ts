import { describe, expect, it } from "vitest";

import {
  computeCustomerIntelligence,
  type CustomerMetricRow,
  type CustomerOrderAggregate,
} from "@/modules/intelligence/domain/customers";

const PERIOD = {
  from: new Date("2026-09-22T00:00:00.000Z"),
  to: new Date("2026-10-22T00:00:00.000Z"),
};
const SYNCED = { customersSynced: true, customersSyncIncomplete: false };

function customer(id: string, createdAt: string | null): CustomerMetricRow {
  return { id, sourceCreatedAt: createdAt ? new Date(createdAt) : null };
}

function aggregate(
  customerId: string,
  orders: number,
  total: number | null,
): CustomerOrderAggregate {
  return { customerId, orders, total };
}

describe("computeCustomerIntelligence", () => {
  it("counts customers, repeat buyers, and average orders", () => {
    const result = computeCustomerIntelligence({
      customers: [
        customer("a", "2026-10-01T00:00:00.000Z"),
        customer("b", "2025-01-01T00:00:00.000Z"),
        customer("c", null),
        customer("d", "2025-05-01T00:00:00.000Z"),
      ],
      aggregates: [
        aggregate("a", 3, 300),
        aggregate("b", 1, 100),
        aggregate("c", 2, 50),
        // d has a customer row but no order
      ],
      period: PERIOD,
      ...SYNCED,
      currency: "SAR",
    });

    expect(result.customers.value).toBe(4);
    expect(result.customersWithOrders.value).toBe(3);
    expect(result.returningCustomers.value).toBe(2);
    expect(result.ordersPerCustomer.value).toBe(2);
    expect(result.repeatPurchaseRate.value).toBe(66.7);
    expect(result.customerRevenue.value).toBe(450);
    expect(result.averageRevenuePerCustomer.value).toBe(150);
  });

  it("does not count customers with unknown creation dates as new", () => {
    const result = computeCustomerIntelligence({
      customers: [customer("a", "2026-10-01T00:00:00.000Z"), customer("b", null)],
      aggregates: [],
      period: PERIOD,
      ...SYNCED,
      currency: null,
    });

    expect(result.newCustomers.value).toBe(1);
    expect(result.newCustomers.availability).toBe("partial");
    expect(result.newCustomers.reason).toBe("source_created_at_missing_for_some_customers");
  });

  it("excludes creation dates outside the window", () => {
    const result = computeCustomerIntelligence({
      customers: [
        customer("a", "2026-10-01T00:00:00.000Z"),
        customer("b", "2026-08-01T00:00:00.000Z"),
      ],
      aggregates: [],
      period: PERIOD,
      ...SYNCED,
      currency: null,
    });

    expect(result.newCustomers.value).toBe(1);
    expect(result.newCustomers.availability).toBe("available");
  });

  it("avoids division by zero when nobody ordered", () => {
    const result = computeCustomerIntelligence({
      customers: [customer("a", null)],
      aggregates: [],
      period: PERIOD,
      ...SYNCED,
      currency: null,
    });

    expect(result.ordersPerCustomer.reason).toBe("no_customers_with_orders");
    expect(result.repeatPurchaseRate.reason).toBe("no_customers_with_orders");
    expect(result.averageRevenuePerCustomer.reason).toBe("no_customers_with_orders");
  });

  it("refuses revenue across mixed currencies", () => {
    const result = computeCustomerIntelligence({
      customers: [customer("a", null)],
      aggregates: [aggregate("a", 1, 100), aggregate("a", 1, 100)],
      period: PERIOD,
      ...SYNCED,
      currency: null,
    });

    expect(result.customerRevenue.reason).toBe("mixed_currency");
    expect(result.averageRevenuePerCustomer.value).toBeNull();
  });

  it("marks customer counts partial when the sync failed", () => {
    const result = computeCustomerIntelligence({
      customers: [customer("a", null)],
      aggregates: [],
      period: PERIOD,
      customersSynced: true,
      customersSyncIncomplete: true,
      currency: null,
    });

    expect(result.customers.availability).toBe("partial");
    expect(result.customers.reason).toBe("customers_sync_incomplete");
  });

  it("is unavailable when customers were never synced", () => {
    const result = computeCustomerIntelligence({
      customers: [],
      aggregates: [],
      period: PERIOD,
      customersSynced: false,
      customersSyncIncomplete: false,
      currency: null,
    });

    expect(result.customers.reason).toBe("customers_not_synced");
    expect(result.newCustomers.reason).toBe("customers_not_synced");
  });

  it("returns only aggregates, never identity fields", () => {
    const result = computeCustomerIntelligence({
      customers: [customer("a", null)],
      aggregates: [aggregate("a", 1, 100)],
      period: PERIOD,
      ...SYNCED,
      currency: "SAR",
    });

    const serialised = JSON.stringify(result);
    expect(serialised).not.toContain("email");
    expect(serialised).not.toContain("mobile");
    expect(serialised).not.toContain("address");
    expect(Object.keys(result)).not.toContain("items");
  });
});
