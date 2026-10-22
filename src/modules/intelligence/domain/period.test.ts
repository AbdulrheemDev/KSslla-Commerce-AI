import { describe, expect, it } from "vitest";

import {
  InvalidPeriodError,
  computeCoverage,
  hasPreviousBaseline,
  previousPeriod,
  resolvePeriod,
  toPeriodView,
} from "@/modules/intelligence/domain/period";

/**
 * Windows are UTC and bounded. These tests pin the boundaries because an
 * off-by-one day silently changes every growth number.
 */

const NOW = new Date("2026-10-22T12:00:00.000Z");

describe("resolvePeriod", () => {
  it("defaults to 30 days", () => {
    const period = resolvePeriod({}, NOW);

    expect(period.key).toBe("30d");
    expect(period.days).toBe(30);
    expect(period.to.toISOString()).toBe(NOW.toISOString());
    expect(period.from.toISOString()).toBe("2026-09-22T12:00:00.000Z");
  });

  it("starts `today` at UTC midnight", () => {
    const period = resolvePeriod({ period: "today" }, NOW);

    expect(period.days).toBe(1);
    expect(period.from.toISOString()).toBe("2026-10-22T00:00:00.000Z");
    expect(period.to.toISOString()).toBe(NOW.toISOString());
  });

  it("supports 7d and 90d", () => {
    expect(resolvePeriod({ period: "7d" }, NOW).from.toISOString()).toBe(
      "2026-10-15T12:00:00.000Z",
    );
    expect(resolvePeriod({ period: "90d" }, NOW).from.toISOString()).toBe(
      "2026-07-24T12:00:00.000Z",
    );
  });

  it("accepts an inclusive custom range", () => {
    const period = resolvePeriod({ period: "custom", from: "2026-10-01", to: "2026-10-07" }, NOW);

    expect(period.days).toBe(7);
    expect(period.from.toISOString()).toBe("2026-10-01T00:00:00.000Z");
    expect(period.to.toISOString()).toBe("2026-10-07T23:59:59.999Z");
  });

  it("rejects unsupported, malformed, and impossible dates", () => {
    for (const request of [
      { period: "1y" },
      { period: "custom" },
      { period: "custom", from: "2026-10-01" },
      { period: "custom", from: "2026-02-31", to: "2026-03-01" },
      { period: "custom", from: "2026-10-02", to: "2026-10-01" },
      { period: "custom", from: "2026-01-01", to: "2027-06-01" },
    ]) {
      expect(() => resolvePeriod(request, NOW)).toThrow(InvalidPeriodError);
    }
  });

  it("exposes a serialisable view", () => {
    const view = toPeriodView(resolvePeriod({ period: "7d" }, NOW));

    expect(view).toEqual({
      key: "7d",
      from: "2026-10-15T12:00:00.000Z",
      to: "2026-10-22T12:00:00.000Z",
      days: 7,
    });
  });
});

describe("previousPeriod", () => {
  it("is the equal-length window immediately before", () => {
    const period = resolvePeriod({ period: "7d" }, NOW);
    const previous = previousPeriod(period);

    expect(previous.from.toISOString()).toBe("2026-10-08T12:00:00.000Z");
    expect(previous.to.getTime()).toBe(period.from.getTime() - 1);
  });
});

describe("computeCoverage", () => {
  const period = resolvePeriod({ period: "30d" }, NOW);

  it("is empty when no order is stored", () => {
    const coverage = computeCoverage({
      period,
      totalOrders: 0,
      firstOrderAt: null,
      lastOrderAt: null,
      ordersSyncIncomplete: false,
    });

    expect(coverage.status).toBe("empty");
    expect(coverage.notes).toContain("no_orders_stored");
  });

  it("is complete when history starts before the window and the sync finished", () => {
    const coverage = computeCoverage({
      period,
      totalOrders: 100,
      firstOrderAt: new Date("2025-01-01T00:00:00.000Z"),
      lastOrderAt: new Date("2026-10-20T00:00:00.000Z"),
      ordersSyncIncomplete: false,
    });

    expect(coverage.status).toBe("complete");
    expect(coverage.notes).toHaveLength(0);
  });

  it("is partial when history starts inside the window", () => {
    const coverage = computeCoverage({
      period,
      totalOrders: 10,
      firstOrderAt: new Date("2026-10-15T00:00:00.000Z"),
      lastOrderAt: new Date("2026-10-20T00:00:00.000Z"),
      ordersSyncIncomplete: false,
    });

    expect(coverage.status).toBe("partial");
    expect(coverage.notes).toContain("history_starts_after_window");
  });

  it("is partial when the latest orders sync failed", () => {
    const coverage = computeCoverage({
      period,
      totalOrders: 10,
      firstOrderAt: new Date("2025-01-01T00:00:00.000Z"),
      lastOrderAt: new Date("2026-10-20T00:00:00.000Z"),
      ordersSyncIncomplete: true,
    });

    expect(coverage.notes).toEqual(["orders_sync_incomplete"]);
  });
});

describe("hasPreviousBaseline", () => {
  const period = resolvePeriod({ period: "7d" }, NOW);

  it("requires history to reach the start of the previous window", () => {
    expect(hasPreviousBaseline(period, new Date("2026-10-01T00:00:00.000Z"), false)).toBe(true);
    expect(hasPreviousBaseline(period, new Date("2026-10-12T00:00:00.000Z"), false)).toBe(false);
    expect(hasPreviousBaseline(period, null, false)).toBe(false);
  });

  it("is false when the sync did not complete", () => {
    expect(hasPreviousBaseline(period, new Date("2026-01-01T00:00:00.000Z"), true)).toBe(false);
  });
});
