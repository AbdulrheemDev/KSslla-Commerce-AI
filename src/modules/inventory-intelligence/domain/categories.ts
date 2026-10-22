import { available, unavailable, type Metric } from "@/modules/intelligence/domain/types";

import type { InventoryCategoryRef, ProductInventoryAnalysis } from "./types";

/**
 * Category **inventory** health.
 *
 * Counting only: how many products the category holds, how many are out of stock,
 * low, unlimited, or have no inventory row at all, and the resulting share of
 * sellable products.
 *
 * Explicitly not computed, because no source exists:
 * - category sales velocity — no product-level demand;
 * - category stock turnover — needs demand and period;
 * - category demand — same.
 *
 * A category with no products returns `unavailable` shares instead of zero: zero
 * would read as "every product in this category is sold out".
 */

export interface CategoryInventoryHealth {
  readonly id: string;
  readonly name: string;
  readonly status: string;
  readonly hidden: boolean;
  readonly productCount: number;
  readonly trackedCount: number;
  readonly unknownCount: number;
  readonly outOfStock: number;
  readonly lowStock: number;
  readonly unlimited: number;
  readonly inStock: number;
  readonly highStockQuantity: number;
  /** In stock (including unlimited) ÷ products with known stock. */
  readonly inStockPercent: Metric<number>;
  readonly outOfStockPercent: Metric<number>;
  /** Products with an inventory row ÷ products in the category. */
  readonly coveragePercent: Metric<number>;
  /** Always unavailable: no documented product-level demand source. */
  readonly demandRate: Metric<number>;
}

function percentOf(count: number, total: number): number {
  return total === 0 ? 0 : Math.round((count / total) * 1000) / 10;
}

export function buildCategoryInventoryHealth(
  analyses: readonly ProductInventoryAnalysis[],
  categories: readonly InventoryCategoryRef[],
): CategoryInventoryHealth[] {
  return categories.map((category) => {
    const members = analyses.filter((analysis) =>
      analysis.categoryRefs.some((ref) => ref.id === category.id),
    );

    const count = members.length;
    const tracked = members.filter((member) => member.status !== "unknown").length;
    const outOfStock = members.filter((member) => member.status === "out_of_stock").length;
    const lowStock = members.filter((member) => member.status === "low_stock").length;
    const unlimited = members.filter((member) => member.status === "unlimited").length;
    const inStock = members.filter((member) => member.status === "in_stock").length;
    const highStockQuantity = members.filter((member) => member.highStockQuantity).length;

    return {
      id: category.id,
      name: category.name,
      status: category.status,
      hidden: category.status === "hidden",
      productCount: count,
      trackedCount: tracked,
      unknownCount: count - tracked,
      outOfStock,
      lowStock,
      unlimited,
      inStock,
      highStockQuantity,
      inStockPercent:
        tracked === 0
          ? unavailable(
              "no_inventory_rows",
              "in-stock (incl. unlimited) ÷ products with known stock",
            )
          : available(
              percentOf(inStock + unlimited, tracked),
              "in-stock (incl. unlimited) ÷ products with known stock",
            ),
      outOfStockPercent:
        tracked === 0
          ? unavailable("no_inventory_rows", "out-of-stock ÷ products with known stock")
          : available(percentOf(outOfStock, tracked), "out-of-stock ÷ products with known stock"),
      coveragePercent:
        count === 0
          ? unavailable("no_products_in_category", "products with an inventory row ÷ products")
          : available(percentOf(tracked, count), "products with an inventory row ÷ products"),
      demandRate: unavailable("product_demand_not_linked", "category units per day"),
    };
  });
}
