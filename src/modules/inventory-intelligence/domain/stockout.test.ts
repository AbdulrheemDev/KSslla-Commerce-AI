import { describe, expect, it } from "vitest";

import { available, unavailable, type Metric } from "@/modules/intelligence/domain/types";

import { riskFromDaysOfStock } from "./stockout";
import { INVENTORY_THRESHOLDS } from "./thresholds";

/**
 * The stockout bands are defined and tested, but unreachable live: without a
 * documented demand source `daysOfStock` is always unavailable, so the only risk
 * a request can produce today is `unknown` with a reason. The numeric bands are
 * tested so the model is reviewable before it is ever switched on.
 */
describe("stockout risk bands", () => {
  const days = (value: number | null): Metric<number> =>
    value === null
      ? unavailable("product_demand_not_linked")
      : { value, availability: "available", basis: "stock ÷ demand", reason: null };

  it("is unknown with the demand reason while days of stock are unavailable", () => {
    const assessment = riskFromDaysOfStock(unavailable("product_demand_not_linked"));

    expect(assessment.risk).toBe("unknown");
    expect(assessment.reason).toBe("product_demand_not_linked");
  });

  it("marks the critical boundary as critical, inclusively", () => {
    expect(riskFromDaysOfStock(days(0)).risk).toBe("critical");
    expect(riskFromDaysOfStock(days(INVENTORY_THRESHOLDS.STOCKOUT_CRITICAL_DAYS)).risk).toBe(
      "critical",
    );
  });

  it("marks just above critical as warning", () => {
    expect(riskFromDaysOfStock(days(INVENTORY_THRESHOLDS.STOCKOUT_CRITICAL_DAYS + 0.1)).risk).toBe(
      "warning",
    );
    expect(riskFromDaysOfStock(days(INVENTORY_THRESHOLDS.STOCKOUT_WARNING_DAYS)).risk).toBe(
      "warning",
    );
  });

  it("marks just above warning as watch", () => {
    expect(riskFromDaysOfStock(days(INVENTORY_THRESHOLDS.STOCKOUT_WARNING_DAYS + 0.1)).risk).toBe(
      "watch",
    );
    expect(riskFromDaysOfStock(days(INVENTORY_THRESHOLDS.STOCKOUT_WATCH_DAYS)).risk).toBe("watch");
  });

  it("marks above watch as normal", () => {
    expect(riskFromDaysOfStock(days(INVENTORY_THRESHOLDS.STOCKOUT_WATCH_DAYS + 0.1)).risk).toBe(
      "normal",
    );
    expect(riskFromDaysOfStock(days(365)).risk).toBe("normal");
  });

  it("rejects a non-finite day count", () => {
    const assessment = riskFromDaysOfStock(days(Number.POSITIVE_INFINITY));

    expect(assessment.risk).toBe("unknown");
    expect(assessment.reason).toBe("invalid_days_of_stock");
  });

  it("does not accept a partial metric as a number", () => {
    const assessment = riskFromDaysOfStock(available(2, "stock ÷ demand"));

    expect(assessment.risk).toBe("critical");
    expect(assessment.reason).toBeNull();
  });
});
