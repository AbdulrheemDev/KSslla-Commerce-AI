import type { Metric } from "@/modules/intelligence/domain/types";
import type { Severity } from "@/modules/intelligence/domain/opportunities";

/**
 * Vocabulary for inventory intelligence.
 *
 * It reuses Phase 07's `Metric` (value + availability + basis + reason) so a
 * missing number looks the same on every intelligence screen, and Phase 07's
 * `Severity` so an issue's weight means one thing across the product.
 *
 * There is no period in this module. The mirror holds *current* stock, and every
 * time-dependent question (days of stock, stockout prediction, dead stock,
 * reorder quantity) needs a demand rate that this data cannot produce. Those
 * fields therefore exist in the contract and are permanently `unavailable` with a
 * reason, rather than being omitted — a missing column hides the gap, an
 * unavailable metric explains it.
 */

/** Stock state of one product, from mirrored quantities only. */
export type InventoryStatus =
  | "unlimited"
  | "out_of_stock"
  | "low_stock"
  | "in_stock"
  /** No inventory row exists for this product. */
  | "unknown";

/** Predicted stockout proximity. `unknown` is the only value reachable today. */
export type StockoutRisk = "critical" | "warning" | "watch" | "normal" | "unknown";

/** One provider quantity entry, aggregated to a product. */
export interface InventoryStockState {
  readonly quantity: number;
  readonly soldQuantity: number;
  readonly unlimitedQuantity: boolean;
  /** Number of provider entries (variants) summed into this product. */
  readonly entries: number;
  readonly variants: readonly string[];
  readonly lastSyncedAt: string;
}

/** One product as the analysis needs it. */
export interface InventoryProductInput {
  readonly id: string;
  readonly name: string;
  readonly sku: string | null;
  readonly productStatus: string;
  readonly categories: readonly InventoryCategoryRef[];
  /** Present only when `inventory_levels` has at least one linked row. */
  readonly stock: InventoryStockState | null;
}

export interface InventoryCategoryRef {
  readonly id: string;
  readonly name: string;
  readonly status: string;
}

/** An inventory row that could not be linked to a catalogued product. */
export interface UnlinkedInventoryEntry {
  readonly quantity: number;
  readonly soldQuantity: number;
  readonly unlimitedQuantity: boolean;
  readonly productName: string;
  readonly externalProductId: string;
  readonly lastSyncedAt: string;
}

/**
 * Whether demand is known for a product.
 *
 * Today it never is. The type exists so a future documented source can be wired
 * in without changing any downstream signature, and so the reason travels with
 * the value instead of being assumed.
 */
export interface DemandResolution {
  /** Units per day. `unavailable` until a documented product-level source exists. */
  readonly dailyDemand: Metric<number>;
}

export interface ProductInventoryAnalysis {
  readonly id: string;
  readonly name: string;
  readonly sku: string | null;
  readonly productStatus: string;
  readonly categories: readonly string[];
  readonly categoryRefs: readonly InventoryCategoryRef[];
  readonly status: InventoryStatus;
  readonly stock: Metric<number>;
  readonly unlimited: boolean | null;
  readonly entries: number;
  readonly variants: readonly string[];
  readonly lastSyncedAt: string | null;
  /** Cumulative provider counter; period undocumented, never converted to a rate. */
  readonly cumulativeSoldQuantity: Metric<number>;
  readonly demand: DemandResolution;
  /** `stock ÷ dailyDemand`. Unavailable while demand is. */
  readonly daysOfStock: Metric<number>;
  /** From `daysOfStock`, so also `unknown` while demand is. */
  readonly stockoutRisk: StockoutRisk;
  readonly stockoutRiskReason: string | null;
  readonly highStockQuantity: boolean;
  /** Needs demand + observation window; unavailable today. */
  readonly deadStock: Metric<boolean>;
  /** Needs demand; unavailable today. */
  readonly excessInventory: Metric<number>;
  /** Needs demand + lead time + safety stock; unavailable today. */
  readonly reorderQuantity: Metric<number>;
  readonly reorderMissingInputs: readonly string[];
  readonly issues: readonly string[];
  readonly severity: Severity | null;
}

/** Aggregated issue row: one rule, every item it fired on. */
export interface InventoryIssueSummary {
  readonly id: string;
  readonly category: "coverage" | "availability" | "quality" | "demand";
  readonly severity: Severity;
  /** What the rule counted: products or raw inventory entries. */
  readonly population: "products" | "inventory_entries";
  readonly affectedCount: number;
  readonly affectedPercent: number;
  /** `affectedCount × SEVERITY_WEIGHT[severity]`. */
  readonly score: number;
  readonly rule: string;
  readonly definition: string;
  readonly evidence: readonly string[];
}

export interface InventoryRecommendation {
  readonly id: string;
  readonly issueId: string;
  readonly title: string;
  readonly rationale: string;
  readonly priority: "P1" | "P2" | "P3";
  readonly severity: Severity;
  readonly rule: string;
  readonly affectedCount: number;
  readonly affectedPercent: number;
  readonly evidence: readonly string[];
  /** Structural: a recommendation is never an executed action. */
  readonly advisoryOnly: true;
}

export interface InventoryCoverage {
  readonly status: "complete" | "partial" | "empty";
  /** Products with at least one linked inventory row. */
  readonly productsTracked: number;
  readonly productsTotal: number;
  /** Tracked ÷ total, or `unavailable` when there is no catalogue to divide by. */
  readonly coveragePercent: Metric<number>;
  readonly inventoryEntries: number;
  readonly unlinkedEntries: number;
  readonly lastSyncedAt: string | null;
  readonly notes: readonly string[];
}

export interface InventoryConfidence {
  readonly level: "high" | "medium" | "low";
  readonly inventorySynced: boolean;
  readonly syncFailed: boolean;
  readonly stale: boolean;
  readonly coverageStatus: InventoryCoverage["status"];
}

export interface InventoryOverview {
  readonly productsTotal: Metric<number>;
  readonly productsTracked: Metric<number>;
  readonly inventoryCoveragePercent: Metric<number>;
  readonly inStock: Metric<number>;
  readonly lowStock: Metric<number>;
  readonly outOfStock: Metric<number>;
  readonly unlimited: Metric<number>;
  readonly unknownStock: Metric<number>;
  readonly highStockQuantity: Metric<number>;
  readonly totalUnits: Metric<number>;
  readonly negativeQuantity: Metric<number>;
  readonly healthScore: Metric<number>;
  /** Always unavailable: no documented product-level demand source. */
  readonly daysOfStock: Metric<number>;
  readonly deadStock: Metric<number>;
  readonly reorderQuantity: Metric<number>;
}

export interface InventorySyncState {
  readonly inventorySynced: boolean;
  readonly inventorySyncFailed: boolean;
  readonly lastInventorySyncAt: string | null;
  readonly staleResources: readonly string[];
}
