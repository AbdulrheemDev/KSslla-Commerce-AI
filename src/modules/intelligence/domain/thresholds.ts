/**
 * Every threshold used by the deterministic engines, in one place.
 *
 * Why these numbers: Phase 07 has no historical sales series (Salla documents no
 * per-period sales endpoint for registered apps, and `sold_quantity` carries no
 * period). The thresholds below are therefore **operational rules of thumb**,
 * chosen to be explainable, not statistically fitted. They are constants rather
 * than per-store settings so that two merchants with identical data always get
 * identical classifications, and every rule that fires can be explained by the
 * same number.
 *
 * Each constant states the unit, the rule that uses it, and the consequence of
 * changing it.
 */

export const THRESHOLDS = {
  /**
   * Units. A product at or below this stock level is "low".
   * Used by: `low_stock`, `high_sales_low_stock`, product `inventory_risk`.
   * Raising it flags more products; lowering it hides risk until the shelf is
   * nearly empty.
   */
  LOW_STOCK_UNITS: 5,

  /**
   * Units. A product with zero stock and at least this many cumulative sales is
   * an outage that already cost sales, not dead inventory.
   */
  OUT_OF_STOCK_MIN_SALES: 1,

  /**
   * Units (cumulative `sold_quantity`). At or above this a product is a `star`.
   */
  STAR_SALES_UNITS: 10,

  /**
   * Units (cumulative). At or above this — but below `STAR_SALES_UNITS` — a
   * product is a `growth_opportunity`.
   */
  GROWTH_SALES_UNITS: 3,

  /**
   * Units. Stock at or above this with **zero** cumulative sales is overstock.
   * 50 is a deliberately high bar: it should mean "this is not moving at all",
   * not "this is slow".
   */
  OVERSTOCK_UNITS: 50,

  /**
   * Products. A category needs at least this many products before it can be
   * called `weak_category`; one unsold product is not a category verdict.
   */
  WEAK_CATEGORY_MIN_PRODUCTS: 2,

  /**
   * Orders. Completed orders in the last 30 days that give a full sales-activity
   * component (100%). Below it the component scales linearly.
   */
  SALES_ACTIVITY_TARGET_ORDERS: 10,

  /**
   * Hours. A resource whose last successful sync is older than this is stale.
   * Used by Store Health and the `stale_sync` opportunity.
   */
  STALE_SYNC_HOURS: 24,

  /**
   * Days. A store with no completed order in this window raises
   * `no_recent_sales` (only when the orders mirror is actually synced).
   */
  NO_SALES_WINDOW_DAYS: 30,
} as const;

export type ThresholdName = keyof typeof THRESHOLDS;

/** Arabic labels for UI; the engines themselves stay language-neutral. */
export const THRESHOLD_LABELS_AR: Record<ThresholdName, string> = {
  LOW_STOCK_UNITS: "حد المخزون المنخفض (وحدات)",
  OUT_OF_STOCK_MIN_SALES: "أقل مبيعات تُعدّ خسارة عند النفاد",
  STAR_SALES_UNITS: "حد المنتج النجم (وحدات مبيعة)",
  GROWTH_SALES_UNITS: "حد فرصة النمو (وحدات مبيعة)",
  OVERSTOCK_UNITS: "حد التكدّس (وحدات)",
  WEAK_CATEGORY_MIN_PRODUCTS: "أقل عدد منتجات لتصنيف فئة ضعيفة",
  SALES_ACTIVITY_TARGET_ORDERS: "هدف الطلبات المكتملة (30 يومًا)",
  STALE_SYNC_HOURS: "حد قِدَم المزامنة (ساعات)",
  NO_SALES_WINDOW_DAYS: "نافذة انعدام المبيعات (أيام)",
};
