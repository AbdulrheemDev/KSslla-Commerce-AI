/**
 * Every number the product-intelligence engines compare against, in one place.
 *
 * Why these values: the mirror holds a catalogue, not a benchmark. No merchant
 * average, no industry statistic, and no model output exists behind them. They
 * are **editorial rules of thumb** chosen so that a merchant can read a finding,
 * open the product, and check the arithmetic by hand. Being constants rather
 * than per-store settings means two stores with identical catalogues always get
 * identical verdicts.
 *
 * Each entry states the unit, the rule that reads it, and what changes when the
 * number moves.
 */

export const PRODUCT_THRESHOLDS = {
  // ── Identity and content ──────────────────────────────────────────────────

  /**
   * Characters (Unicode code points). A product name shorter than this is
   * reported as `short_name`: it is unlikely to describe the product in a
   * listing, a search result, or a share card.
   * Raising it flags more names; lowering it accepts one-word labels.
   */
  MIN_NAME_CHARS: 3,

  /**
   * Characters (Unicode code points). A description shorter than this is
   * reported as `short_description`. 120 characters is roughly two Arabic
   * sentences — enough to state what the product is and what it includes, which
   * is the smallest amount that can answer a shopper's first question.
   * This is **not** an SEO guideline: no search engine rule is claimed here.
   */
  MIN_DESCRIPTION_CHARS: 120,

  // ── Lifecycle ─────────────────────────────────────────────────────────────

  /**
   * Days. A product whose provider `updated_at` is older than this is reported
   * as `stale_content`. 90 days is a quarter: long enough that a seasonal
   * catalogue is not flagged every month, short enough to catch a product that
   * has not been touched since last year.
   */
  STALE_CONTENT_DAYS: 90,

  /**
   * Days. A product updated within this window is described as "recently
   * updated". Informational only — it never produces an issue.
   */
  RECENT_UPDATE_DAYS: 14,

  // ── Ranking ───────────────────────────────────────────────────────────────

  /**
   * Weight per severity in the issue ranking. An issue's score is
   * `weight × affected products`, so a high-severity gap on three products
   * (9) outranks a low-severity note on eight (8). The formula is printed in
   * the API payload so the order can be recomputed from the response alone.
   */
  SEVERITY_WEIGHT: {
    high: 3,
    medium: 2,
    low: 1,
  },

  /**
   * Content-quality weights. They sum to 100, and each one is the number of
   * points a product keeps when the matching check passes. A product with a
   * name, a description at/above the length threshold, a URL, and a SKU but no
   * description content in the check order below scores 0 for the description
   * pair and keeps the rest.
   */
  CONTENT_WEIGHT: {
    name: 25,
    description: 30,
    descriptionLength: 15,
    url: 15,
    sku: 15,
  },

  /**
   * Metadata weights (title / description). The provider documents both fields
   * inside the product `metadata` object; they are weighted equally because
   * neither is more "correct" than the other.
   */
  METADATA_WEIGHT: {
    title: 50,
    description: 50,
  },

  // ── Categories ────────────────────────────────────────────────────────────

  /**
   * Products. A category needs at least this many products before its health is
   * judged. Below it the percentages describe one product, not a category, and
   * the UI says so instead of colouring the row.
   */
  MIN_PRODUCTS_FOR_CATEGORY_HEALTH: 1,

  // ── Inventory indicator ───────────────────────────────────────────────────

  /**
   * Units. Stock at or below this level (and above zero) is shown as "low" in
   * the catalogue table. It is the same figure Phase 07 uses so the two screens
   * cannot disagree about one product.
   */
  LOW_STOCK_UNITS: 5,
} as const;

export type ProductThresholdName = keyof typeof PRODUCT_THRESHOLDS;

/** Arabic labels for the UI; the engines themselves stay language-neutral. */
export const PRODUCT_THRESHOLD_LABELS_AR: Record<string, string> = {
  MIN_NAME_CHARS: "أقل طول لاسم المنتج (حرفًا)",
  MIN_DESCRIPTION_CHARS: "أقل طول لوصف مفيد (حرفًا)",
  STALE_CONTENT_DAYS: "حد قِدَم تحديث المنتج (يومًا)",
  RECENT_UPDATE_DAYS: "نافذة التحديث الحديث (يومًا)",
  LOW_STOCK_UNITS: "حد المخزون المنخفض (وحدات)",
};
