import { available, unavailable, type Metric } from "@/modules/intelligence/domain/types";

import { INVENTORY_THRESHOLDS } from "./thresholds";
import type { InventoryStatus } from "./types";

/**
 * Stock status from mirrored quantities only.
 *
 * Order matters and is the whole rule:
 *
 * 1. **unlimited wins.** A product sold without a stock counter can be sold when
 *    `quantity` is 0, so counting it as out of stock would be a false alarm. The
 *    provider's own example has unlimited products sitting at quantity 0.
 * 2. **`quantity <= 0` is out of stock** — zero and negative alike. A negative
 *    quantity is a data-quality problem (it gets its own issue) but it is still
 *    not sellable stock.
 * 3. **`quantity <= LOW_STOCK_UNITS` is low stock.**
 * 4. everything else is in stock.
 *
 * `unknown` is not a branch here: it is the answer when no row exists, which is
 * decided by the caller that knows whether a row was found.
 */
export function classifyStock(input: {
  readonly quantity: number;
  readonly unlimitedQuantity: boolean;
}): Exclude<InventoryStatus, "unknown"> {
  if (input.unlimitedQuantity) return "unlimited";
  if (input.quantity <= 0) return "out_of_stock";
  if (input.quantity <= INVENTORY_THRESHOLDS.LOW_STOCK_UNITS) return "low_stock";
  return "in_stock";
}

/** True when a mirrored quantity is negative — impossible stock, bad data. */
export function isNegativeQuantity(quantity: number): boolean {
  return quantity < 0;
}

/**
 * Products above the high-quantity threshold.
 *
 * A **quantity observation**, not overstock and not dead stock: without a demand
 * rate there is no way to say whether this much stock is too much.
 */
export function isHighQuantity(input: {
  readonly quantity: number;
  readonly unlimitedQuantity: boolean;
}): boolean {
  return !input.unlimitedQuantity && input.quantity >= INVENTORY_THRESHOLDS.HIGH_STOCK_UNITS;
}

/** The stock metric for one product, with the population it was summed from. */
export function stockMetric(input: {
  readonly quantity: number;
  readonly entries: number;
}): Metric<number> {
  return available(
    input.quantity,
    input.entries > 1
      ? "sum(inventory_levels.quantity) across the product's variants"
      : "inventory_levels.quantity",
  );
}

/** Products whose stock is unknown (no inventory row) are never "0 units". */
export function unknownStockMetric(): Metric<number> {
  return unavailable("inventory_record_missing", "inventory_levels.quantity");
}
