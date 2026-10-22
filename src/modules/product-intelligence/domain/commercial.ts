import { available, unavailable, type Metric } from "@/modules/intelligence/domain/types";

import { isBlank } from "./text";
import type { CatalogProductInput, CommercialEvaluation } from "./types";

/**
 * Commercial fields of a catalogue entry: price, currency, and the current
 * stock indicator.
 *
 * The price is read exactly as stored (`numeric(14,2)`), never recomputed from
 * `regular_price`/`sale_price` — a discount is not this phase's business and
 * Salla documents no rule that would let us pick one of the three.
 *
 * Stock prefers the inventory mirror (`GET /products/quantities`, aggregated per
 * product) and falls back to `products.quantity`. When neither exists the metric
 * is `unavailable` — an unknown stock level is not "out of stock".
 */

export function evaluateCommercial(product: CatalogProductInput): CommercialEvaluation {
  const price =
    product.priceAmount === null || isBlank(product.priceAmount)
      ? null
      : Number(product.priceAmount);
  const validPrice = price !== null && Number.isFinite(price);

  const priceMetric: Metric<number> = validPrice
    ? available(price, "products.price_amount")
    : unavailable("no_price");

  const currency: Metric<string> = isBlank(product.currency)
    ? unavailable("missing_currency")
    : available((product.currency as string).trim(), "products.currency");

  const inventory = product.inventory;
  const stockValue = inventory !== null ? inventory.quantity : product.quantity;
  const stockSource =
    inventory !== null ? "inventory" : product.quantity !== null ? "products" : null;

  const stock: Metric<number> =
    stockValue === null
      ? unavailable("no_stock_data")
      : available(
          stockValue,
          stockSource === "inventory" ? "sum(inventory_levels.quantity)" : "products.quantity",
        );

  const unlimitedQuantity = inventory === null ? null : inventory.unlimitedQuantity;

  const outOfStock =
    stockValue === null ? null : unlimitedQuantity === true ? false : stockValue <= 0;

  return {
    price: priceMetric,
    currency,
    stock,
    stockSource,
    unlimitedQuantity,
    outOfStock,
  };
}
