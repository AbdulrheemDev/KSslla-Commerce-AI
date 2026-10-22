/**
 * Every threshold used by the sales-intelligence engines, in one place.
 *
 * Each constant states its unit, the rule that reads it, and the consequence of
 * moving it. Nothing in `metrics.ts`, `trends.ts`, `seasonality.ts`,
 * `leakage.ts`, or `anomalies.ts` compares a number against a literal.
 *
 * Why these values: there is no historical baseline to fit a model to — the
 * mirror holds the orders that happened, not a benchmark. The numbers below are
 * therefore **operational rules of thumb**, chosen so that a merchant can read
 * the alert and check the arithmetic. They are constants rather than per-store
 * settings so two stores with identical data always get identical verdicts.
 */

export const SALES_THRESHOLDS = {
  // ── Anomaly comparison ────────────────────────────────────────────────────
  /**
   * Orders. The previous window needs at least this many counted orders before
   * any percentage comparison is allowed. Below it a single order swings the
   * percentage by tens of points, and an "alert" would be noise.
   */
  MIN_BASELINE_ORDERS: 5,

  /**
   * Orders. The current window needs this many counted orders for rate-based
   * rules (cancellation share, completion share). Volume-drop rules do not use
   * it: going from 20 orders to 0 is a real signal even though "current" is 0.
   */
  MIN_CURRENT_ORDERS_FOR_RATES: 3,

  /**
   * Percent. Recognized revenue falling by at least this much versus the
   * previous equal-length window raises `revenue_drop`.
   */
  ANOMALY_REVENUE_DROP_PERCENT: 20,

  /** Percent. At or beyond this drop the anomaly escalates to `high`. */
  ANOMALY_REVENUE_DROP_SEVERE_PERCENT: 35,

  /** Percent. Counted orders falling by at least this much raises `orders_drop`. */
  ANOMALY_ORDERS_DROP_PERCENT: 25,

  /** Percent. At or beyond this drop the anomaly escalates to `high`. */
  ANOMALY_ORDERS_DROP_SEVERE_PERCENT: 40,

  /**
   * Percent. An absolute AOV move (rise or fall) of at least this size raises
   * `aov_change`. A rise matters too: it can mean a pricing change, a basket
   * shift, or a missing cheap product.
   */
  ANOMALY_AOV_CHANGE_PERCENT: 25,

  /** Percent. At or beyond this move the anomaly escalates to `high`. */
  ANOMALY_AOV_CHANGE_SEVERE_PERCENT: 40,

  /**
   * Percentage points. Cancellation share rising by at least this much between
   * the two windows raises `cancellation_spike`.
   */
  ANOMALY_CANCELLATION_SPIKE_POINTS: 10,

  /** Percentage points. At or beyond this rise the anomaly escalates to `high`. */
  ANOMALY_CANCELLATION_SPIKE_SEVERE_POINTS: 20,

  /**
   * Percent. The spike also needs a meaningful absolute level; a move from 0%
   * to 10% on ten orders is one extra cancellation, not a trend.
   */
  ANOMALY_CANCELLATION_MIN_RATE_PERCENT: 10,

  /**
   * Percentage points. Completed share falling by at least this much raises
   * `completion_drop`. It flags orders moving into other, undocumented statuses.
   */
  ANOMALY_COMPLETION_DROP_POINTS: 15,

  /** Percentage points. At or beyond this fall the anomaly escalates to `high`. */
  ANOMALY_COMPLETION_DROP_SEVERE_POINTS: 25,

  // ── Leakage signals ───────────────────────────────────────────────────────
  /**
   * Percent. An absolute cancellation rate at or above this, together with the
   * spike rule above, is reported as a leakage signal.
   */
  LEAKAGE_CANCELLATION_RATE_PERCENT: 10,

  /**
   * Percent. Revenue falling by at least this much while order volume stays
   * flat is a leakage signal: the same number of buyers spent less.
   */
  LEAKAGE_REVENUE_DROP_PERCENT: 15,

  /**
   * Percent. AOV falling by at least this much while order volume stays flat is
   * a leakage signal: the same demand is spending less.
   */
  LEAKAGE_AOV_DROP_PERCENT: 15,

  /**
   * Percent. "Volume stayed flat" means the order-count change is inside
   * ± this tolerance.
   */
  LEAKAGE_STABLE_ORDERS_TOLERANCE_PERCENT: 5,

  /**
   * Percent. Share of counted orders sitting in neither `completed` nor
   * `canceled` at or above this level is reported as stuck orders. It is a
   * signal to review the status flow, not proof of lost money.
   */
  LEAKAGE_STUCK_ORDERS_SHARE_PERCENT: 25,

  /**
   * Orders. Draft orders at or above this count — together with the share rule
   * below — flag an operational leak in how drafts are handled. Drafts are
   * documented order rows (`draft: true`), not carts.
   */
  LEAKAGE_DRAFT_PILE_MIN_COUNT: 10,

  /** Percent. Draft share of (drafts + counted orders) at or above this level. */
  LEAKAGE_DRAFT_PILE_SHARE_PERCENT: 20,

  // ── Seasonality ───────────────────────────────────────────────────────────
  /**
   * Days. The requested window must span at least eight weeks, and the stored
   * history must start at or before the window, before weekday patterns are
   * computed. Four occurrences of a weekday is not a pattern.
   */
  SEASONALITY_MIN_DAYS: 56,

  /**
   * Days. Each weekday must appear at least this many times inside the window.
   * Eight occurrences is the eight-week minimum expressed per weekday.
   */
  SEASONALITY_MIN_OCCURRENCES_PER_WEEKDAY: 8,

  /**
   * Orders. Total counted orders in the window must reach this before any
   * weekday claim is made; below it a single order defines a "peak day".
   */
  SEASONALITY_MIN_ORDERS: 28,

  /**
   * Ratio. The strongest weekday's revenue index must exceed the weakest by at
   * least this factor before the analysis says a pattern exists. Below it the
   * honest answer is "no clear pattern", not a ranked list of noise.
   */
  SEASONALITY_MIN_CONTRAST_RATIO: 1.25,

  // ── Trend buckets ─────────────────────────────────────────────────────────
  /**
   * Buckets. A hard ceiling on emitted trend points (a 366-day custom window at
   * daily granularity is 366 points; weekly or monthly produce fewer).
   */
  TREND_MAX_BUCKETS: 400,
} as const;

export type SalesThresholdName = keyof typeof SALES_THRESHOLDS;

/** Arabic labels for the UI; the engines themselves stay language-neutral. */
export const SALES_THRESHOLD_LABELS_AR: Record<SalesThresholdName, string> = {
  MIN_BASELINE_ORDERS: "أقل عدد طلبات في الفترة السابقة للمقارنة",
  MIN_CURRENT_ORDERS_FOR_RATES: "أقل عدد طلبات لحساب النسب",
  ANOMALY_REVENUE_DROP_PERCENT: "حد هبوط الإيراد (٪)",
  ANOMALY_REVENUE_DROP_SEVERE_PERCENT: "حد الهبوط الحاد للإيراد (٪)",
  ANOMALY_ORDERS_DROP_PERCENT: "حد هبوط الطلبات (٪)",
  ANOMALY_ORDERS_DROP_SEVERE_PERCENT: "حد الهبوط الحاد للطلبات (٪)",
  ANOMALY_AOV_CHANGE_PERCENT: "حد تغيّر متوسط قيمة الطلب (٪)",
  ANOMALY_AOV_CHANGE_SEVERE_PERCENT: "حد التغيّر الحاد للمتوسط (٪)",
  ANOMALY_CANCELLATION_SPIKE_POINTS: "حد ارتفاع نسبة الإلغاء (نقطة مئوية)",
  ANOMALY_CANCELLATION_SPIKE_SEVERE_POINTS: "حد الارتفاع الحاد لنسبة الإلغاء (نقطة)",
  ANOMALY_CANCELLATION_MIN_RATE_PERCENT: "أقل نسبة إلغاء مطلقة للتنبيه (٪)",
  ANOMALY_COMPLETION_DROP_POINTS: "حد هبوط نسبة الاكتمال (نقطة مئوية)",
  ANOMALY_COMPLETION_DROP_SEVERE_POINTS: "حد الهبوط الحاد لنسبة الاكتمال (نقطة)",
  LEAKAGE_CANCELLATION_RATE_PERCENT: "حد نسبة الإلغاء في إشارات التسرّب (٪)",
  LEAKAGE_REVENUE_DROP_PERCENT: "حد هبوط الإيراد في إشارات التسرّب (٪)",
  LEAKAGE_AOV_DROP_PERCENT: "حد هبوط المتوسط في إشارات التسرّب (٪)",
  LEAKAGE_STABLE_ORDERS_TOLERANCE_PERCENT: "هامش ثبات حجم الطلبات (٪)",
  LEAKAGE_STUCK_ORDERS_SHARE_PERCENT: "حد حصة الطلبات المعلّقة (٪)",
  LEAKAGE_DRAFT_PILE_MIN_COUNT: "أقل عدد مسودّات لتسجيل إشارة (طلب)",
  LEAKAGE_DRAFT_PILE_SHARE_PERCENT: "حد حصة المسودّات (٪)",
  SEASONALITY_MIN_DAYS: "أقل مدة لأيام لموسمية (يوم)",
  SEASONALITY_MIN_OCCURRENCES_PER_WEEKDAY: "أقل تكرار لكل يوم أسبوع",
  SEASONALITY_MIN_ORDERS: "أقل عدد طلبات لتحليل الموسمية",
  SEASONALITY_MIN_CONTRAST_RATIO: "أقل تباين مطلوب لاعتبار النمط موسميًا",
  TREND_MAX_BUCKETS: "أقصى عدد نقاط في سلسلة الاتجاه",
};
