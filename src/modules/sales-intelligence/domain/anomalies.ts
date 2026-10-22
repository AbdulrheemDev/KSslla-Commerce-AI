import type { OpportunityEvidence } from "@/modules/intelligence/domain/opportunities";
import type { Confidence, Severity } from "@/modules/intelligence/domain/opportunities";
import type { AnalysisPeriod, Coverage } from "@/modules/intelligence/domain/types";

import type { SalesOverviewMetrics } from "./metrics";
import { SALES_THRESHOLDS } from "./thresholds";

/**
 * Deterministic anomaly detection — no model, no score, no black box.
 *
 * Every rule compares the requested window with the immediately preceding
 * window of the same length and fires only when **all** of the following hold:
 *
 * - the orders mirror has synced successfully and the last run did not fail;
 * - the coverage is not empty;
 * - the previous window sits inside the stored history;
 * - it contains at least `MIN_BASELINE_ORDERS` counted orders;
 * - the metric itself is available (single currency, usable totals).
 *
 * Each anomaly carries the observed value, the baseline, the exact threshold,
 * and the arithmetic behind the comparison, so a developer can reproduce the
 * verdict without any model output.
 */

export type AnomalyType =
  "revenue_drop" | "orders_drop" | "aov_change" | "cancellation_spike" | "completion_drop";

export interface SalesAnomaly {
  id: string;
  type: AnomalyType;
  severity: Severity;
  confidence: Confidence;
  metric: string;
  title: string;
  meaning: string;
  /** The current-window value the rule measured. */
  observed: number;
  /** The previous-window value it was compared against. */
  baseline: number;
  threshold: number;
  unit: "percent" | "points";
  change: number;
  evidence: OpportunityEvidence[];
  recommendedAction: string;
  rationale: string;
  period: { from: string; to: string; previousFrom: string; previousTo: string };
}

export interface SuppressedRule {
  rule: string;
  reason: string;
}

export interface AnomalyReport {
  baseline: {
    available: boolean;
    reason: string | null;
    from: string;
    to: string;
  };
  anomalies: SalesAnomaly[];
  suppressed: SuppressedRule[];
}

export interface AnomalyInput {
  metrics: SalesOverviewMetrics;
  hasBaseline: boolean;
  ordersSynced: boolean;
  syncIncomplete: boolean;
  coverage: Coverage;
  period: AnalysisPeriod;
  previous: AnalysisPeriod;
}

function round(value: number): number {
  return Math.round(value * 10) / 10;
}

function share(part: number | null, total: number | null): number | null {
  if (part === null || total === null || total === 0) return null;
  return round((part / total) * 100);
}

interface RuleContext {
  metrics: SalesOverviewMetrics;
  period: AnalysisPeriod;
  previous: AnalysisPeriod;
  periodKey: string;
}

function baseAnomaly(
  context: RuleContext,
  type: AnomalyType,
  severity: Severity,
  confidence: Confidence,
  metric: string,
  title: string,
  meaning: string,
  values: {
    observed: number;
    baseline: number;
    threshold: number;
    unit: "percent" | "points";
    change: number;
  },
  evidence: OpportunityEvidence[],
  recommendedAction: string,
  rationale: string,
): SalesAnomaly {
  return {
    id: `anomaly:${type}:${context.periodKey}`,
    type,
    severity,
    confidence,
    metric,
    title,
    meaning,
    ...values,
    evidence,
    recommendedAction,
    rationale,
    period: {
      from: context.period.from.toISOString(),
      to: context.period.to.toISOString(),
      previousFrom: context.previous.from.toISOString(),
      previousTo: context.previous.to.toISOString(),
    },
  };
}

export function detectAnomalies(input: AnomalyInput): AnomalyReport {
  const suppressed: SuppressedRule[] = [];
  const baseline = {
    available: false,
    reason: null as string | null,
    from: input.previous.from.toISOString(),
    to: input.previous.to.toISOString(),
  };

  const emptyReport = (reason: string): AnomalyReport => ({
    baseline: { ...baseline, reason },
    anomalies: [],
    suppressed: [{ rule: "all", reason }, ...suppressed],
  });

  if (!input.ordersSynced) return emptyReport("orders_not_synced");
  if (input.syncIncomplete) return emptyReport("orders_sync_incomplete");
  if (input.coverage.status === "empty") return emptyReport("no_orders_stored");
  if (!input.hasBaseline) return emptyReport("no_baseline_period");

  const { metrics } = input;
  const previousOrders = metrics.previousOrders.value;

  if (previousOrders === null) {
    return emptyReport(metrics.previousOrders.reason ?? "no_baseline_period");
  }

  if (previousOrders < SALES_THRESHOLDS.MIN_BASELINE_ORDERS) {
    return emptyReport("insufficient_baseline_orders");
  }

  baseline.available = true;

  const periodKey = input.period.from.toISOString().slice(0, 10);
  const context: RuleContext = {
    metrics,
    period: input.period,
    previous: input.previous,
    periodKey,
  };

  const anomalies: SalesAnomaly[] = [];
  const mixedCurrency = metrics.currency.reason === "mixed_currency";
  const orders = metrics.orders.value;
  const currentRate = metrics.cancellationRate.value;
  const previousRate = share(metrics.previousCancelledOrders.value, previousOrders);
  const completedShare = share(metrics.completedOrders.value, orders);
  const previousCompletedShare = share(metrics.previousCompletedOrders.value, previousOrders);

  // ── Revenue drop ──────────────────────────────────────────────────────────
  const revenueGrowth = metrics.revenueGrowthPercent.value;
  if (mixedCurrency) {
    suppressed.push({ rule: "revenue_drop", reason: "mixed_currency" });
  } else if (revenueGrowth === null) {
    suppressed.push({
      rule: "revenue_drop",
      reason: metrics.revenueGrowthPercent.reason ?? "revenue_unavailable",
    });
  } else if (revenueGrowth <= -SALES_THRESHOLDS.ANOMALY_REVENUE_DROP_PERCENT) {
    const severity =
      revenueGrowth <= -SALES_THRESHOLDS.ANOMALY_REVENUE_DROP_SEVERE_PERCENT ? "high" : "medium";

    anomalies.push(
      baseAnomaly(
        context,
        "revenue_drop",
        severity,
        "high",
        "recognized_revenue",
        "هبوط في الإيراد المعتمد",
        "الإيراد المعتمد (مجموع إجماليات الطلبات غير الملغاة والمسودّات) انخفض مقارنة بالفترة السابقة بنفس الطول.",
        {
          observed: metrics.recognizedRevenue.value ?? 0,
          baseline: metrics.previousRecognizedRevenue.value ?? 0,
          threshold: SALES_THRESHOLDS.ANOMALY_REVENUE_DROP_PERCENT,
          unit: "percent",
          change: revenueGrowth,
        },
        [
          { label: "الإيراد الحالي", value: metrics.recognizedRevenue.value },
          { label: "الإيراد السابق", value: metrics.previousRecognizedRevenue.value },
          { label: "التغيّر", value: revenueGrowth, unit: "%" },
          { label: "حد التنبيه", value: SALES_THRESHOLDS.ANOMALY_REVENUE_DROP_PERCENT, unit: "%" },
        ],
        "راجع حجم الطلبات والإلغاءات والعروض النشطة، وابدأ بالمنتج/الفئة التي تغيّر سلوكها.",
        `القاعدة: التغيّر ≤ −${SALES_THRESHOLDS.ANOMALY_REVENUE_DROP_PERCENT}%.`,
      ),
    );
  }

  // ── Orders drop ───────────────────────────────────────────────────────────
  const ordersGrowth = metrics.ordersGrowthPercent.value;
  if (ordersGrowth === null) {
    suppressed.push({
      rule: "orders_drop",
      reason: metrics.ordersGrowthPercent.reason ?? "orders_not_synced",
    });
  } else if (ordersGrowth <= -SALES_THRESHOLDS.ANOMALY_ORDERS_DROP_PERCENT) {
    const severity =
      ordersGrowth <= -SALES_THRESHOLDS.ANOMALY_ORDERS_DROP_SEVERE_PERCENT ? "high" : "medium";

    anomalies.push(
      baseAnomaly(
        context,
        "orders_drop",
        severity,
        "high",
        "orders",
        "هبوط في عدد الطلبات",
        "عدد الطلبات غير المسودّة انخفض مقارنة بالفترة السابقة بنفس الطول.",
        {
          observed: metrics.orders.value ?? 0,
          baseline: metrics.previousOrders.value ?? 0,
          threshold: SALES_THRESHOLDS.ANOMALY_ORDERS_DROP_PERCENT,
          unit: "percent",
          change: ordersGrowth,
        },
        [
          { label: "الطلبات الحالية", value: metrics.orders.value },
          { label: "الطلبات السابقة", value: metrics.previousOrders.value },
          { label: "التغيّر", value: ordersGrowth, unit: "%" },
          { label: "حد التنبيه", value: SALES_THRESHOLDS.ANOMALY_ORDERS_DROP_PERCENT, unit: "%" },
        ],
        "راجع مصادر الزيارات والحملات النشطة وتوفّر المنتجات الأكثر طلبًا.",
        `القاعدة: التغيّر ≤ −${SALES_THRESHOLDS.ANOMALY_ORDERS_DROP_PERCENT}%.`,
      ),
    );
  }

  // ── AOV change ────────────────────────────────────────────────────────────
  const aovGrowth = metrics.averageOrderValueGrowthPercent.value;
  if (mixedCurrency) {
    suppressed.push({ rule: "aov_change", reason: "mixed_currency" });
  } else if (aovGrowth === null) {
    suppressed.push({
      rule: "aov_change",
      reason: metrics.averageOrderValueGrowthPercent.reason ?? "no_order_totals",
    });
  } else if (Math.abs(aovGrowth) >= SALES_THRESHOLDS.ANOMALY_AOV_CHANGE_PERCENT) {
    const severity =
      Math.abs(aovGrowth) >= SALES_THRESHOLDS.ANOMALY_AOV_CHANGE_SEVERE_PERCENT ? "high" : "medium";
    const direction = aovGrowth < 0 ? "انخفاض" : "ارتفاع";

    anomalies.push(
      baseAnomaly(
        context,
        "aov_change",
        severity,
        "high",
        "average_order_value",
        `${direction} غير معتاد في متوسط قيمة الطلب`,
        "متوسط قيمة الطلب تحرّك بشكل كبير مقارنة بالفترة السابقة. الاتجاه قد يعني تغيّر سلة الشراء أو السعر أو الخصومات.",
        {
          observed: metrics.averageOrderValue.value ?? 0,
          baseline: metrics.previousAverageOrderValue.value ?? 0,
          threshold: SALES_THRESHOLDS.ANOMALY_AOV_CHANGE_PERCENT,
          unit: "percent",
          change: aovGrowth,
        },
        [
          { label: "المتوسط الحالي", value: metrics.averageOrderValue.value },
          { label: "المتوسط السابق", value: metrics.previousAverageOrderValue.value },
          { label: "التغيّر", value: aovGrowth, unit: "%" },
          { label: "حد التنبيه", value: SALES_THRESHOLDS.ANOMALY_AOV_CHANGE_PERCENT, unit: "%" },
        ],
        "راجع الأسعار وحِزم المنتجات وأي عرض نشط خلال الفترة.",
        `القاعدة: |التغيّر| ≥ ${SALES_THRESHOLDS.ANOMALY_AOV_CHANGE_PERCENT}%.`,
      ),
    );
  }

  // ── Cancellation spike ────────────────────────────────────────────────────
  if (
    orders !== null &&
    orders >= SALES_THRESHOLDS.MIN_CURRENT_ORDERS_FOR_RATES &&
    currentRate !== null &&
    previousRate !== null
  ) {
    const delta = round(currentRate - previousRate);
    if (
      delta >= SALES_THRESHOLDS.ANOMALY_CANCELLATION_SPIKE_POINTS &&
      currentRate >= SALES_THRESHOLDS.ANOMALY_CANCELLATION_MIN_RATE_PERCENT
    ) {
      const severity =
        delta >= SALES_THRESHOLDS.ANOMALY_CANCELLATION_SPIKE_SEVERE_POINTS ? "high" : "medium";

      anomalies.push(
        baseAnomaly(
          context,
          "cancellation_spike",
          severity,
          "high",
          "cancellation_rate",
          "ارتفاع غير معتاد في نسبة الإلغاء",
          "نسبة الطلبات الملغاة ارتفعت بوضوح عن الفترة السابقة، والإلغاء لا يُحتسب إيرادًا.",
          {
            observed: currentRate,
            baseline: previousRate,
            threshold: SALES_THRESHOLDS.ANOMALY_CANCELLATION_SPIKE_POINTS,
            unit: "points",
            change: delta,
          },
          [
            { label: "النسبة الحالية", value: currentRate, unit: "%" },
            { label: "النسبة السابقة", value: previousRate, unit: "%" },
            { label: "الفرق", value: delta, unit: "نقطة" },
            { label: "عدد الطلبات", value: orders },
          ],
          "راجع أسباب الإلغاء: مدد الشحن، وسائل الدفع، ومخزون المنتجات المطلوبة.",
          `القاعدة: الفرق ≥ ${SALES_THRESHOLDS.ANOMALY_CANCELLATION_SPIKE_POINTS} نقطة والنسبة الحالية ≥ ${SALES_THRESHOLDS.ANOMALY_CANCELLATION_MIN_RATE_PERCENT}%.`,
        ),
      );
    }
  }

  // ── Completion drop ───────────────────────────────────────────────────────
  if (
    orders !== null &&
    orders >= SALES_THRESHOLDS.MIN_CURRENT_ORDERS_FOR_RATES &&
    completedShare !== null &&
    previousCompletedShare !== null
  ) {
    const delta = round(completedShare - previousCompletedShare);
    if (delta <= -SALES_THRESHOLDS.ANOMALY_COMPLETION_DROP_POINTS) {
      const severity =
        delta <= -SALES_THRESHOLDS.ANOMALY_COMPLETION_DROP_SEVERE_POINTS ? "high" : "medium";

      anomalies.push(
        baseAnomaly(
          context,
          "completion_drop",
          severity,
          "high",
          "completed_orders",
          "هبوط في نسبة الطلبات المكتملة",
          "حصة الطلبات المكتملة من إجمالي الطلبات انخفضت؛ أي أن مزيدًا من الطلبات يقف خارج الاكتمال.",
          {
            observed: completedShare,
            baseline: previousCompletedShare,
            threshold: SALES_THRESHOLDS.ANOMALY_COMPLETION_DROP_POINTS,
            unit: "points",
            change: delta,
          },
          [
            { label: "الحصة الحالية", value: completedShare, unit: "%" },
            { label: "الحصة السابقة", value: previousCompletedShare, unit: "%" },
            { label: "طلبات مكتملة", value: metrics.completedOrders.value },
            { label: "إجمالي الطلبات", value: orders },
          ],
          "راجع حالات الطلبات ومدد التنفيذ؛ تأكد أن الطلبات تُنقل إلى completed.",
          `القاعدة: الفرق ≤ −${SALES_THRESHOLDS.ANOMALY_COMPLETION_DROP_POINTS} نقطة.`,
        ),
      );
    }
  }

  return { baseline, anomalies, suppressed };
}

export const ANOMALY_TYPE_LABELS_AR: Record<AnomalyType, string> = {
  revenue_drop: "هبوط الإيراد",
  orders_drop: "هبوط الطلبات",
  aov_change: "تغيّر متوسط الطلب",
  cancellation_spike: "ارتفاع الإلغاء",
  completion_drop: "هبوط الاكتمال",
};
