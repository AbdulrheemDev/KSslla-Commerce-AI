import { unavailable, type Metric } from "@/modules/intelligence/domain/types";

/**
 * Reorder quantity — a model that cannot run yet, and says so.
 *
 * Ordering stock requires three inputs, none of which exists in this data:
 *
 * 1. **demand rate** — blocked by the same reason as days of stock (`demand.ts`);
 * 2. **supplier lead time** — no documented field, no store setting for it;
 * 3. **safety stock** — needs a service-level target that the merchant has not
 *    stated anywhere.
 *
 * A "reorder 50 units" number built from current stock alone would be an
 * invention dressed as arithmetic, so the live pipeline reports
 * `unavailable("product_demand_not_linked")` and lists **which inputs are
 * missing**. The model itself is defined and unit-tested so the contract is
 * reviewable, and so a future phase can supply the three inputs without
 * redesigning anything.
 *
 * The model is deliberately the simplest textbook form:
 *
 * ```
 * reorderQuantity = ceil(demandPerDay × (leadTimeDays + safetyStockDays) − availableStock)
 * ```
 *
 * floored at 0 (never suggest a negative order) and rounded up to whole units
 * (suppliers ship units, not fractions).
 */

export interface ReorderModelInput {
  readonly demand: Metric<number>;
  readonly leadTimeDays: number | null;
  readonly safetyStockDays: number | null;
  readonly availableStock: number | null;
  readonly unlimitedQuantity: boolean;
}

export interface ReorderModelResult {
  readonly quantity: Metric<number>;
  /** Machine-readable ids of every input that was missing or invalid. */
  readonly missing: readonly string[];
}

export const REORDER_MISSING_INPUTS = [
  "product_demand_not_linked",
  "lead_time_not_configured",
  "safety_stock_not_configured",
] as const;

/**
 * The model, applied to whatever inputs a caller can provide.
 *
 * Every missing input is collected before deciding, so the caller learns
 * everything that is missing in one pass instead of one reason at a time.
 */
export function computeReorder(input: ReorderModelInput): ReorderModelResult {
  const missing: string[] = [];

  const demand = input.demand.value;
  const demandUsable =
    input.demand.availability === "available" &&
    demand !== null &&
    Number.isFinite(demand) &&
    demand >= 0;

  if (!demandUsable) {
    missing.push(
      input.demand.availability === "unavailable"
        ? (input.demand.reason ?? "product_demand_not_linked")
        : "invalid_demand",
    );
  }

  if (
    input.leadTimeDays === null ||
    !Number.isFinite(input.leadTimeDays) ||
    input.leadTimeDays < 0
  ) {
    missing.push("lead_time_not_configured");
  }

  if (
    input.safetyStockDays === null ||
    !Number.isFinite(input.safetyStockDays) ||
    input.safetyStockDays < 0
  ) {
    missing.push("safety_stock_not_configured");
  }

  if (missing.length > 0) {
    return {
      quantity: unavailable(missing[0]!, "demand × (lead time + safety stock) − stock"),
      missing,
    };
  }

  if (input.unlimitedQuantity) {
    return {
      quantity: unavailable("unlimited_stock", "unlimited stock cannot be reordered"),
      missing,
    };
  }

  if (input.availableStock === null) {
    return {
      quantity: unavailable("inventory_record_missing", "demand × cover − stock"),
      missing: ["inventory_record_missing"],
    };
  }

  const coverDays = (input.leadTimeDays as number) + (input.safetyStockDays as number);
  const target = (demand as number) * coverDays;
  const quantity = Math.max(0, Math.ceil(target - input.availableStock));

  return {
    quantity: {
      value: quantity,
      availability: "available",
      basis: "ceil(daily demand × (lead time + safety stock) − available stock)",
      reason: null,
    },
    missing: [],
  };
}

/** What the live pipeline reports: the model exists, its inputs do not. */
export function resolveReorder(): ReorderModelResult {
  return computeReorder({
    demand: unavailable("product_demand_not_linked"),
    leadTimeDays: null,
    safetyStockDays: null,
    availableStock: null,
    unlimitedQuantity: false,
  });
}
