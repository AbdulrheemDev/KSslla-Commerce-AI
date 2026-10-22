import { available, unavailable, type Metric } from "@/modules/intelligence/domain/types";

import { daysOfStockFrom, resolveDemand } from "./demand";
import { evaluateExcess } from "./excess";
import { detectIssues, highestSeverity } from "./issues";
import { resolveReorder } from "./reorder";
import { classifyStock, stockMetric } from "./stock";
import { riskFromDaysOfStock } from "./stockout";
import type { InventoryProductInput, ProductInventoryAnalysis } from "./types";

/**
 * One product, fully analysed for inventory.
 *
 * This is the only place the engines are composed, so a product's status, its
 * issues, and its risk always come from the same evaluation of the same row.
 *
 * The three forecast fields are resolved once (they cannot vary per product while
 * no demand source exists) and then applied per product, so each row carries the
 * same reason codes as the overview rather than a bare `null`.
 */
export function analyseInventoryProduct(product: InventoryProductInput): ProductInventoryAnalysis {
  const stock = product.stock;
  const status = stock === null ? "unknown" : classifyStock(stock);

  const stockValue: Metric<number> =
    stock === null
      ? unavailable("inventory_record_missing", "inventory_levels.quantity")
      : stockMetric({ quantity: stock.quantity, entries: stock.entries });

  const demand = resolveDemand();
  const daysOfStock: Metric<number> =
    stock === null
      ? unavailable("inventory_record_missing", "stock ÷ daily demand")
      : daysOfStockFrom({
          demand: demand.dailyDemand,
          quantity: stock.quantity,
          unlimitedQuantity: stock.unlimitedQuantity,
        });

  const risk = riskFromDaysOfStock(daysOfStock);
  const excess = evaluateExcess({
    quantity: stock?.quantity ?? 0,
    unlimitedQuantity: stock?.unlimitedQuantity ?? false,
  });
  const reorder = resolveReorder();

  const cumulativeSoldQuantity: Metric<number> =
    stock === null
      ? unavailable("inventory_not_synced", "sum(inventory_levels.sold_quantity)")
      : available(
          stock.soldQuantity,
          "sum(inventory_levels.sold_quantity) — cumulative provider value, period not documented",
        );

  const issues = detectIssues(product);
  const severity = highestSeverity(issues);

  return {
    id: product.id,
    name: product.name,
    sku: product.sku,
    productStatus: product.productStatus,
    categories: product.categories.map((category) => category.name),
    categoryRefs: product.categories,
    status,
    stock: stockValue,
    unlimited: stock === null ? null : stock.unlimitedQuantity,
    entries: stock?.entries ?? 0,
    variants: stock?.variants ?? [],
    lastSyncedAt: stock?.lastSyncedAt ?? null,
    cumulativeSoldQuantity,
    demand,
    daysOfStock,
    stockoutRisk: risk.risk,
    stockoutRiskReason: risk.reason,
    highStockQuantity: excess.highStockQuantity,
    deadStock: excess.deadStock,
    excessInventory: excess.excessInventory,
    reorderQuantity: reorder.quantity,
    reorderMissingInputs: reorder.missing,
    issues,
    severity,
  };
}
