import { describe, expect, it } from "vitest";

import { available, unavailable, type Metric } from "@/modules/intelligence/domain/types";

import { daysOfStockFrom, resolveDemand } from "./demand";

/**
 * `daysOfStock = quantity ÷ dailyDemand`, tested as a total function.
 *
 * The live pipeline always feeds it an unavailable demand; the numeric branches
 * exist so the model is reviewable and so a future documented source cannot
 * produce an Infinity or a negative silently.
 */

const demandOf = (value: number): Metric<number> => available(value, "units sold per day");

describe("days of stock", () => {
  it("reports unavailable while demand is unavailable, carrying the reason", () => {
    const metric = daysOfStockFrom({
      demand: resolveDemand().dailyDemand,
      quantity: 40,
      unlimitedQuantity: false,
    });

    expect(metric.value).toBeNull();
    expect(metric.availability).toBe("unavailable");
    expect(metric.reason).toBe("product_demand_not_linked");
  });

  it("divides stock by demand and rounds to one decimal", () => {
    expect(
      daysOfStockFrom({ demand: demandOf(3), quantity: 10, unlimitedQuantity: false }),
    ).toMatchObject({ value: 3.3, availability: "available", reason: null });
  });

  it("reports zero days for zero stock", () => {
    expect(
      daysOfStockFrom({ demand: demandOf(2), quantity: 0, unlimitedQuantity: false }).value,
    ).toBe(0);
  });

  it("refuses zero demand instead of returning Infinity", () => {
    const metric = daysOfStockFrom({
      demand: demandOf(0),
      quantity: 10,
      unlimitedQuantity: false,
    });

    expect(metric.value).toBeNull();
    expect(metric.reason).toBe("no_demand_in_window");
  });

  it("refuses negative demand", () => {
    expect(
      daysOfStockFrom({ demand: demandOf(-1), quantity: 10, unlimitedQuantity: false }).reason,
    ).toBe("invalid_demand");
  });

  it("refuses non-finite demand", () => {
    for (const value of [Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(
        daysOfStockFrom({ demand: demandOf(value), quantity: 10, unlimitedQuantity: false }).reason,
      ).toBe("invalid_demand");
    }
  });

  it("refuses a demand metric that has no value", () => {
    expect(
      daysOfStockFrom({
        demand: { value: null, availability: "partial", basis: "x", reason: null },
        quantity: 10,
        unlimitedQuantity: false,
      }).reason,
    ).toBe("invalid_demand");
  });

  it("refuses to give unlimited stock a finite runway", () => {
    expect(
      daysOfStockFrom({ demand: demandOf(5), quantity: 100, unlimitedQuantity: true }).reason,
    ).toBe("unlimited_stock");
  });

  it("never reports a fractional negative runway for negative stock", () => {
    // Negative stock is bad data, but the arithmetic still must not flip into a
    // positive "days remaining" figure.
    const metric = daysOfStockFrom({
      demand: demandOf(4),
      quantity: -8,
      unlimitedQuantity: false,
    });

    expect(metric.value).toBe(-2);
  });

  it("passes through an explicit reason instead of the default one", () => {
    const metric = daysOfStockFrom({
      demand: unavailable("some_future_reason"),
      quantity: 10,
      unlimitedQuantity: false,
    });

    expect(metric.reason).toBe("some_future_reason");
  });
});
