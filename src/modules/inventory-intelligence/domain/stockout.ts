import type { Metric } from "@/modules/intelligence/domain/types";

import { INVENTORY_THRESHOLDS } from "./thresholds";
import type { StockoutRisk } from "./types";

/**
 * Stockout risk — a function of days of stock, and nothing else.
 *
 * The bands are defined here and unit-tested, but the live pipeline can never
 * reach them: `daysOfStock` is `unavailable` while there is no documented demand
 * source, and a risk level derived from *quantity alone* would be the exact false
 * precision this phase exists to avoid. A product with 3 units is not "critical"
 * if it sells once a month, and a product with 300 is not "safe" if it sells 200 a
 * day.
 *
 * The bands:
 *
 * | days of stock | risk |
 * |---|---|
 * | `<= 3` | `critical` |
 * | `<= 7` | `warning` |
 * | `<= 14` | `watch` |
 * | `> 14` | `normal` |
 *
 * Boundaries are inclusive on the lower band so a product at exactly 3 days is
 * critical, not merely a warning — the safer reading of an edge.
 */

export interface StockoutAssessment {
  readonly risk: StockoutRisk;
  readonly reason: string | null;
}

export function riskFromDaysOfStock(daysOfStock: Metric<number>): StockoutAssessment {
  if (daysOfStock.availability === "unavailable") {
    return { risk: "unknown", reason: daysOfStock.reason ?? "days_of_stock_unavailable" };
  }

  const days = daysOfStock.value;

  if (days === null || !Number.isFinite(days)) {
    return { risk: "unknown", reason: "invalid_days_of_stock" };
  }

  if (days <= INVENTORY_THRESHOLDS.STOCKOUT_CRITICAL_DAYS)
    return { risk: "critical", reason: null };
  if (days <= INVENTORY_THRESHOLDS.STOCKOUT_WARNING_DAYS) return { risk: "warning", reason: null };
  if (days <= INVENTORY_THRESHOLDS.STOCKOUT_WATCH_DAYS) return { risk: "watch", reason: null };

  return { risk: "normal", reason: null };
}
