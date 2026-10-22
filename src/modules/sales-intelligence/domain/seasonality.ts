import type { AnalysisPeriod, Metric } from "@/modules/intelligence/domain/types";

import { SALES_THRESHOLDS } from "./thresholds";
import type { TrendBucket } from "./trends";

/**
 * Weekday seasonality — deterministic, rule-based, and allowed to say "no".
 *
 * There is no model here and no forecast. The engine compares the **same
 * weekday against itself** across the requested window: Sunday revenue per
 * Sunday, Monday per Monday, and so on. A pattern is only claimed when
 *
 * - the window covers at least eight weeks and the stored history starts at or
 *   before the window (otherwise the "pattern" is an artefact of missing days);
 * - every weekday occurs at least eight times;
 * - there are enough orders that one large order cannot define a peak day;
 * - the strongest weekday beats the weakest by the configured contrast ratio.
 *
 * When any condition fails the result says so and no weekday ranking is shown.
 */

export type SeasonalityVerdict =
  | "pattern_detected"
  | "no_clear_pattern"
  | "insufficient_history"
  | "insufficient_orders"
  | "no_recognized_revenue"
  | "orders_not_synced"
  | "orders_sync_incomplete"
  | "mixed_currency";

export interface WeekdaySeasonality {
  /** 0 = Sunday … 6 = Saturday (UTC). */
  weekday: number;
  occurrences: number;
  orders: number;
  revenue: number | null;
  /** Revenue per occurrence ÷ overall mean revenue × 100; 100 = average. */
  index: number | null;
}

export interface SeasonalityAnalysis {
  available: boolean;
  verdict: SeasonalityVerdict;
  reason: SeasonalityVerdict;
  weekdays: WeekdaySeasonality[];
  strongest: WeekdaySeasonality | null;
  weakest: WeekdaySeasonality | null;
  contrastRatio: number | null;
  observed: { days: number; orders: number; occurrencesPerWeekday: number };
  requirements: {
    minDays: number;
    minOccurrencesPerWeekday: number;
    minOrders: number;
    minContrastRatio: number;
  };
}

export interface SeasonalityInput {
  period: AnalysisPeriod;
  daily: readonly TrendBucket[];
  ordersSynced: boolean;
  syncIncomplete: boolean;
  firstOrderAt: Date | null;
  currency: Metric<string>;
}

function round(value: number): number {
  return Math.round(value * 10) / 10;
}

function emptyWeekdays(): WeekdaySeasonality[] {
  return Array.from({ length: 7 }, (_, weekday) => ({
    weekday,
    occurrences: 0,
    orders: 0,
    revenue: null,
    index: null,
  }));
}

function unavailableResult(
  verdict: SeasonalityVerdict,
  daily: readonly TrendBucket[],
  orders: number,
): SeasonalityAnalysis {
  return {
    available: false,
    verdict,
    reason: verdict,
    weekdays: emptyWeekdays(),
    strongest: null,
    weakest: null,
    contrastRatio: null,
    observed: {
      days: daily.length,
      orders,
      occurrencesPerWeekday: Math.floor(daily.length / 7),
    },
    requirements: requirements(),
  };
}

function requirements(): SeasonalityAnalysis["requirements"] {
  return {
    minDays: SALES_THRESHOLDS.SEASONALITY_MIN_DAYS,
    minOccurrencesPerWeekday: SALES_THRESHOLDS.SEASONALITY_MIN_OCCURRENCES_PER_WEEKDAY,
    minOrders: SALES_THRESHOLDS.SEASONALITY_MIN_ORDERS,
    minContrastRatio: SALES_THRESHOLDS.SEASONALITY_MIN_CONTRAST_RATIO,
  };
}

export function analyseSeasonality(input: SeasonalityInput): SeasonalityAnalysis {
  const orderedBuckets = input.daily;
  const totalOrders = orderedBuckets.reduce((sum, bucket) => sum + (bucket.orders.value ?? 0), 0);

  if (!input.ordersSynced) return unavailableResult("orders_not_synced", orderedBuckets, 0);
  if (input.syncIncomplete) {
    return unavailableResult("orders_sync_incomplete", orderedBuckets, totalOrders);
  }
  if (input.currency.reason === "mixed_currency") {
    return unavailableResult("mixed_currency", orderedBuckets, totalOrders);
  }

  const historyStartsAfterWindow =
    input.firstOrderAt !== null && input.firstOrderAt.getTime() > input.period.from.getTime();

  if (
    input.firstOrderAt === null ||
    historyStartsAfterWindow ||
    input.period.days < SALES_THRESHOLDS.SEASONALITY_MIN_DAYS
  ) {
    return unavailableResult("insufficient_history", orderedBuckets, totalOrders);
  }

  if (totalOrders < SALES_THRESHOLDS.SEASONALITY_MIN_ORDERS) {
    return unavailableResult("insufficient_orders", orderedBuckets, totalOrders);
  }

  const usable = orderedBuckets.filter(
    (bucket) =>
      bucket.history === "covered" && bucket.orders.value !== null && bucket.revenue.value !== null,
  );

  const weekdays = emptyWeekdays();
  let revenueTotal = 0;

  for (const bucket of usable) {
    const weekday = new Date(bucket.from).getUTCDay();
    const entry = weekdays[weekday]!;

    entry.occurrences += 1;
    entry.orders += bucket.orders.value ?? 0;
    entry.revenue = (entry.revenue ?? 0) + (bucket.revenue.value ?? 0);
    revenueTotal += bucket.revenue.value ?? 0;
  }

  if (usable.length === 0 || revenueTotal <= 0) {
    return unavailableResult("no_recognized_revenue", orderedBuckets, totalOrders);
  }

  const meanPerDay = revenueTotal / usable.length;

  for (const entry of weekdays) {
    entry.revenue = entry.revenue === null ? null : round(entry.revenue);
    entry.index =
      entry.revenue === null || entry.occurrences === 0
        ? null
        : round((entry.revenue / entry.occurrences / meanPerDay) * 100);
  }

  const complete = weekdays.every(
    (entry) =>
      entry.occurrences >= SALES_THRESHOLDS.SEASONALITY_MIN_OCCURRENCES_PER_WEEKDAY &&
      entry.index !== null,
  );

  if (!complete) {
    return {
      ...unavailableResult("insufficient_history", orderedBuckets, totalOrders),
      weekdays,
      observed: {
        days: usable.length,
        orders: totalOrders,
        occurrencesPerWeekday: Math.min(...weekdays.map((entry) => entry.occurrences)),
      },
    };
  }

  const sorted = [...weekdays].sort((a, b) => (b.index ?? 0) - (a.index ?? 0));
  const strongest = sorted[0]!;
  const weakest = sorted[sorted.length - 1]!;
  const weakestIndex = weakest.index ?? 0;
  const contrastRatio =
    weakestIndex === 0 ? Number.POSITIVE_INFINITY : round((strongest.index ?? 0) / weakestIndex);

  const detected =
    weakestIndex === 0 || contrastRatio >= SALES_THRESHOLDS.SEASONALITY_MIN_CONTRAST_RATIO;

  return {
    available: true,
    verdict: detected ? "pattern_detected" : "no_clear_pattern",
    reason: detected ? "pattern_detected" : "no_clear_pattern",
    weekdays,
    strongest: detected ? strongest : null,
    weakest: detected ? weakest : null,
    contrastRatio: Number.isFinite(contrastRatio) ? contrastRatio : null,
    observed: {
      days: usable.length,
      orders: totalOrders,
      occurrencesPerWeekday: Math.min(...weekdays.map((entry) => entry.occurrences)),
    },
    requirements: requirements(),
  };
}

/** Arabic weekday labels, indexed by UTC day-of-week (0 = Sunday). */
export const WEEKDAY_LABELS_AR = [
  "الأحد",
  "الإثنين",
  "الثلاثاء",
  "الأربعاء",
  "الخميس",
  "الجمعة",
  "السبت",
] as const;
