import { describe, expect, it } from "vitest";

import type { CategoryItem } from "@/modules/intelligence/domain/categories";
import {
  buildOpportunities,
  type OpportunityInput,
} from "@/modules/intelligence/domain/opportunities";
import { analyseProduct, type ProductMetricRow } from "@/modules/intelligence/domain/products";
import { computeSalesMetrics } from "@/modules/intelligence/domain/sales";
import type { Coverage, DataFreshness } from "@/modules/intelligence/domain/types";

const NOW = new Date("2026-10-22T12:00:00.000Z");

function product(overrides: Partial<ProductMetricRow> = {}) {
  return analyseProduct({
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
  });
}

function category(overrides: Partial<CategoryItem> = {}): CategoryItem {
  return {
    categoryId: "c1",
    name: "عطور",
    productCount: 2,
    availableProducts: 2,
    unitsSold: { value: 0, availability: "available", basis: null, reason: null },
    revenue: {
      value: null,
      availability: "unavailable",
      basis: null,
      reason: "line_level_data_unavailable",
    },
    contribution: {
      value: null,
      availability: "unavailable",
      basis: null,
      reason: "line_level_data_unavailable",
    },
    weak: false,
    ...overrides,
  };
}

function freshness(overrides: Partial<DataFreshness> = {}): DataFreshness {
  return {
    syncedAt: "2026-10-22T11:00:00.000Z",
    resources: [],
    staleResources: [],
    ...overrides,
  };
}

const coverage: Coverage = {
  requestedFrom: "2026-09-22T00:00:00.000Z",
  requestedTo: NOW.toISOString(),
  firstOrderAt: "2025-01-01T00:00:00.000Z",
  lastOrderAt: "2026-10-20T00:00:00.000Z",
  status: "complete",
  notes: [],
};

function input(overrides: Partial<OpportunityInput> = {}): OpportunityInput {
  return {
    products: [product()],
    categories: [],
    sales: computeSalesMetrics({
      current: [
        { statusSlug: "completed", totalAmount: "100.00", currency: "SAR", draft: false },
        { statusSlug: "completed", totalAmount: "120.00", currency: "SAR", draft: false },
      ],
      previous: [],
      ordersSynced: true,
      syncIncomplete: false,
      hasBaseline: true,
    }),
    freshness: freshness(),
    coverage,
    ordersSynced: true,
    productsSynced: true,
    now: NOW,
    ...overrides,
  };
}

function types(list: ReturnType<typeof buildOpportunities>): string[] {
  return list.items.map((item) => item.type);
}

describe("buildOpportunities — product rules", () => {
  it("raises an out-of-stock opportunity after real sales", () => {
    const list = buildOpportunities(
      input({ products: [product({ inventoryQuantity: 0, soldQuantity: 4 })] }),
    );
    const item = list.items.find((candidate) => candidate.type === "out_of_stock")!;

    expect(item.severity).toBe("high");
    expect(item.entityId).toBe("p1");
    expect(item.confidence).toBe("high");
    expect(item.evidence).toEqual(
      expect.arrayContaining([
        { label: "المخزون الحالي", value: 0, unit: "وحدة" },
        { label: "الوحدات المبيعة (تراكمي من Salla)", value: 4, unit: "وحدة" },
      ]),
    );
    expect(item.recommendedAction.length).toBeGreaterThan(10);
  });

  it("distinguishes fast-selling low stock from ordinary low stock", () => {
    const fast = buildOpportunities(
      input({ products: [product({ inventoryQuantity: 2, soldQuantity: 40 })] }),
    );
    const slow = buildOpportunities(
      input({ products: [product({ inventoryQuantity: 3, soldQuantity: 2 })] }),
    );

    expect(types(fast)).toContain("high_sales_low_stock");
    expect(fast.items.find((item) => item.type === "high_sales_low_stock")?.severity).toBe("high");
    expect(types(slow)).toContain("low_stock");
    expect(slow.items.find((item) => item.type === "low_stock")?.severity).toBe("medium");
  });

  it("does not raise stock opportunities for a healthy product", () => {
    const list = buildOpportunities(
      input({ products: [product({ inventoryQuantity: 30, soldQuantity: 20 })] }),
    );

    expect(list.items.filter((item) => item.entityType === "product")).toHaveLength(0);
  });

  it("flags overstock only when stock is large and never sold", () => {
    const list = buildOpportunities(
      input({ products: [product({ inventoryQuantity: 60, soldQuantity: 0 })] }),
    );

    expect(types(list)).toContain("overstock");
    expect(types(list)).not.toContain("slow_mover");
  });

  it("flags a slow mover below the overstock bar", () => {
    const list = buildOpportunities(
      input({ products: [product({ inventoryQuantity: 20, soldQuantity: 0 })] }),
    );

    expect(types(list)).toContain("slow_mover");
    expect(list.items.find((item) => item.type === "slow_mover")?.severity).toBe("low");
  });

  it("does not flag a hidden product as a slow mover", () => {
    const list = buildOpportunities(
      input({ products: [product({ status: "hidden", inventoryQuantity: 20, soldQuantity: 0 })] }),
    );

    expect(list.items.filter((item) => item.type === "slow_mover")).toHaveLength(0);
  });

  it("lowers confidence when the sales figure is missing", () => {
    // Stock 0 without an inventory row: out_of_stock cannot fire on sales, but
    // low_stock uses stock only, and its evidence is partial.
    const list = buildOpportunities(
      input({
        products: [product({ inventoryQuantity: null, quantity: 3, soldQuantity: null })],
      }),
    );

    const low = list.items.find((item) => item.type === "low_stock");
    expect(low?.confidence).toBe("low");
  });
});

describe("buildOpportunities — store rules", () => {
  it("flags incomplete product data once, not per product", () => {
    const list = buildOpportunities(
      input({
        products: [
          product({ id: "a", priceAmount: null }),
          product({ id: "b", categoryNames: [] }),
          product({ id: "c", hasImage: false }),
        ],
      }),
    );

    const items = list.items.filter((item) => item.type === "incomplete_product_data");

    expect(items).toHaveLength(1);
    expect(items[0]?.evidence).toContainEqual({ label: "منتجات ببيانات ناقصة", value: 3 });
  });

  it("flags stale sync with the affected resources", () => {
    const list = buildOpportunities(
      input({
        freshness: freshness({ staleResources: ["orders", "inventory"] }),
      }),
    );

    const stale = list.items.find((item) => item.type === "stale_sync");

    expect(stale?.severity).toBe("medium");
    expect(stale?.evidence).toHaveLength(2);
  });

  it("flags a window with orders but no completed ones", () => {
    const list = buildOpportunities(
      input({
        sales: computeSalesMetrics({
          current: [
            { statusSlug: "canceled", totalAmount: "10.00", currency: "SAR", draft: false },
          ],
          previous: [],
          ordersSynced: true,
          syncIncomplete: false,
          hasBaseline: true,
        }),
      }),
    );

    const item = list.items.find((candidate) => candidate.type === "no_recent_sales");

    expect(item?.evidence).toContainEqual({ label: "طلبات مكتملة", value: 0 });
  });

  it("does not flag no-sales on a store that never synced orders", () => {
    const list = buildOpportunities(
      input({
        ordersSynced: false,
        sales: computeSalesMetrics({
          current: [],
          previous: [],
          ordersSynced: false,
          syncIncomplete: false,
          hasBaseline: false,
        }),
      }),
    );

    expect(types(list)).not.toContain("no_recent_sales");
  });

  it("flags a weak category", () => {
    const list = buildOpportunities(input({ categories: [category({ weak: true })] }));

    expect(types(list)).toContain("weak_category");
  });
});

describe("buildOpportunities — determinism", () => {
  it("sorts by severity and produces stable ids", () => {
    const list = buildOpportunities(
      input({
        products: [
          product({ id: "slow", inventoryQuantity: 20, soldQuantity: 0 }),
          product({ id: "out", inventoryQuantity: 0, soldQuantity: 4 }),
        ],
      }),
    );

    expect(list.items[0]?.severity).toBe("high");
    expect(list.items.map((item) => item.id)).toContain("out_of_stock:product:out");
    expect(list.items.map((item) => item.id)).toContain("slow_mover:product:slow");
    expect(list.items.map((item) => item.id)).toEqual([
      ...new Set(list.items.map((item) => item.id)),
    ]);
  });

  it("returns counts per type", () => {
    const list = buildOpportunities(
      input({
        products: [
          product({ id: "a", inventoryQuantity: 0, soldQuantity: 4 }),
          product({ id: "b", inventoryQuantity: 0, soldQuantity: 3 }),
        ],
      }),
    );

    expect(list.countsByType.out_of_stock).toBe(2);
    expect(list.total).toBe(list.items.length);
  });
});
