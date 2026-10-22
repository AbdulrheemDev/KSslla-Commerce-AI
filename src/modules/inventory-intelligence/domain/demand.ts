import { unavailable, type Metric } from "@/modules/intelligence/domain/types";

import type { DemandResolution } from "./types";

/**
 * Product-level demand — the input this phase does not have.
 *
 * Two independent facts block it, and both are documented rather than assumed:
 *
 * 1. **Order lines carry no product reference.** `List Orders` returns
 *    `name`, `quantity`, `thumbnail` only, so `order_items` is written with
 *    `link_status = 'no_product_reference'` (Phase 05 §13.1, ADR-043). Products
 *    cannot be attributed to sold units without matching by name — forbidden.
 * 2. **`sold_quantity` has no documented period.** `GET /products/quantities`
 *    returns a cumulative counter with no window and no `as of` field
 *    (docs/salla-reference.md §12.5, §18). Dividing it by "days since we first
 *    synced" would measure our sync history, not the store's selling rate.
 *
 * So the honest resolution is `unavailable("product_demand_not_linked")`.
 *
 * The contract below is what a future, documented source must provide. It is
 * defined now so the shape of the requirement is reviewable, and wired to
 * nothing: no caller can pass a demand value today without editing this file.
 */

/** A demand rate that a future documented source would have to produce. */
export interface DemandInput {
  /** Units sold per day, over `windowDays`. */
  readonly unitsPerDay: number;
  /** Length of the observation window in days. Must be > 0. */
  readonly windowDays: number;
  /** Machine-readable id of the documented source that produced it. */
  readonly source: string;
}

/** Why demand is missing. One constant, referenced by every dependent metric. */
export const DEMAND_UNAVAILABLE_REASON = "product_demand_not_linked";

/** The only resolution the current data supports. */
export function resolveDemand(): DemandResolution {
  return {
    dailyDemand: unavailable(
      DEMAND_UNAVAILABLE_REASON,
      "product-level period sales ÷ window — no documented source exists",
    ),
  };
}

/**
 * `daysOfStock = quantity ÷ dailyDemand`, defined for any demand metric.
 *
 * The function is total: every input has a defined answer, and the answer is a
 * number only when the arithmetic is meaningful.
 *
 * | input | result |
 * |---|---|
 * | demand unavailable | `unavailable(product_demand_not_linked)` |
 * | demand `NaN`/`Infinity`/negative | `unavailable("invalid_demand")` |
 * | demand `0` | `unavailable("no_demand_in_window")` — infinite, not a number |
 * | unlimited stock | `unavailable("unlimited_stock")` — never runs out |
 * | otherwise | `available(quantity ÷ demand, ...)` rounded to 1 decimal |
 */
export function daysOfStockFrom(input: {
  readonly demand: Metric<number>;
  readonly quantity: number;
  readonly unlimitedQuantity: boolean;
}): Metric<number> {
  if (input.demand.availability === "unavailable") {
    return unavailable(input.demand.reason ?? DEMAND_UNAVAILABLE_REASON, "stock ÷ daily demand");
  }

  const demand = input.demand.value;

  if (demand === null || !Number.isFinite(demand) || demand < 0) {
    return unavailable("invalid_demand", "stock ÷ daily demand");
  }

  if (demand === 0) {
    return unavailable("no_demand_in_window", "stock ÷ daily demand");
  }

  if (input.unlimitedQuantity) {
    return unavailable("unlimited_stock", "stock ÷ daily demand");
  }

  return {
    value: Math.round((input.quantity / demand) * 10) / 10,
    availability: "available",
    basis: "inventory quantity ÷ daily demand",
    reason: null,
  };
}
