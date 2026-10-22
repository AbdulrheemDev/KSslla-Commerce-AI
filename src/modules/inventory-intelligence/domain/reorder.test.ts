import { describe, expect, it } from "vitest";

import { available, unavailable } from "@/modules/intelligence/domain/types";

import { computeReorder, resolveReorder, REORDER_MISSING_INPUTS } from "./reorder";

/**
 * The reorder model, and the fact that it cannot run on this data.
 *
 * Two layers are tested: the live resolution (nothing is configured, so nothing is
 * computed) and the arithmetic itself (so the contract is reviewable and a future
 * phase can supply the three inputs without redesigning it).
 */

describe("live reorder resolution", () => {
  it("reports the exact missing inputs, in a stable order", () => {
    const result = resolveReorder();

    expect(result.quantity.value).toBeNull();
    expect(result.quantity.availability).toBe("unavailable");
    expect(result.quantity.reason).toBe("product_demand_not_linked");
    expect(result.missing).toEqual([...REORDER_MISSING_INPUTS]);
  });

  it("never suggests a quantity without all three inputs", () => {
    for (const missing of ["leadTimeDays", "safetyStockDays"] as const) {
      const result = computeReorder({
        demand: available(2, "units/day"),
        leadTimeDays: missing === "leadTimeDays" ? null : 7,
        safetyStockDays: missing === "safetyStockDays" ? null : 3,
        availableStock: 10,
        unlimitedQuantity: false,
      });

      expect(result.quantity.value).toBeNull();
      expect(result.missing).not.toHaveLength(0);
    }
  });
});

describe("reorder model arithmetic", () => {
  it("suggests cover minus stock, rounded up to whole units", () => {
    const result = computeReorder({
      demand: available(1.5, "units/day"),
      leadTimeDays: 7,
      safetyStockDays: 3,
      availableStock: 4,
      unlimitedQuantity: false,
    });

    // 1.5 × 10 = 15; 15 − 4 = 11
    expect(result.quantity).toMatchObject({ value: 11, availability: "available" });
    expect(result.missing).toEqual([]);
  });

  it("rounds a fractional need up, never down", () => {
    const result = computeReorder({
      demand: available(0.35, "units/day"),
      leadTimeDays: 5,
      safetyStockDays: 2,
      availableStock: 1,
      unlimitedQuantity: false,
    });

    // 0.35 × 7 = 2.45; 2.45 − 1 = 1.45 → 2
    expect(result.quantity.value).toBe(2);
  });

  it("never suggests a negative order when stock already covers the target", () => {
    const result = computeReorder({
      demand: available(1, "units/day"),
      leadTimeDays: 3,
      safetyStockDays: 1,
      availableStock: 100,
      unlimitedQuantity: false,
    });

    expect(result.quantity.value).toBe(0);
  });

  it("refuses to reorder unlimited stock", () => {
    const result = computeReorder({
      demand: available(1, "units/day"),
      leadTimeDays: 3,
      safetyStockDays: 1,
      availableStock: 0,
      unlimitedQuantity: true,
    });

    expect(result.quantity.reason).toBe("unlimited_stock");
  });

  it("refuses to compute without a stock figure", () => {
    const result = computeReorder({
      demand: available(1, "units/day"),
      leadTimeDays: 3,
      safetyStockDays: 1,
      availableStock: null,
      unlimitedQuantity: false,
    });

    expect(result.quantity.reason).toBe("inventory_record_missing");
  });

  it("rejects a negative lead time or safety stock", () => {
    const result = computeReorder({
      demand: available(1, "units/day"),
      leadTimeDays: -1,
      safetyStockDays: -2,
      availableStock: 5,
      unlimitedQuantity: false,
    });

    expect(result.missing).toEqual(["lead_time_not_configured", "safety_stock_not_configured"]);
  });

  it("rejects an unavailable demand metric before any arithmetic", () => {
    const result = computeReorder({
      demand: unavailable("product_demand_not_linked"),
      leadTimeDays: 7,
      safetyStockDays: 3,
      availableStock: 10,
      unlimitedQuantity: false,
    });

    expect(result.quantity.value).toBeNull();
    expect(result.missing).toEqual(["product_demand_not_linked"]);
  });
});
