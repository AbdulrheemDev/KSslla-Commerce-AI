import { THRESHOLDS } from "@/modules/intelligence/domain/thresholds";
import type { Metric } from "@/modules/intelligence/domain/types";
import { unavailable } from "@/modules/intelligence/domain/types";

/**
 * Inventory intelligence.
 *
 * The mirror (`inventory_levels`) is a **current-state** snapshot, one row per
 * provider quantity entry (per variant when the product has variants). It is
 * not a history, so this module deliberately does **not** produce:
 *
 * - a sales-velocity number — `sold_quantity` has no documented period, so
 *   "units per day" would require inventing one;
 * - days-of-stock — same reason;
 * - a forecast.
 *
 * What it does produce is what the data supports: current stock per product,
 * out-of-stock and low-stock counts, an overstock signal for stock that has
 * never sold, and the timestamp of the snapshot.
 */

export type StockRisk = "out" | "low" | "overstock" | "unlimited" | "ok";

export interface InventoryMetricRow {
  productId: string | null;
  externalProductId: string;
  productName: string;
  quantity: number;
  soldQuantity: number;
  unlimitedQuantity: boolean;
  priceAmount: string | null;
  lastSyncedAt: Date;
}

export interface InventoryItem {
  productId: string | null;
  externalProductId: string;
  name: string;
  quantity: number;
  soldQuantity: number;
  unlimited: boolean;
  risk: StockRisk;
  lastSyncedAt: string;
}

export interface InventoryIntelligence {
  trackedEntries: number;
  trackedProducts: number;
  totalUnits: number;
  outOfStock: number;
  lowStock: number;
  unlimited: number;
  overstock: number;
  lastSyncedAt: string | null;
  velocity: Metric<number>;
  daysOfStock: Metric<number>;
  items: InventoryItem[];
}

function riskOf(row: InventoryMetricRow): StockRisk {
  if (row.unlimitedQuantity) return "unlimited";
  if (row.quantity <= 0) return "out";
  if (row.quantity <= THRESHOLDS.LOW_STOCK_UNITS) return "low";
  if (row.quantity >= THRESHOLDS.OVERSTOCK_UNITS && row.soldQuantity === 0) return "overstock";
  return "ok";
}

/**
 * Groups provider entries by product.
 *
 * A variant product appears once per SKU; summing gives the product-level stock
 * the store owner thinks in. `unlimited` wins if **any** variant is unlimited,
 * because a single unlimited variant means the product can still be sold.
 */
export function computeInventoryIntelligence(
  rows: readonly InventoryMetricRow[],
): InventoryIntelligence {
  const byProduct = new Map<
    string,
    {
      productId: string | null;
      externalProductId: string;
      name: string;
      quantity: number;
      soldQuantity: number;
      unlimited: boolean;
      lastSyncedAt: Date;
      entries: number;
    }
  >();

  for (const row of rows) {
    const key = row.productId ?? `external:${row.externalProductId}`;
    const existing = byProduct.get(key);

    if (!existing) {
      byProduct.set(key, {
        productId: row.productId,
        externalProductId: row.externalProductId,
        name: row.productName,
        quantity: row.quantity,
        soldQuantity: row.soldQuantity,
        unlimited: row.unlimitedQuantity,
        lastSyncedAt: row.lastSyncedAt,
        entries: 1,
      });
      continue;
    }

    existing.quantity += row.quantity;
    existing.soldQuantity += row.soldQuantity;
    existing.unlimited = existing.unlimited || row.unlimitedQuantity;
    existing.entries += 1;
    if (row.lastSyncedAt.getTime() > existing.lastSyncedAt.getTime()) {
      existing.lastSyncedAt = row.lastSyncedAt;
    }
  }

  const items: InventoryItem[] = [...byProduct.values()]
    .map((entry) => ({
      productId: entry.productId,
      externalProductId: entry.externalProductId,
      name: entry.name,
      quantity: entry.quantity,
      soldQuantity: entry.soldQuantity,
      unlimited: entry.unlimited,
      risk: riskOf({
        productId: entry.productId,
        externalProductId: entry.externalProductId,
        productName: entry.name,
        quantity: entry.quantity,
        soldQuantity: entry.soldQuantity,
        unlimitedQuantity: entry.unlimited,
        priceAmount: null,
        lastSyncedAt: entry.lastSyncedAt,
      }),
      lastSyncedAt: entry.lastSyncedAt.toISOString(),
    }))
    .sort((a, b) => a.quantity - b.quantity || a.name.localeCompare(b.name, "ar"));

  const lastSyncedAt =
    items.length === 0
      ? null
      : rows
          .reduce(
            (latest, row) => (row.lastSyncedAt > latest ? row.lastSyncedAt : latest),
            rows[0]!.lastSyncedAt,
          )
          .toISOString();

  return {
    trackedEntries: rows.length,
    trackedProducts: items.length,
    // Known units only: an unlimited entry has no meaningful remaining stock.
    totalUnits: rows
      .filter((row) => !row.unlimitedQuantity)
      .reduce((sum, row) => sum + row.quantity, 0),
    outOfStock: items.filter((item) => item.risk === "out").length,
    lowStock: items.filter((item) => item.risk === "low").length,
    unlimited: items.filter((item) => item.risk === "unlimited").length,
    overstock: items.filter((item) => item.risk === "overstock").length,
    lastSyncedAt,
    // Both need a sales *period*, which Salla does not document for
    // `sold_quantity`. Reported as unavailable rather than estimated.
    velocity: unavailable("no_sales_period", "sold_quantity / period"),
    daysOfStock: unavailable("no_sales_period", "stock / velocity"),
    items,
  };
}
