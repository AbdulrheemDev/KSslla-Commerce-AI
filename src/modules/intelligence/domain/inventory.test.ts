import { describe, expect, it } from "vitest";

import {
  computeInventoryIntelligence,
  type InventoryMetricRow,
} from "@/modules/intelligence/domain/inventory";

const AT = new Date("2026-10-22T10:00:00.000Z");

function row(overrides: Partial<InventoryMetricRow> = {}): InventoryMetricRow {
  return {
    productId: "p1",
    externalProductId: "1001",
    productName: "منتج",
    quantity: 10,
    soldQuantity: 3,
    unlimitedQuantity: false,
    priceAmount: "100.00",
    lastSyncedAt: AT,
    ...overrides,
  };
}

describe("computeInventoryIntelligence", () => {
  it("aggregates variants of one product into a single line", () => {
    const result = computeInventoryIntelligence([
      row({ quantity: 4, soldQuantity: 2 }),
      row({ quantity: 6, soldQuantity: 5 }),
    ]);

    expect(result.trackedEntries).toBe(2);
    expect(result.trackedProducts).toBe(1);
    expect(result.items[0]?.quantity).toBe(10);
    expect(result.items[0]?.soldQuantity).toBe(7);
    expect(result.totalUnits).toBe(10);
  });

  it("treats a product as unlimited if any variant is unlimited", () => {
    const result = computeInventoryIntelligence([
      row({ quantity: 0, unlimitedQuantity: true }),
      row({ quantity: 5 }),
    ]);

    expect(result.items[0]?.unlimited).toBe(true);
    expect(result.items[0]?.risk).toBe("unlimited");
    expect(result.unlimited).toBe(1);
    expect(result.totalUnits).toBe(5);
  });

  it("classifies stock risk from the documented thresholds", () => {
    const result = computeInventoryIntelligence([
      row({ productId: "out", quantity: 0 }),
      row({ productId: "low", quantity: 3 }),
      row({ productId: "over", quantity: 60, soldQuantity: 0 }),
      row({ productId: "ok", quantity: 30, soldQuantity: 4 }),
    ]);

    const risk = Object.fromEntries(result.items.map((item) => [item.productId, item.risk]));

    expect(risk).toEqual({ out: "out", low: "low", over: "overstock", ok: "ok" });
    expect(result.outOfStock).toBe(1);
    expect(result.lowStock).toBe(1);
    expect(result.overstock).toBe(1);
  });

  it("keeps unknown products keyed by their external id", () => {
    const result = computeInventoryIntelligence([
      row({ productId: null, externalProductId: "9001" }),
    ]);

    expect(result.items[0]?.productId).toBeNull();
    expect(result.items[0]?.externalProductId).toBe("9001");
    expect(result.trackedProducts).toBe(1);
  });

  it("reports velocity and days-of-stock as unavailable, never estimated", () => {
    const result = computeInventoryIntelligence([row()]);

    expect(result.velocity).toEqual({
      value: null,
      availability: "unavailable",
      basis: "sold_quantity / period",
      reason: "no_sales_period",
    });
    expect(result.daysOfStock.value).toBeNull();
  });

  it("handles an empty mirror", () => {
    const result = computeInventoryIntelligence([]);

    expect(result.trackedEntries).toBe(0);
    expect(result.lastSyncedAt).toBeNull();
    expect(result.items).toEqual([]);
  });

  it("reports the newest snapshot timestamp", () => {
    const result = computeInventoryIntelligence([
      row({ lastSyncedAt: new Date("2026-10-20T10:00:00.000Z") }),
      row({ lastSyncedAt: new Date("2026-10-22T09:00:00.000Z") }),
    ]);

    expect(result.lastSyncedAt).toBe("2026-10-22T09:00:00.000Z");
  });
});
