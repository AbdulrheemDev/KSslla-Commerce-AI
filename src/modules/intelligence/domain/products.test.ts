import { describe, expect, it } from "vitest";

import {
  analyseProduct,
  rankProducts,
  summariseProducts,
  type ProductMetricRow,
} from "@/modules/intelligence/domain/products";
import { THRESHOLDS } from "@/modules/intelligence/domain/thresholds";

function product(overrides: Partial<ProductMetricRow> = {}): ProductMetricRow {
  return {
    id: "p1",
    name: "منتج",
    status: "sale",
    priceAmount: "100.00",
    currency: "SAR",
    quantity: 20,
    isAvailable: true,
    hasImage: true,
    categoryNames: ["فئة"],
    inventoryQuantity: 20,
    soldQuantity: 5,
    unlimitedQuantity: false,
    ...overrides,
  };
}

describe("analyseProduct — classification", () => {
  const cases: Array<[string, Partial<ProductMetricRow>, string]> = [
    [
      "no stock and no sales data",
      { quantity: null, inventoryQuantity: null, soldQuantity: null },
      "insufficient_data",
    ],
    ["out of stock after sales", { inventoryQuantity: 0, soldQuantity: 4 }, "inventory_risk"],
    ["out of stock with no sales", { inventoryQuantity: 0, soldQuantity: 0 }, "low_performer"],
    ["low stock while selling", { inventoryQuantity: 3, soldQuantity: 2 }, "inventory_risk"],
    [
      "high cumulative sales",
      { inventoryQuantity: 40, soldQuantity: THRESHOLDS.STAR_SALES_UNITS },
      "star",
    ],
    [
      "rising sales",
      { inventoryQuantity: 40, soldQuantity: THRESHOLDS.GROWTH_SALES_UNITS },
      "growth_opportunity",
    ],
    ["stock but no sales", { inventoryQuantity: 40, soldQuantity: 0 }, "low_performer"],
    ["ordinary product", { inventoryQuantity: 9, soldQuantity: 1 }, "stable"],
    [
      "stock known but inventory missing",
      { inventoryQuantity: null, soldQuantity: null, quantity: 12 },
      "insufficient_data",
    ],
  ];

  it.each(cases)("classifies %s as %s", (_label, overrides, expected) => {
    expect(analyseProduct(product(overrides)).classification).toBe(expected);
  });

  it("does not call an unlimited product out of stock", () => {
    const analysed = analyseProduct(
      product({ inventoryQuantity: 0, soldQuantity: 20, unlimitedQuantity: true }),
    );

    expect(analysed.classification).toBe("star");
    expect(analysed.signals).toContain("out_of_stock");
  });

  it("never claims revenue, velocity, or days-of-stock", () => {
    const analysed = analyseProduct(product());

    for (const metric of [analysed.revenue, analysed.velocity, analysed.daysOfStock]) {
      expect(metric.value).toBeNull();
      expect(metric.availability).toBe("unavailable");
    }
    expect(analysed.revenue.reason).toBe("line_level_data_unavailable");
    expect(analysed.velocity.reason).toBe("no_sales_period");
  });

  it("reports the stock source", () => {
    expect(analyseProduct(product({ inventoryQuantity: 7 })).stockSource).toBe("inventory");
    expect(
      analyseProduct(product({ inventoryQuantity: null, soldQuantity: null, quantity: 7 }))
        .stockSource,
    ).toBe("products");
  });

  it("flags missing catalogue data", () => {
    const analysed = analyseProduct(
      product({ priceAmount: null, categoryNames: [], hasImage: false }),
    );

    expect(analysed.signals).toEqual(
      expect.arrayContaining(["missing_price", "missing_category", "missing_image"]),
    );
    expect(analysed.price.reason).toBe("no_price");
  });
});

describe("summariseProducts", () => {
  it("counts the store's product state", () => {
    const rows = [
      product({ id: "a", inventoryQuantity: 0, soldQuantity: 4 }),
      product({ id: "b", inventoryQuantity: 3, soldQuantity: 2 }),
      product({ id: "c", inventoryQuantity: 40, soldQuantity: 12 }),
      product({
        id: "d",
        inventoryQuantity: 60,
        soldQuantity: 0,
        priceAmount: null,
        categoryNames: [],
        hasImage: false,
      }),
    ];
    const analysed = rows.map(analyseProduct);
    const summary = summariseProducts(analysed, rows);

    expect(summary.total).toBe(4);
    expect(summary.outOfStock).toBe(1);
    expect(summary.lowStock).toBe(1);
    expect(summary.inStock).toBe(3);
    expect(summary.unsold).toBe(1);
    expect(summary.missingPrice).toBe(1);
    expect(summary.missingCategory).toBe(1);
    expect(summary.missingImage).toBe(1);
    expect(summary.byClass.inventory_risk).toBe(2);
    expect(summary.byClass.star).toBe(1);
  });
});

describe("rankProducts", () => {
  it("ranks only products that have a sales figure", () => {
    const rows = [
      product({ id: "a", name: "أ", soldQuantity: 9 }),
      product({ id: "b", name: "ب", soldQuantity: 2 }),
      product({ id: "c", name: "ج", soldQuantity: null, inventoryQuantity: null }),
    ];
    const analysed = rows.map(analyseProduct);
    const { top, bottom } = rankProducts(analysed, 10);

    expect(top.map((item) => item.productId)).toEqual(["a", "b"]);
    expect(bottom.map((item) => item.productId)).toEqual(["b", "a"]);
    expect(top[0]?.unitsSold).toBe(9);
  });

  it("limits both lists", () => {
    const rows = Array.from({ length: 5 }, (_, index) =>
      product({ id: `p${index}`, name: `منتج ${index}`, soldQuantity: index }),
    );
    const { top, bottom } = rankProducts(rows.map(analyseProduct), 2);

    expect(top).toHaveLength(2);
    expect(bottom).toHaveLength(2);
  });
});
