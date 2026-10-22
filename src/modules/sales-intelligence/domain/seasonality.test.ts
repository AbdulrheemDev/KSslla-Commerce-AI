import { describe, expect, it } from "vitest";

import type { AnalysisPeriod } from "@/modules/intelligence/domain/types";
import { available } from "@/modules/intelligence/domain/types";

import { analyseSeasonality } from "./seasonality";
import type { TrendBucket } from "./trends";

const START = new Date("2026-08-02T00:00:00.000Z"); // a Sunday (UTC)
const DAY = 24 * 60 * 60 * 1000;

function periodOf(days: number): AnalysisPeriod {
  return {
    key: "custom",
    from: new Date(START),
    to: new Date(START.getTime() + days * DAY - 1),
    days,
  };
}

function buckets(
  days: number,
  revenueFor: (date: Date, index: number) => number,
  orders = 1,
): TrendBucket[] {
  return Array.from({ length: days }, (_, index) => {
    const from = new Date(START.getTime() + index * DAY);
    const to = new Date(from.getTime() + DAY - 1);
    const revenue = revenueFor(from, index);

    return {
      key: from.toISOString().slice(0, 10),
      from: from.toISOString(),
      to: to.toISOString(),
      history: "covered" as const,
      orders: available(orders, "test"),
      revenue: available(revenue, "test"),
      averageOrderValue: revenue === 0 ? available(0, "test") : available(revenue / orders, "test"),
      pricedOrders: orders,
    };
  });
}

function input(overrides: Partial<Parameters<typeof analyseSeasonality>[0]> = {}) {
  const period = periodOf(56);
  return {
    period,
    daily: buckets(56, (_date, index) => (index % 7 === 0 ? 1000 : 100)),
    ordersSynced: true,
    syncIncomplete: false,
    firstOrderAt: new Date(START),
    currency: available("SAR", "test"),
    ...overrides,
  };
}

describe("weekday seasonality", () => {
  it("refuses a window shorter than eight weeks", () => {
    const result = analyseSeasonality(
      input({ period: periodOf(30), daily: buckets(30, () => 100) }),
    );

    expect(result.available).toBe(false);
    expect(result.verdict).toBe("insufficient_history");
  });

  it("refuses when the history starts inside the window", () => {
    const result = analyseSeasonality(
      input({ firstOrderAt: new Date(START.getTime() + 10 * DAY) }),
    );

    expect(result.verdict).toBe("insufficient_history");
  });

  it("refuses when there are too few orders for a verdict", () => {
    const result = analyseSeasonality(input({ daily: buckets(56, () => 100, 0) }));

    expect(result.verdict).toBe("insufficient_orders");
    expect(result.observed.orders).toBe(0);
  });

  it("detects a strong weekday pattern with the exact indices", () => {
    const result = analyseSeasonality(input());

    expect(result.available).toBe(true);
    expect(result.verdict).toBe("pattern_detected");
    expect(result.strongest?.weekday).toBe(0); // Sunday
    expect(result.strongest?.index).toBeCloseTo(437.5, 1);
    // Six weekdays tie at the same index; the rule only needs "not Sunday".
    expect(result.weakest?.weekday).not.toBe(0);
    expect(result.weakest?.index).toBeCloseTo(43.8, 1);
    expect(result.contrastRatio).toBeCloseTo(10, 1);
    expect(result.weekdays.every((day) => day.occurrences === 8)).toBe(true);
  });

  it("says there is no clear pattern when every weekday looks the same", () => {
    const result = analyseSeasonality(input({ daily: buckets(56, () => 100) }));

    expect(result.available).toBe(true);
    expect(result.verdict).toBe("no_clear_pattern");
    expect(result.strongest).toBeNull();
    expect(result.weakest).toBeNull();
  });

  it("refuses a pattern when revenue is mixed currencies", () => {
    const result = analyseSeasonality(
      input({
        currency: {
          value: null,
          availability: "unavailable",
          basis: null,
          reason: "mixed_currency",
        },
      }),
    );

    expect(result.verdict).toBe("mixed_currency");
  });

  it("refuses when the orders were never synced", () => {
    const result = analyseSeasonality(input({ ordersSynced: false }));
    expect(result.verdict).toBe("orders_not_synced");
  });

  it("refuses when the last sync failed", () => {
    const result = analyseSeasonality(input({ syncIncomplete: true }));
    expect(result.verdict).toBe("orders_sync_incomplete");
  });

  it("refuses when no revenue is recognized despite orders", () => {
    const result = analyseSeasonality(input({ daily: buckets(56, () => 0) }));
    expect(result.verdict).toBe("no_recognized_revenue");
  });

  it("publishes the requirements it applied", () => {
    const result = analyseSeasonality(input());
    expect(result.requirements).toEqual({
      minDays: 56,
      minOccurrencesPerWeekday: 8,
      minOrders: 28,
      minContrastRatio: 1.25,
    });
  });
});
