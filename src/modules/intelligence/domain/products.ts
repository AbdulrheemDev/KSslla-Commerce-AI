import { THRESHOLDS } from "@/modules/intelligence/domain/thresholds";
import type { Metric } from "@/modules/intelligence/domain/types";
import { available, unavailable } from "@/modules/intelligence/domain/types";

/**
 * Product intelligence.
 *
 * **What the data can and cannot say.** Salla's documented `List Orders` line
 * carries only `name`, `quantity`, and `thumbnail` — no product id and no line
 * price (docs/salla-reference.md §12.1). Product-level revenue is therefore
 * *not computable*, and this module reports it as `unavailable` instead of
 * multiplying a current price by a cumulative sold count, which would invent a
 * number that never existed.
 *
 * `sold_quantity` comes from `GET /products/quantities`. Salla documents the
 * field but **not its period**, so it is exposed as a cumulative provider value
 * and is never used as "sales in the last 30 days". Because a period is unknown,
 * sales velocity (units/day) and days-of-stock are also `unavailable`; stock risk
 * is judged from current stock and the thresholds in `thresholds.ts`.
 */

export type ProductClass =
  | "star"
  | "growth_opportunity"
  | "stable"
  | "low_performer"
  | "inventory_risk"
  | "insufficient_data";

export interface ProductMetricRow {
  id: string;
  name: string;
  status: string;
  priceAmount: string | null;
  currency: string | null;
  /** Stock from `products.quantity`; null when Salla returned none. */
  quantity: number | null;
  isAvailable: boolean;
  hasImage: boolean;
  categoryNames: readonly string[];
  /** Sum of `inventory_levels.quantity`; null when no inventory row exists. */
  inventoryQuantity: number | null;
  /** Sum of `inventory_levels.sold_quantity`; null when no inventory row exists. */
  soldQuantity: number | null;
  unlimitedQuantity: boolean | null;
}

export interface ProductIntelligence {
  productId: string;
  name: string;
  status: string;
  classification: ProductClass;
  classificationReason: string;
  categories: readonly string[];
  price: Metric<number>;
  stock: Metric<number>;
  stockSource: "inventory" | "products" | null;
  unitsSold: Metric<number>;
  revenue: Metric<number>;
  velocity: Metric<number>;
  daysOfStock: Metric<number>;
  signals: readonly string[];
}

export interface ProductSummary {
  total: number;
  inStock: number;
  outOfStock: number;
  lowStock: number;
  unsold: number;
  missingPrice: number;
  missingCategory: number;
  missingImage: number;
  withInventoryData: number;
  byClass: Record<ProductClass, number>;
}

export interface ProductRanking {
  productId: string;
  name: string;
  unitsSold: number;
  stock: number | null;
  classification: ProductClass;
}

function stockOf(row: ProductMetricRow): {
  value: number | null;
  source: "inventory" | "products" | null;
} {
  if (row.inventoryQuantity !== null) return { value: row.inventoryQuantity, source: "inventory" };
  if (row.quantity !== null) return { value: row.quantity, source: "products" };
  return { value: null, source: null };
}

function classify(
  sold: number | null,
  stock: number | null,
  unlimited: boolean,
): { classification: ProductClass; reason: string } {
  if (stock === null && sold === null) {
    return { classification: "insufficient_data", reason: "no_stock_or_sales_data" };
  }

  if (!unlimited && stock !== null && stock <= 0) {
    if (sold !== null && sold >= THRESHOLDS.OUT_OF_STOCK_MIN_SALES) {
      return { classification: "inventory_risk", reason: "out_of_stock_after_sales" };
    }
    return { classification: "low_performer", reason: "out_of_stock_no_sales" };
  }

  if (sold === null) {
    return { classification: "insufficient_data", reason: "inventory_not_synced" };
  }

  if (
    !unlimited &&
    stock !== null &&
    stock <= THRESHOLDS.LOW_STOCK_UNITS &&
    sold >= THRESHOLDS.OUT_OF_STOCK_MIN_SALES
  ) {
    return { classification: "inventory_risk", reason: "low_stock_while_selling" };
  }

  if (sold >= THRESHOLDS.STAR_SALES_UNITS) {
    return { classification: "star", reason: "high_cumulative_sales" };
  }

  if (sold >= THRESHOLDS.GROWTH_SALES_UNITS) {
    return { classification: "growth_opportunity", reason: "rising_cumulative_sales" };
  }

  if (sold === 0 && stock !== null && stock > 0) {
    return { classification: "low_performer", reason: "no_sales_with_stock" };
  }

  return { classification: "stable", reason: "within_thresholds" };
}

export function analyseProduct(row: ProductMetricRow): ProductIntelligence {
  const stock = stockOf(row);
  const unlimited = row.unlimitedQuantity === true;

  const price: Metric<number> =
    row.priceAmount === null
      ? unavailable("no_price")
      : Number.isFinite(Number(row.priceAmount))
        ? available(Number(row.priceAmount), "products.price_amount")
        : unavailable("invalid_price");

  const stockMetric: Metric<number> =
    stock.value === null
      ? unavailable("no_stock_data")
      : available(
          stock.value,
          `products.${stock.source === "inventory" ? "inventory_sum" : "quantity"}`,
        );

  const soldMetric: Metric<number> =
    row.soldQuantity === null
      ? unavailable("inventory_not_synced")
      : available(
          row.soldQuantity,
          "sum(inventory_levels.sold_quantity) — provider value, period not documented",
        );

  const { classification, reason } = classify(row.soldQuantity, stock.value, unlimited);

  const signals: string[] = [];
  if (stock.value !== null && stock.value <= 0) signals.push("out_of_stock");
  else if (stock.value !== null && stock.value <= THRESHOLDS.LOW_STOCK_UNITS)
    signals.push("low_stock");
  if (row.soldQuantity === 0) signals.push("no_sales");
  if (row.priceAmount === null) signals.push("missing_price");
  if (row.categoryNames.length === 0) signals.push("missing_category");
  if (!row.hasImage) signals.push("missing_image");
  if (row.status === "hidden") signals.push("hidden");

  return {
    productId: row.id,
    name: row.name,
    status: row.status,
    classification,
    classificationReason: reason,
    categories: row.categoryNames,
    price,
    stock: stockMetric,
    stockSource: stock.source,
    unitsSold: soldMetric,
    // Documented limitation, not an implementation gap.
    revenue: unavailable("line_level_data_unavailable"),
    velocity: unavailable("no_sales_period"),
    daysOfStock: unavailable("no_sales_period"),
    signals,
  };
}

export function summariseProducts(
  rows: readonly ProductIntelligence[],
  source: readonly ProductMetricRow[],
): ProductSummary {
  const byClass: Record<ProductClass, number> = {
    star: 0,
    growth_opportunity: 0,
    stable: 0,
    low_performer: 0,
    inventory_risk: 0,
    insufficient_data: 0,
  };

  for (const row of rows) byClass[row.classification] += 1;

  const stockOfRow = (row: ProductMetricRow): number | null => stockOf(row).value;

  return {
    total: rows.length,
    inStock: rows.filter((row) => {
      const metric = row.stock;
      return metric.value !== null && metric.value > 0;
    }).length,
    outOfStock: source.filter((row) => {
      const stock = stockOfRow(row);
      return stock !== null && stock <= 0;
    }).length,
    lowStock: source.filter((row) => {
      const stock = stockOfRow(row);
      return (
        stock !== null &&
        stock > 0 &&
        stock <= THRESHOLDS.LOW_STOCK_UNITS &&
        row.unlimitedQuantity !== true
      );
    }).length,
    unsold: source.filter((row) => row.soldQuantity === 0).length,
    missingPrice: source.filter((row) => row.priceAmount === null).length,
    missingCategory: source.filter((row) => row.categoryNames.length === 0).length,
    missingImage: source.filter((row) => !row.hasImage).length,
    withInventoryData: source.filter((row) => row.inventoryQuantity !== null).length,
    byClass,
  };
}

/**
 * Ranking by provider `sold_quantity`.
 *
 * Only products that carry an inventory row can be ranked; the rest are absent
 * rather than ranked at zero, because "no data" is not "sold nothing".
 */
export function rankProducts(
  rows: readonly ProductIntelligence[],
  limit: number,
): { top: ProductRanking[]; bottom: ProductRanking[] } {
  const ranked = rows
    .filter((row) => row.unitsSold.value !== null)
    .map<ProductRanking>((row) => ({
      productId: row.productId,
      name: row.name,
      unitsSold: row.unitsSold.value as number,
      stock: row.stock.value,
      classification: row.classification,
    }));

  const top = [...ranked]
    .sort((a, b) => b.unitsSold - a.unitsSold || a.name.localeCompare(b.name, "ar"))
    .slice(0, limit);

  const bottom = [...ranked]
    .sort((a, b) => a.unitsSold - b.unitsSold || a.name.localeCompare(b.name, "ar"))
    .slice(0, limit);

  return { top, bottom };
}
