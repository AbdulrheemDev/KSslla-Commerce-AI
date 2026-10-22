import type { Confidence, Severity } from "@/modules/intelligence/domain/opportunities";
import type { OpportunityEvidence } from "@/modules/intelligence/domain/opportunities";

import type { SalesOverviewMetrics } from "./metrics";
import { SALES_THRESHOLDS } from "./thresholds";

/**
 * Sales leakage — only the signals the stored data can actually support.
 *
 * A leak means "demand exists but does not turn into recognized revenue".
 * Proving that needs either traffic/conversion/cart data, which this project
 * does **not** mirror, or a signal inside the sales numbers themselves. This
 * module therefore does two things:
 *
 * 1. it evaluates five rules that use only mirrored orders;
 * 2. it states, explicitly, which classic leak metrics are unavailable and why.
 *
 * No rule fires without a baseline, a single currency, a completed sync, and
 * enough orders on both sides of the comparison.
 */

export type LeakageSignalType =
  | "cancellation_rate_spike"
  | "aov_decline_with_stable_orders"
  | "revenue_decline_with_stable_orders"
  | "stuck_orders"
  | "draft_pile";

export interface LeakageSignal {
  id: string;
  type: LeakageSignalType;
  severity: Severity;
  confidence: Confidence;
  title: string;
  description: string;
  evidence: OpportunityEvidence[];
  recommendedAction: string;
  rationale: string;
}

export interface LeakageUnavailable {
  id: string;
  label: string;
  reason: string;
  detail: string;
}

export interface LeakageSkipped {
  rule: string;
  reason: string;
}

export interface LeakageReport {
  signals: LeakageSignal[];
  unavailable: LeakageUnavailable[];
  skipped: LeakageSkipped[];
}

export interface LeakageInput {
  metrics: SalesOverviewMetrics;
  hasBaseline: boolean;
  ordersSynced: boolean;
  syncIncomplete: boolean;
}

function round(value: number): number {
  return Math.round(value * 10) / 10;
}

function rate(cancelled: number | null, orders: number | null): number | null {
  if (cancelled === null || orders === null || orders === 0) return null;
  return round((cancelled / orders) * 100);
}

/**
 * Metrics that would make leakage detection stronger but have no mirrored
 * source in Phases 04–07. They are always reported as unavailable — never as
 * zero, and never approximated from order counts.
 */
export const UNAVAILABLE_LEAKAGE_SIGNALS: readonly LeakageUnavailable[] = [
  {
    id: "traffic",
    label: "زيارات المتجر",
    reason: "traffic_not_available",
    detail: "لا توجد بيانات زيارات أو جلسات محفوظة من Salla في هذا النظام.",
  },
  {
    id: "conversion",
    label: "معدل التحويل",
    reason: "conversion_not_available",
    detail: "معدل التحويل يحتاج زيارات وطلبات معًا؛ الزيارات غير متاحة، فلا يُحسب.",
  },
  {
    id: "cart_abandonment",
    label: "التخلي عن السلة",
    reason: "cart_data_not_available",
    detail: "لا تُحفظ سلال مهجورة؛ المسودّات (draft) طلبات فعلية وليست سلالًا.",
  },
];

function signal(
  type: LeakageSignalType,
  severity: Severity,
  confidence: Confidence,
  title: string,
  description: string,
  evidence: OpportunityEvidence[],
  recommendedAction: string,
  rationale: string,
  periodKey: string,
): LeakageSignal {
  return {
    id: `leakage:${type}:${periodKey}`,
    type,
    severity,
    confidence,
    title,
    description,
    evidence,
    recommendedAction,
    rationale,
  };
}

export function detectLeakage(input: LeakageInput, periodKey: string): LeakageReport {
  const skipped: LeakageSkipped[] = [
    { rule: "traffic", reason: "traffic_not_available" },
    { rule: "conversion", reason: "conversion_not_available" },
    { rule: "cart_abandonment", reason: "cart_data_not_available" },
  ];

  const empty: LeakageReport = {
    signals: [],
    unavailable: [...UNAVAILABLE_LEAKAGE_SIGNALS],
    skipped,
  };

  if (!input.ordersSynced) {
    return {
      ...empty,
      skipped: [...skipped, { rule: "all", reason: "orders_not_synced" }],
    };
  }

  if (input.syncIncomplete) {
    return {
      ...empty,
      skipped: [...skipped, { rule: "all", reason: "orders_sync_incomplete" }],
    };
  }

  const { metrics } = input;
  const signals: LeakageSignal[] = [];

  const orders = metrics.orders.value;
  const drafts = metrics.draftOrders.value;
  const other = metrics.otherStatusOrders.value;
  const currentRate = metrics.cancellationRate.value;
  const previousRate = rate(metrics.previousCancelledOrders.value, metrics.previousOrders.value);

  // ── Current-window-only rules ─────────────────────────────────────────────
  if (
    orders !== null &&
    orders >= SALES_THRESHOLDS.MIN_CURRENT_ORDERS_FOR_RATES &&
    other !== null
  ) {
    const stuckShare = round((other / orders) * 100);
    if (stuckShare >= SALES_THRESHOLDS.LEAKAGE_STUCK_ORDERS_SHARE_PERCENT) {
      signals.push(
        signal(
          "stuck_orders",
          stuckShare >= 50 ? "high" : "medium",
          "high",
          "طلبات خارج الاكتمال والإلغاء",
          "نسبة كبيرة من الطلبات ليست مكتملة ولا ملغاة. قد تكون حالات مخصّصة تنتظر شحنًا أو معالجة، وقد تكون طلبات متعثرة — البيانات لا تفرّق بينهما.",
          [
            { label: "طلبات بحالات أخرى", value: other },
            { label: "إجمالي الطلبات", value: orders },
            { label: "الحصة", value: stuckShare, unit: "%" },
          ],
          "راجع حالات الطلبات في Salla وتأكد من انتقال الطلبات إلى completed، أو وثّق الحالات المخصّصة.",
          `القاعدة: الحصة ≥ ${SALES_THRESHOLDS.LEAKAGE_STUCK_ORDERS_SHARE_PERCENT}% من الطلبات.`,
          periodKey,
        ),
      );
    }
  }

  if (drafts !== null) {
    const counted = orders ?? 0;
    const share = drafts + counted === 0 ? 0 : round((drafts / (drafts + counted)) * 100);
    if (
      drafts >= SALES_THRESHOLDS.LEAKAGE_DRAFT_PILE_MIN_COUNT &&
      share >= SALES_THRESHOLDS.LEAKAGE_DRAFT_PILE_SHARE_PERCENT
    ) {
      signals.push(
        signal(
          "draft_pile",
          "low",
          "high",
          "مسودّات طلبات متراكمة",
          "عدد المسودّات مرتفع نسبةً إلى الطلبات المحسوبة. المسودّة طلب موثّق لم يُكمل بعد، وتراكمها يعني طلبات لا تصل إلى الإيراد.",
          [
            { label: "المسودّات", value: drafts },
            { label: "الطلبات المحسوبة", value: counted },
            { label: "الحصة", value: share, unit: "%" },
          ],
          "راجع المسودّات: أكملها أو ألغِها حتى لا تبقى خارج المتابعة.",
          `القاعدة: عدد المسودّات ≥ ${SALES_THRESHOLDS.LEAKAGE_DRAFT_PILE_MIN_COUNT} وحصتها ≥ ${SALES_THRESHOLDS.LEAKAGE_DRAFT_PILE_SHARE_PERCENT}%.`,
          periodKey,
        ),
      );
    }
  }

  // ── Baseline comparisons ──────────────────────────────────────────────────
  if (!input.hasBaseline) {
    return {
      ...empty,
      signals,
      skipped: [...skipped, { rule: "comparisons", reason: "no_baseline_period" }],
    };
  }

  const previousOrders = metrics.previousOrders.value;
  if (previousOrders === null || previousOrders < SALES_THRESHOLDS.MIN_BASELINE_ORDERS) {
    return {
      ...empty,
      signals,
      skipped: [...skipped, { rule: "comparisons", reason: "insufficient_baseline_orders" }],
    };
  }

  const ordersGrowth = metrics.ordersGrowthPercent.value;
  const stableOrders =
    ordersGrowth !== null &&
    Math.abs(ordersGrowth) <= SALES_THRESHOLDS.LEAKAGE_STABLE_ORDERS_TOLERANCE_PERCENT;

  if (currentRate !== null && previousRate !== null) {
    const delta = round(currentRate - previousRate);
    if (
      orders !== null &&
      orders >= SALES_THRESHOLDS.MIN_CURRENT_ORDERS_FOR_RATES &&
      currentRate >= SALES_THRESHOLDS.LEAKAGE_CANCELLATION_RATE_PERCENT &&
      delta >= SALES_THRESHOLDS.ANOMALY_CANCELLATION_SPIKE_POINTS
    ) {
      signals.push(
        signal(
          "cancellation_rate_spike",
          delta >= SALES_THRESHOLDS.ANOMALY_CANCELLATION_SPIKE_SEVERE_POINTS ? "high" : "medium",
          "high",
          "ارتفاع نسبة الإلغاء",
          "نسبة الطلبات الملغاة ارتفعت مقارنة بالفترة السابقة. الإلغاء تصرّف موثّق لا إيراد، وارتفاعه يعني مبيعات خرجت من الحساب.",
          [
            { label: "نسبة الإلغاء الحالية", value: currentRate, unit: "%" },
            { label: "نسبة الإلغاء السابقة", value: previousRate, unit: "%" },
            { label: "الفرق", value: delta, unit: "نقطة" },
          ],
          "راجع أسباب الإلغاء ومدد الشحن ووسائل الدفع، وتواصل مع العملاء قبل الإلغاء.",
          `القاعدة: ارتفاع ≥ ${SALES_THRESHOLDS.ANOMALY_CANCELLATION_SPIKE_POINTS} نقطة والنسبة الحالية ≥ ${SALES_THRESHOLDS.LEAKAGE_CANCELLATION_RATE_PERCENT}%.`,
          periodKey,
        ),
      );
    }
  }

  if (stableOrders) {
    const revenueGrowth = metrics.revenueGrowthPercent.value;
    if (revenueGrowth !== null && revenueGrowth <= -SALES_THRESHOLDS.LEAKAGE_REVENUE_DROP_PERCENT) {
      signals.push(
        signal(
          "revenue_decline_with_stable_orders",
          revenueGrowth <= -SALES_THRESHOLDS.ANOMALY_REVENUE_DROP_SEVERE_PERCENT
            ? "high"
            : "medium",
          "high",
          "إيراد أقل بالعدد نفسه من الطلبات",
          "عدد الطلبات شبه ثابت، لكن الإيراد انخفض. الطلب نفسه صار يحمل قيمة أقل — تغيّر سلة أو سعر أو خصومات.",
          [
            { label: "الإيراد الحالي", value: metrics.recognizedRevenue.value },
            { label: "الإيراد السابق", value: metrics.previousRecognizedRevenue.value },
            { label: "نمو الإيراد", value: revenueGrowth, unit: "%" },
            { label: "تغيّر الطلبات", value: ordersGrowth, unit: "%" },
          ],
          "راجع الأسعار والعروض ومتوسط عدد الأصناف لكل طلب.",
          `القاعدة: هبوط الإيراد ≥ ${SALES_THRESHOLDS.LEAKAGE_REVENUE_DROP_PERCENT}% مع ثبات الطلبات ±${SALES_THRESHOLDS.LEAKAGE_STABLE_ORDERS_TOLERANCE_PERCENT}%.`,
          periodKey,
        ),
      );
    }

    const aovGrowth = metrics.averageOrderValueGrowthPercent.value;
    if (aovGrowth !== null && aovGrowth <= -SALES_THRESHOLDS.LEAKAGE_AOV_DROP_PERCENT) {
      signals.push(
        signal(
          "aov_decline_with_stable_orders",
          aovGrowth <= -SALES_THRESHOLDS.ANOMALY_AOV_CHANGE_SEVERE_PERCENT ? "high" : "medium",
          "high",
          "متوسط قيمة الطلب ينخفض",
          "متوسط قيمة الطلب انخفض مع ثبات حجم الطلبات: العملاء يشترون بالقدر نفسه تقريبًا لكن بقيمة أقل.",
          [
            { label: "المتوسط الحالي", value: metrics.averageOrderValue.value },
            { label: "المتوسط السابق", value: metrics.previousAverageOrderValue.value },
            { label: "التغيّر", value: aovGrowth, unit: "%" },
          ],
          "راجع الأسعار وحِزم المنتجات والحد الأدنى للشحن المجاني.",
          `القاعدة: هبوط المتوسط ≥ ${SALES_THRESHOLDS.LEAKAGE_AOV_DROP_PERCENT}% مع ثبات الطلبات.`,
          periodKey,
        ),
      );
    }
  }

  return { signals, unavailable: [...UNAVAILABLE_LEAKAGE_SIGNALS], skipped };
}

export const LEAKAGE_TYPE_LABELS_AR: Record<LeakageSignalType, string> = {
  cancellation_rate_spike: "ارتفاع الإلغاء",
  aov_decline_with_stable_orders: "هبوط المتوسط",
  revenue_decline_with_stable_orders: "هبوط الإيراد",
  stuck_orders: "طلبات معلّقة",
  draft_pile: "مسودّات متراكمة",
};
