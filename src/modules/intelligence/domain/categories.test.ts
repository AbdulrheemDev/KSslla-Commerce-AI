import { describe, expect, it } from "vitest";

import {
  computeCategoryIntelligence,
  type CategoryProductInput,
} from "@/modules/intelligence/domain/categories";
import { THRESHOLDS } from "@/modules/intelligence/domain/thresholds";

const CATEGORIES = [
  { id: "c1", name: "عطور" },
  { id: "c2", name: "هدايا" },
  { id: "c3", name: "فارغة" },
];

function product(overrides: Partial<CategoryProductInput> = {}): CategoryProductInput {
  return {
    productId: "p1",
    categoryIds: ["c1"],
    soldQuantity: 5,
    stock: 10,
    isAvailable: true,
    ...overrides,
  };
}

describe("computeCategoryIntelligence", () => {
  it("counts products, availability, and units per category", () => {
    const result = computeCategoryIntelligence(CATEGORIES, [
      product({ productId: "a", soldQuantity: 5 }),
      product({ productId: "b", soldQuantity: 7, isAvailable: false }),
    ]);

    const perfumes = result.items.find((item) => item.categoryId === "c1")!;

    expect(perfumes.productCount).toBe(2);
    expect(perfumes.availableProducts).toBe(1);
    expect(perfumes.unitsSold.value).toBe(12);
    expect(perfumes.unitsSold.availability).toBe("available");
  });

  it("counts a product in every category it belongs to", () => {
    const result = computeCategoryIntelligence(CATEGORIES, [
      product({ productId: "a", categoryIds: ["c1", "c2"], soldQuantity: 4 }),
    ]);

    expect(result.items.find((item) => item.categoryId === "c1")?.unitsSold.value).toBe(4);
    expect(result.items.find((item) => item.categoryId === "c2")?.unitsSold.value).toBe(4);
    expect(result.manyToMany).toBe(true);
  });

  it("reports uncategorised products instead of dropping them", () => {
    const result = computeCategoryIntelligence(CATEGORIES, [product({ categoryIds: [] })]);

    expect(result.uncategorisedProducts).toBe(1);
    expect(result.items.every((item) => item.productCount === 0)).toBe(true);
  });

  it("marks units partial when a member product has no sales data", () => {
    const result = computeCategoryIntelligence(CATEGORIES, [
      product({ productId: "a", soldQuantity: 4 }),
      product({ productId: "b", soldQuantity: null }),
    ]);

    const perfumes = result.items.find((item) => item.categoryId === "c1")!;

    expect(perfumes.unitsSold.value).toBe(4);
    expect(perfumes.unitsSold.availability).toBe("partial");
    expect(perfumes.unitsSold.reason).toBe("some_products_missing_sales_data");
  });

  it("flags a weak category only with enough products and zero sales", () => {
    const result = computeCategoryIntelligence(CATEGORIES, [
      product({ productId: "a", categoryIds: ["c1"], soldQuantity: 0 }),
      product({ productId: "b", categoryIds: ["c1"], soldQuantity: 0 }),
      product({ productId: "c", categoryIds: ["c2"], soldQuantity: 0 }),
    ]);

    expect(result.items.find((item) => item.categoryId === "c1")?.weak).toBe(true);
    // Only one product in c2: not enough to judge the category.
    expect(result.items.find((item) => item.categoryId === "c2")?.weak).toBe(false);
    expect(THRESHOLDS.WEAK_CATEGORY_MIN_PRODUCTS).toBe(2);
  });

  it("never claims revenue or contribution", () => {
    const result = computeCategoryIntelligence(CATEGORIES, [product()]);

    for (const item of result.items) {
      expect(item.revenue.value).toBeNull();
      expect(item.contribution.value).toBeNull();
      expect(item.revenue.reason).toBe("line_level_data_unavailable");
    }
  });
});
