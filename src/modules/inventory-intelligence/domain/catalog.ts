import { available, partial, unavailable, type Metric } from "@/modules/intelligence/domain/types";

import { DEMAND_UNAVAILABLE_REASON } from "./demand";
import { EXCESS_UNAVAILABLE_REASON } from "./excess";
import { summariseIssues } from "./issues";
import { REORDER_MISSING_INPUTS } from "./reorder";
import { INVENTORY_THRESHOLDS } from "./thresholds";
import type {
  InventoryConfidence,
  InventoryCoverage,
  InventoryIssueSummary,
  InventoryOverview,
  InventoryProductInput,
  InventorySyncState,
  ProductInventoryAnalysis,
  UnlinkedInventoryEntry,
} from "./types";

/**
 * Catalogue-level inventory summary.
 *
 * Every metric states the population it divided by. Where the denominator is
 * incomplete (some products have no inventory row) the metric is `partial` and
 * names the reason; where the whole source is missing it is `unavailable`. Zero is
 * only ever reported when zero is the measured fact — "no products" and "we never
 * looked" must not render the same way.
 */

function percent(numerator: number, denominator: number): number {
  return denominator === 0 ? 0 : Math.round((numerator / denominator) * 1000) / 10;
}

export interface InventoryReport {
  readonly overview: InventoryOverview;
  readonly coverage: InventoryCoverage;
  readonly confidence: InventoryConfidence;
  readonly issues: readonly InventoryIssueSummary[];
  readonly counts: {
    readonly productsTotal: number;
    readonly productsTracked: number;
    readonly inStock: number;
    readonly lowStock: number;
    readonly outOfStock: number;
    readonly unlimited: number;
    readonly unknown: number;
    readonly highStockQuantity: number;
    readonly totalUnits: number;
    readonly negativeQuantity: number;
    readonly inventoryEntries: number;
    readonly unlinkedEntries: number;
  };
}

/**
 * Coverage, stated in the three states that matter.
 *
 * - no catalogue ⇒ `unavailable("no_products_stored")`
 * - catalogue but no inventory rows ⇒ `unavailable("no_inventory_rows")` (or
 *   `inventory_not_synced` when the resource never ran)
 * - rows but no successful inventory sync ⇒ `partial`, because the rows may be
 *   from an interrupted run
 * - otherwise the measured share
 */
function coveragePercentMetric(input: {
  readonly productsTotal: number;
  readonly productsTracked: number;
  readonly inventoryEntries: number;
  readonly sync: InventorySyncState;
}): Metric<number> {
  const basis = "products with an inventory row ÷ products";

  if (input.productsTotal === 0) return unavailable("no_products_stored", basis);
  if (input.inventoryEntries === 0) {
    return unavailable(
      input.sync.inventorySynced ? "no_inventory_rows" : "inventory_not_synced",
      basis,
    );
  }

  const value = percent(input.productsTracked, input.productsTotal);

  return input.sync.inventorySynced
    ? available(value, basis)
    : partial(value, basis, "inventory_not_synced");
}

export function buildCoverage(input: {
  readonly productsTotal: number;
  readonly productsTracked: number;
  readonly inventoryEntries: number;
  readonly unlinkedEntries: number;
  readonly lastSyncedAt: string | null;
  readonly sync: InventorySyncState;
}): InventoryCoverage {
  const notes: string[] = [];

  if (input.productsTotal === 0) notes.push("no_products_stored");
  if (!input.sync.inventorySynced) notes.push("inventory_not_synced");
  if (input.sync.inventorySyncFailed) notes.push("inventory_sync_incomplete");
  if (input.inventoryEntries === 0) notes.push("no_inventory_rows");
  if (input.unlinkedEntries > 0) notes.push("inventory_entries_unlinked");
  if (input.productsTracked < input.productsTotal) notes.push("products_without_inventory_record");
  if (input.sync.staleResources.includes("inventory")) notes.push("inventory_snapshot_stale");

  const empty = input.productsTotal === 0 || input.inventoryEntries === 0;
  const complete =
    !empty &&
    input.productsTracked === input.productsTotal &&
    input.unlinkedEntries === 0 &&
    input.sync.inventorySynced &&
    !input.sync.inventorySyncFailed;

  return {
    status: empty ? "empty" : complete ? "complete" : "partial",
    productsTracked: input.productsTracked,
    productsTotal: input.productsTotal,
    coveragePercent: coveragePercentMetric(input),
    inventoryEntries: input.inventoryEntries,
    unlinkedEntries: input.unlinkedEntries,
    lastSyncedAt: input.lastSyncedAt,
    notes,
  };
}

export function buildConfidence(input: {
  readonly coverage: InventoryCoverage;
  readonly sync: InventorySyncState;
}): InventoryConfidence {
  const stale = input.sync.staleResources.includes("inventory");

  const level: InventoryConfidence["level"] =
    !input.sync.inventorySynced ||
    input.sync.inventorySyncFailed ||
    input.coverage.status === "empty"
      ? "low"
      : input.coverage.status === "partial" || stale
        ? "medium"
        : "high";

  return {
    level,
    inventorySynced: input.sync.inventorySynced,
    syncFailed: input.sync.inventorySyncFailed,
    stale,
    coverageStatus: input.coverage.status,
  };
}

/**
 * The composite health index, from four measured shares.
 *
 * `coverage` is the share of the catalogue with inventory data; the other three
 * are shares of the products whose stock is known, so a product with no row never
 * counts as "in stock" by omission.
 *
 * | state | result |
 * |---|---|
 * | no catalogue | `unavailable("no_products_stored")` |
 * | catalogue but no inventory rows | `unavailable("inventory_not_synced")` |
 * | coverage below 100% | `partial` — the index describes the known part only |
 * | complete coverage | `available` |
 */
export function buildHealthScore(input: {
  readonly productsTotal: number;
  readonly productsTracked: number;
  readonly inStock: number;
  readonly lowStock: number;
  readonly outOfStock: number;
  readonly unlimited: number;
  readonly negativeQuantity: number;
  readonly inventorySynced: boolean;
}): Metric<number> {
  if (input.productsTotal === 0) {
    return unavailable("no_products_stored", "weighted inventory health components");
  }

  if (input.inventorySynced === false && input.productsTracked === 0) {
    return unavailable("inventory_not_synced", "weighted inventory health components");
  }

  const known = input.productsTracked;
  const weights = INVENTORY_THRESHOLDS.HEALTH_WEIGHT;

  const coverageShare = percent(known, input.productsTotal);
  const availableShare = percent(input.inStock + input.unlimited, known);
  const lowShare = percent(input.lowStock, known);
  const outShare = percent(input.outOfStock, known);

  const score =
    Math.round(
      (weights.coverage * (coverageShare / 100) +
        weights.availability * (availableShare / 100) +
        weights.lowStock * (1 - lowShare / 100) +
        weights.outOfStock * (1 - outShare / 100)) *
        10,
    ) / 10;

  const basis =
    "coverage×25 + availability×35 + (100−low share)×20 + (100−out share)×20, over known stock";

  const complete = known === input.productsTotal && input.negativeQuantity === 0;

  return complete
    ? available(score, basis)
    : partial(
        score,
        basis,
        known === input.productsTotal ? "negative_quantity_present" : "inventory_coverage_partial",
      );
}

export function buildOverview(input: {
  readonly productsTotal: number;
  readonly analyses: readonly ProductInventoryAnalysis[];
  readonly coverage: InventoryCoverage;
  readonly sync: InventorySyncState;
}): { overview: InventoryOverview; counts: InventoryReport["counts"] } {
  const statusOf = (status: ProductInventoryAnalysis["status"]) =>
    input.analyses.filter((product) => product.status === status).length;

  const inStock = statusOf("in_stock");
  const lowStock = statusOf("low_stock");
  const outOfStock = statusOf("out_of_stock");
  const unlimited = statusOf("unlimited");
  const unknown = statusOf("unknown");

  const known = inStock + lowStock + outOfStock + unlimited;
  const productsTracked = known;
  const negativeQuantity = input.analyses.filter(
    (product) => product.stock.availability === "available" && (product.stock.value ?? 0) < 0,
  ).length;
  const highStockQuantity = input.analyses.filter((product) => product.highStockQuantity).length;
  const totalUnits = input.analyses
    .filter((product) => product.stock.availability === "available" && product.unlimited !== true)
    .reduce((sum, product) => sum + Math.max(0, product.stock.value ?? 0), 0);

  const overview: InventoryOverview = {
    productsTotal:
      input.productsTotal === 0
        ? input.sync.inventorySynced
          ? available(0, "count(products where store_id = ?)")
          : unavailable("no_products_stored", "count(products where store_id = ?)")
        : available(input.productsTotal, "count(products where store_id = ?)"),
    productsTracked:
      known === 0
        ? unavailable(
            input.sync.inventorySynced ? "no_inventory_rows" : "inventory_not_synced",
            "products with at least one inventory row",
          )
        : known === input.productsTotal && input.sync.inventorySynced
          ? available(known, "products with at least one inventory row")
          : partial(
              known,
              "products with at least one inventory row",
              input.sync.inventorySynced
                ? "products_without_inventory_record"
                : "inventory_not_synced",
            ),
    inventoryCoveragePercent: input.coverage.coveragePercent,
    inStock:
      known === 0
        ? unavailable(
            input.sync.inventorySynced ? "no_inventory_rows" : "inventory_not_synced",
            "products with quantity above the low-stock threshold",
          )
        : available(inStock, "products with quantity above the low-stock threshold"),
    lowStock:
      known === 0
        ? unavailable(
            input.sync.inventorySynced ? "no_inventory_rows" : "inventory_not_synced",
            `products with 0 < quantity <= ${INVENTORY_THRESHOLDS.LOW_STOCK_UNITS}`,
          )
        : available(
            lowStock,
            `products with 0 < quantity <= ${INVENTORY_THRESHOLDS.LOW_STOCK_UNITS}`,
          ),
    outOfStock:
      known === 0
        ? unavailable(
            input.sync.inventorySynced ? "no_inventory_rows" : "inventory_not_synced",
            "products with quantity <= 0 and not unlimited",
          )
        : available(outOfStock, "products with quantity <= 0 and not unlimited"),
    unlimited:
      known === 0
        ? unavailable(
            input.sync.inventorySynced ? "no_inventory_rows" : "inventory_not_synced",
            "products with unlimited_quantity = true",
          )
        : available(unlimited, "products with unlimited_quantity = true"),
    unknownStock:
      input.productsTotal === 0
        ? unavailable("no_products_stored", "catalogued products with no inventory row")
        : available(unknown, "catalogued products with no inventory row"),
    highStockQuantity:
      known === 0
        ? unavailable(
            "no_inventory_rows",
            `products with quantity >= ${INVENTORY_THRESHOLDS.HIGH_STOCK_UNITS}`,
          )
        : available(
            highStockQuantity,
            `products with quantity >= ${INVENTORY_THRESHOLDS.HIGH_STOCK_UNITS} and not unlimited — a quantity observation, not overstock`,
          ),
    totalUnits:
      known === 0
        ? unavailable("no_inventory_rows", "sum of non-unlimited quantities")
        : available(totalUnits, "sum of non-unlimited quantities"),
    negativeQuantity:
      known === 0
        ? unavailable("no_inventory_rows", "products with quantity < 0")
        : available(negativeQuantity, "products with quantity < 0"),
    healthScore: buildHealthScore({
      productsTotal: input.productsTotal,
      productsTracked,
      inStock,
      lowStock,
      outOfStock,
      unlimited,
      negativeQuantity,
      inventorySynced: input.sync.inventorySynced,
    }),
    // The three forecast metrics are catalogue-wide for the same reason they are
    // per-product: they need a demand rate that does not exist.
    daysOfStock: unavailable(DEMAND_UNAVAILABLE_REASON, "stock ÷ daily demand"),
    deadStock: unavailable(EXCESS_UNAVAILABLE_REASON, "quantity > 0 AND demand = 0 over a window"),
    reorderQuantity: unavailable(REORDER_MISSING_INPUTS[0]!, "demand × cover − stock"),
  };

  return {
    overview,
    counts: {
      productsTotal: input.productsTotal,
      productsTracked,
      inStock,
      lowStock,
      outOfStock,
      unlimited,
      unknown,
      highStockQuantity,
      totalUnits,
      negativeQuantity,
      inventoryEntries: input.coverage.inventoryEntries,
      unlinkedEntries: input.coverage.unlinkedEntries,
    },
  };
}

export function buildInventoryReport(input: {
  readonly products: readonly InventoryProductInput[];
  readonly analyses: readonly ProductInventoryAnalysis[];
  readonly unlinkedEntries: readonly UnlinkedInventoryEntry[];
  readonly coverage: InventoryCoverage;
  readonly sync: InventorySyncState;
}): InventoryReport {
  const { overview, counts } = buildOverview({
    productsTotal: input.products.length,
    analyses: input.analyses,
    coverage: input.coverage,
    sync: input.sync,
  });

  return {
    overview,
    coverage: input.coverage,
    confidence: buildConfidence({ coverage: input.coverage, sync: input.sync }),
    issues: summariseIssues({
      products: input.products,
      analyses: input.analyses,
      unlinkedEntries: input.unlinkedEntries,
      productsTotal: input.products.length,
      inventoryEntries: input.coverage.inventoryEntries,
    }),
    counts,
  };
}
