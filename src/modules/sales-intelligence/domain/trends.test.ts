import { describe, expect, it } from "vitest";

import type { AnalysisPeriod } from "@/modules/intelligence/domain/types";
import { available } from "@/modules/intelligence/domain/types";

import { computeSalesTrends, type SalesOrderRow, type TrendInput } from "./trends";

const PERIOD: AnalysisPeriod = {
  key: "custom",
  from: new Date("2026-09-15T00:00:00.000Z"),
  to: new Date("2026-09-21T23:59:59.999Z"),
  days: 7,
};

function row(date: string, overrides: Partial<SalesOrderRow> = {}): SalesOrderRow {
  return {
    statusSlug: "completed",
    totalAmount: "100.00",
    currency: "SAR",
    draft: false,
    orderDate: new Date(date),
    ...overrides,
  };
}

function input(overrides: Partial<TrendInput> = {}): TrendInput {
  return {
    period: PERIOD,
    rows: [],
    granularity: "day",
    ordersSynced: true,
    syncIncomplete: false,
    firstOrderAt: new Date("2026-09-01T00:00:00.000Z"),
    currency: available("SAR", "test"),
    ...overrides,
  };
}

describe("sales trends", () => {
  it("emits one UTC bucket per day and clips them to the window", () => {
    const trends = computeSalesTrends(
      input({
        rows: [
          row("2026-09-15T10:00:00.000Z", { totalAmount: "100.00" }),
          row("2026-09-15T22:00:00.000Z", { totalAmount: "50.00" }),
          row("2026-09-21T09:00:00.000Z", { totalAmount: "300.00" }),
        ],
      }),
    );

    expect(trends.buckets).toHaveLength(7);
    expect(trends.buckets[0]?.key).toBe("2026-09-15");
    expect(trends.buckets[6]?.key).toBe("2026-09-21");
    expect(trends.buckets[0]?.from).toBe("2026-09-15T00:00:00.000Z");
    expect(trends.buckets[0]?.to).toBe("2026-09-15T23:59:59.999Z");

    expect(trends.buckets[0]?.orders.value).toBe(2);
    expect(trends.buckets[0]?.revenue.value).toBe(150);
    expect(trends.buckets[0]?.averageOrderValue.value).toBe(75);
    expect(trends.buckets[6]?.revenue.value).toBe(300);
  });

  it("starts weeks on Monday (UTC) and months on the first day", () => {
    const weekly = computeSalesTrends(input({ granularity: "week" }));
    expect(weekly.buckets).toHaveLength(2);
    expect(weekly.buckets[0]?.key).toBe("2026-09-14");
    expect(weekly.buckets[0]?.from).toBe("2026-09-15T00:00:00.000Z");
    expect(weekly.buckets[1]?.key).toBe("2026-09-21");

    const monthly = computeSalesTrends(
      input({
        period: {
          key: "custom",
          from: new Date("2026-09-15T00:00:00.000Z"),
          to: new Date("2026-10-15T00:00:00.000Z"),
          days: 31,
        },
        granularity: "month",
      }),
    );

    expect(monthly.buckets).toHaveLength(2);
    expect(monthly.buckets[0]?.key).toBe("2026-09-01");
    expect(monthly.buckets[1]?.key).toBe("2026-10-01");
  });

  it("refuses to render days that predate the stored history", () => {
    const trends = computeSalesTrends(
      input({ firstOrderAt: new Date("2026-09-17T12:00:00.000Z") }),
    );

    expect(trends.buckets[0]?.history).toBe("before_history");
    expect(trends.buckets[0]?.orders.value).toBeNull();
    expect(trends.buckets[0]?.orders.reason).toBe("outside_history");
    expect(trends.buckets[0]?.revenue.value).toBeNull();

    expect(trends.buckets[2]?.history).toBe("partial_history");
    expect(trends.buckets[2]?.orders.availability).toBe("partial");
    expect(trends.buckets[2]?.orders.reason).toBe("history_starts_mid_bucket");

    expect(trends.buckets[3]?.history).toBe("covered");
  });

  it("reports a truthful zero only for a covered empty day", () => {
    const trends = computeSalesTrends(input());
    const bucket = trends.buckets[0]!;

    expect(bucket.history).toBe("covered");
    expect(bucket.orders.value).toBe(0);
    expect(bucket.orders.availability).toBe("available");
    expect(bucket.revenue.value).toBe(0);
    expect(bucket.revenue.availability).toBe("available");
    expect(bucket.averageOrderValue.value).toBeNull();
    expect(bucket.averageOrderValue.reason).toBe("no_orders_in_period");
  });

  it("excludes drafts from counts and money", () => {
    const trends = computeSalesTrends(
      input({ rows: [row("2026-09-15T10:00:00.000Z", { draft: true, totalAmount: "999.00" })] }),
    );

    expect(trends.buckets[0]?.orders.value).toBe(0);
    expect(trends.buckets[0]?.revenue.value).toBe(0);
  });

  it("excludes canceled orders from revenue but keeps them in the count", () => {
    const trends = computeSalesTrends(
      input({
        rows: [
          row("2026-09-15T10:00:00.000Z", { statusSlug: "canceled", totalAmount: "50.00" }),
          row("2026-09-15T11:00:00.000Z", { totalAmount: "100.00" }),
        ],
      }),
    );

    expect(trends.buckets[0]?.orders.value).toBe(2);
    expect(trends.buckets[0]?.revenue.value).toBe(100);
  });

  it("refuses money for mixed currencies while keeping the counts", () => {
    const trends = computeSalesTrends(
      input({
        currency: {
          value: null,
          availability: "unavailable",
          basis: null,
          reason: "mixed_currency",
        },
        rows: [
          row("2026-09-15T10:00:00.000Z", { currency: "SAR" }),
          row("2026-09-15T11:00:00.000Z", { currency: "AED" }),
        ],
      }),
    );

    expect(trends.buckets[0]?.orders.value).toBe(2);
    expect(trends.buckets[0]?.revenue.value).toBeNull();
    expect(trends.buckets[0]?.revenue.reason).toBe("mixed_currency");
    expect(trends.buckets[0]?.averageOrderValue.reason).toBe("mixed_currency");
  });

  it("marks every bucket partial when the last sync failed", () => {
    const trends = computeSalesTrends(input({ syncIncomplete: true }));
    expect(trends.buckets.every((bucket) => bucket.orders.availability === "partial")).toBe(true);
  });

  it("marks buckets unavailable when orders were never synced", () => {
    const trends = computeSalesTrends(input({ ordersSynced: false, rows: [] }));
    expect(trends.buckets[0]?.orders.value).toBeNull();
    expect(trends.buckets[0]?.orders.reason).toBe("orders_not_synced");
  });

  it("marks revenue partial when an order inside the bucket has no total", () => {
    const trends = computeSalesTrends(
      input({
        rows: [
          row("2026-09-15T10:00:00.000Z", { totalAmount: "100.00" }),
          row("2026-09-15T11:00:00.000Z", { totalAmount: null, currency: null }),
        ],
      }),
    );

    expect(trends.buckets[0]?.revenue.value).toBe(100);
    expect(trends.buckets[0]?.revenue.availability).toBe("partial");
    expect(trends.buckets[0]?.revenue.reason).toBe("some_orders_missing_total");
  });

  it("aligns the previous window by bucket position", () => {
    const trends = computeSalesTrends(
      input({
        rows: [row("2026-09-15T10:00:00.000Z", { totalAmount: "100.00" })],
        previous: {
          period: {
            key: "custom",
            from: new Date("2026-09-08T00:00:00.000Z"),
            to: new Date("2026-09-14T23:59:59.999Z"),
            days: 7,
          },
          rows: [row("2026-09-08T10:00:00.000Z", { totalAmount: "80.00" })],
        },
      }),
    );

    expect(trends.previous).not.toBeNull();
    expect(trends.previous?.period.from).toBe("2026-09-08T00:00:00.000Z");
    expect(trends.previous?.buckets).toHaveLength(7);
    expect(trends.previous?.buckets[0]?.key).toBe("2026-09-08");
    expect(trends.previous?.buckets[0]?.revenue.value).toBe(80);
    expect(trends.buckets[0]?.revenue.value).toBe(100);
  });

  it("leaves the previous series null when no baseline was supplied", () => {
    expect(computeSalesTrends(input()).previous).toBeNull();
  });

  it("keeps the bucket order and the total consistent", () => {
    const trends = computeSalesTrends(
      input({
        rows: [
          row("2026-09-15T10:00:00.000Z", { totalAmount: "100.00" }),
          row("2026-09-16T10:00:00.000Z", { totalAmount: "200.00" }),
          row("2026-09-17T10:00:00.000Z", { totalAmount: "300.00" }),
        ],
      }),
    );

    const orders = trends.buckets.reduce((sum, bucket) => sum + (bucket.orders.value ?? 0), 0);
    const revenue = trends.buckets.reduce((sum, bucket) => sum + (bucket.revenue.value ?? 0), 0);

    expect(orders).toBe(3);
    expect(revenue).toBe(600);
  });
});
