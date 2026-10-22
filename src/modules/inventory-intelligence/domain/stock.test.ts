import { describe, expect, it } from "vitest";

import { INVENTORY_THRESHOLDS } from "./thresholds";
import { classifyStock, isHighQuantity, stockMetric, unknownStockMetric } from "./stock";

/**
 * Stock status is the one number in this module that is read directly from the
 * mirror, so its edges are tested explicitly: zero, negative, the low-stock
 * boundary on both sides, and unlimited at zero.
 */
describe("inventory stock status", () => {
  it("treats zero as out of stock", () => {
    expect(classifyStock({ quantity: 0, unlimitedQuantity: false })).toBe("out_of_stock");
  });

  it("treats a negative quantity as out of stock, never as zero", () => {
    expect(classifyStock({ quantity: -7, unlimitedQuantity: false })).toBe("out_of_stock");
  });

  it("lets unlimited win over a zero quantity", () => {
    // The provider's own documentation example shows unlimited products with
    // quantity 0; reporting them as sold out would be a false alarm.
    expect(classifyStock({ quantity: 0, unlimitedQuantity: true })).toBe("unlimited");
    expect(classifyStock({ quantity: -3, unlimitedQuantity: true })).toBe("unlimited");
  });

  it("classifies exactly the low-stock threshold as low, not in stock", () => {
    expect(
      classifyStock({ quantity: INVENTORY_THRESHOLDS.LOW_STOCK_UNITS, unlimitedQuantity: false }),
    ).toBe("low_stock");
  });

  it("classifies one unit above the low-stock threshold as in stock", () => {
    expect(
      classifyStock({
        quantity: INVENTORY_THRESHOLDS.LOW_STOCK_UNITS + 1,
        unlimitedQuantity: false,
      }),
    ).toBe("in_stock");
  });

  it("classifies one unit as low stock", () => {
    expect(classifyStock({ quantity: 1, unlimitedQuantity: false })).toBe("low_stock");
  });

  it("does not treat a large quantity as low stock", () => {
    expect(classifyStock({ quantity: 500, unlimitedQuantity: false })).toBe("in_stock");
  });
});

describe("high quantity observation", () => {
  it("starts exactly at the configured threshold", () => {
    expect(
      isHighQuantity({ quantity: INVENTORY_THRESHOLDS.HIGH_STOCK_UNITS, unlimitedQuantity: false }),
    ).toBe(true);
    expect(
      isHighQuantity({
        quantity: INVENTORY_THRESHOLDS.HIGH_STOCK_UNITS - 1,
        unlimitedQuantity: false,
      }),
    ).toBe(false);
  });

  it("never labels unlimited stock as high quantity", () => {
    expect(isHighQuantity({ quantity: 999, unlimitedQuantity: true })).toBe(false);
  });
});

describe("stock metric", () => {
  it("names the variant aggregation in its basis when more than one entry is summed", () => {
    const metric = stockMetric({ quantity: 7, entries: 2 });
    expect(metric.value).toBe(7);
    expect(metric.availability).toBe("available");
    expect(metric.basis).toContain("variants");
  });

  it("names the raw column when a single entry is read", () => {
    expect(stockMetric({ quantity: 7, entries: 1 }).basis).toBe("inventory_levels.quantity");
  });

  it("never reports missing stock as a number", () => {
    const metric = unknownStockMetric();
    expect(metric.value).toBeNull();
    expect(metric.availability).toBe("unavailable");
    expect(metric.reason).toBe("inventory_record_missing");
  });
});
