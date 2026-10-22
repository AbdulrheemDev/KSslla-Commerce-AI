import { unavailable, type Metric } from "@/modules/intelligence/domain/types";

import { DEMAND_UNAVAILABLE_REASON } from "./demand";
import { isHighQuantity } from "./stock";

/**
 * Excess and dead stock — the two claims this data cannot support.
 *
 * A quantity alone cannot prove either. 100 units is normal for a fast mover and
 * alarming for a product that sells once a quarter; the difference is the demand
 * rate, which does not exist here (`demand.ts`).
 *
 * - **Dead stock** would need `quantity > 0`, `demand = 0`, and an observation
 *   window at least as long as a documented inactivity period. None of the three
 *   is available. Product `updated_at` is explicitly *not* a substitute: editing a
 *   product says nothing about whether it sold.
 * - **Excess inventory** would need demand × a target cover period to compare
 *   against stock. Also unavailable.
 *
 * What *is* supported is a neutral quantity observation (`highStockQuantity`),
 * reported as "كمية مرتفعة" and never as راكد. It is a prompt to look, not a
 * verdict.
 */

export interface ExcessEvaluation {
  /** Neutral label: stock at or above `HIGH_STOCK_UNITS`, not unlimited. */
  readonly highStockQuantity: boolean;
  /** `unavailable` — needs demand. */
  readonly excessInventory: Metric<number>;
  /** `unavailable` — needs demand and an observation window. */
  readonly deadStock: Metric<boolean>;
}

export const EXCESS_UNAVAILABLE_REASON = DEMAND_UNAVAILABLE_REASON;

export function evaluateExcess(input: {
  readonly quantity: number;
  readonly unlimitedQuantity: boolean;
}): ExcessEvaluation {
  return {
    highStockQuantity: isHighQuantity(input),
    excessInventory: unavailable(
      EXCESS_UNAVAILABLE_REASON,
      "stock ÷ demand compared against a target cover period — no demand source",
    ),
    deadStock: unavailable(
      EXCESS_UNAVAILABLE_REASON,
      "quantity > 0 AND demand = 0 over a documented window — no demand source",
    ),
  };
}
