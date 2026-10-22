import { available, unavailable, type Metric } from "@/modules/intelligence/domain/types";

import type { CatalogProductInput, ProductPerformance } from "./types";

/**
 * Product performance — and the one honest answer this data can give.
 *
 * Phase 05 established, from the provider documentation, that a `List Orders`
 * line carries only `name`, `quantity`, and `thumbnail`: no product id, no SKU,
 * no line price (docs/salla-reference.md §12.2 and §13.1). `order_items` keeps
 * `link_status = 'no_product_reference'` for every line, so attributing revenue
 * or units to a product would require matching by name or thumbnail — exactly
 * the inference the project forbids.
 *
 * Therefore:
 * - `periodSales` and `revenue` are `unavailable("product_sales_not_linked")`.
 *   No "top sellers", no per-product sales chart, no revenue share.
 * - `cumulativeSoldQuantity` is the provider counter from
 *   `GET /products/quantities`. Salla documents the field but **not its period**,
 *   so it is labelled cumulative and is never divided by days, never compared
 *   across windows, and never called "sales this month".
 */

export const PERFORMANCE_UNAVAILABLE_REASON = "product_sales_not_linked";

export function evaluatePerformance(product: CatalogProductInput): ProductPerformance {
  const inventory = product.inventory;

  const cumulativeSoldQuantity: Metric<number> =
    inventory === null
      ? unavailable("inventory_not_synced")
      : available(
          inventory.soldQuantity,
          "sum(inventory_levels.sold_quantity) — cumulative provider value, period not documented",
        );

  return {
    periodSales: unavailable(PERFORMANCE_UNAVAILABLE_REASON),
    revenue: unavailable(PERFORMANCE_UNAVAILABLE_REASON),
    cumulativeSoldQuantity,
  };
}
