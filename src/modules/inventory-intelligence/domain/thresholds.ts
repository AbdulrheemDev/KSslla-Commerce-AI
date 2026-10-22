/**
 * Every number the inventory-intelligence engines compare against.
 *
 * Two classes of constant live here, and the difference matters:
 *
 * 1. **Active** — used by the live pipeline against mirrored stock:
 *    the low-stock and high-quantity thresholds and the health-score weights.
 * 2. **Inactive** — the stockout risk bands. They are defined and unit-tested so
 *    the model is reviewable, but they cannot fire today because no product-level
 *    demand source exists (see `demand.ts`). A band that cannot be reached is
 *    safer than a number invented to reach it.
 *
 * All values are **editorial rules of thumb**, not fitted statistics. There is no
 * merchant benchmark or model output behind them. They are constants rather than
 * per-store settings so two stores with identical stock always get identical
 * verdicts, and every rule that fires can be checked by hand.
 */

export const INVENTORY_THRESHOLDS = {
  // ── Stock status ──────────────────────────────────────────────────────────

  /**
   * Units. Stock at or below this level (and above zero, and not unlimited) is
   * `low_stock`.
   *
   * 5 is the same figure Phase 07 uses for `LOW_STOCK_UNITS`; keeping one number
   * means the store-intelligence screen and this one can never disagree about a
   * product. It is an absolute threshold, **not** a forecast: it says "this shelf
   * is nearly empty", not "this will run out in N days". A coverage-based
   * threshold would need a demand rate, which does not exist for products here.
   *
   * Raising it flags more products; lowering it hides risk until the shelf is
   * nearly empty.
   */
  LOW_STOCK_UNITS: 5,

  /**
   * Units. Stock at or above this level (and not unlimited) is labelled
   * `high_stock` — a **quantity observation only**.
   *
   * It is deliberately *not* called overstock, excess, or dead stock. 100 units
   * of a fast mover is normal; 100 units of a seasonal item is not. Without a
   * demand rate neither claim can be made, so this constant feeds a neutral
   * label and nothing else.
   */
  HIGH_STOCK_UNITS: 50,

  // ── Stockout risk bands (inactive until a demand source exists) ───────────

  /**
   * Days of stock at or below this is `critical`. Also the window in which a
   * reorder would already be late for most supplier lead times.
   */
  STOCKOUT_CRITICAL_DAYS: 3,

  /** Days of stock at or below this (and above critical) is `warning`. */
  STOCKOUT_WARNING_DAYS: 7,

  /** Days of stock at or below this (and above warning) is `watch`. */
  STOCKOUT_WATCH_DAYS: 14,

  // ── Health score ──────────────────────────────────────────────────────────

  /**
   * Weights of the composite inventory-health index, summing to 100:
   *
   * - `coverage`      — how much of the catalogue has inventory data at all;
   * - `availability`  — share of known products that are not out of stock;
   * - `lowStock`      — share of known products above the low-stock threshold;
   * - `outOfStock`    — share of known products not out of stock.
   *
   * `availability` and `outOfStock` overlap by construction (a product out of
   * stock costs points twice). That is intentional and disclosed: an empty shelf
   * is the failure this index exists to surface, and the duplication is bounded
   * (at most 0.20 of the score). The index is a summary of measured shares, never
   * a probability, and it is reported `partial` whenever coverage is below 100%.
   */
  HEALTH_WEIGHT: {
    coverage: 25,
    availability: 35,
    lowStock: 20,
    outOfStock: 20,
  },

  // ── Ranking ───────────────────────────────────────────────────────────────

  /**
   * Weight per severity in the issue ranking: `score = affected × weight`.
   * Identical to Phase 07/08/09 so a severity means the same thing everywhere.
   */
  SEVERITY_WEIGHT: {
    high: 3,
    medium: 2,
    low: 1,
  },

  // ── Data quality ──────────────────────────────────────────────────────────

  /**
   * Hours. A stock snapshot older than this is reported as stale, and the
   * coverage banner says so. It does not change any stock status: a stale
   * quantity is still the last quantity the provider told us.
   */
  STALE_INVENTORY_HOURS: 24,
} as const;

export type InventoryThresholdName = keyof typeof INVENTORY_THRESHOLDS;

/** Arabic labels for the UI; the engines themselves stay language-neutral. */
export const INVENTORY_THRESHOLD_LABELS_AR: Record<string, string> = {
  LOW_STOCK_UNITS: "حد المخزون المنخفض (وحدات)",
  HIGH_STOCK_UNITS: "حد الكمية المرتفعة (وحدات)",
  STOCKOUT_CRITICAL_DAYS: "حد النفاد الحرج (أيام)",
  STOCKOUT_WARNING_DAYS: "حد التحذير (أيام)",
  STOCKOUT_WATCH_DAYS: "حد المراقبة (أيام)",
  STALE_INVENTORY_HOURS: "حد قِدَم لقطة المخزون (ساعات)",
};
