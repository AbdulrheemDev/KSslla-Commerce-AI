import type { Metric } from "@/modules/intelligence/domain/types";
import { unavailable } from "@/modules/intelligence/domain/types";

/**
 * Discounts — unavailable, with the reason written down instead of guessed.
 *
 * What the project actually mirrors is the output of `GET /admin/v2/orders`.
 * Its response sample carries `total { amount, currency }`; there is **no**
 * discount, coupon, or sub-total amount in the order object
 * (docs/salla-reference.md §16). The richer `amounts.discounts[]` array belongs
 * to Order Details, whose full response the docs mark as deprecated, and which
 * Phase 05 deliberately does not call per order (N calls, and its line-item
 * payload was removed from the list endpoint).
 *
 * Therefore every discount metric is `unavailable` — never derived from
 * `total` vs an invented "original price", never a percentage.
 */

export const DISCOUNT_REASON = "discount_not_mirrored";

export interface DiscountAnalysis {
  available: boolean;
  amount: Metric<number>;
  discountedOrders: Metric<number>;
  discountRate: Metric<number>;
  trend: Metric<number>;
  currency: Metric<string>;
  reason: string;
  source: {
    documentedIn: string;
    usedEndpoint: string;
    note: string;
  };
}

export function computeDiscountAnalysis(currency: Metric<string>): DiscountAnalysis {
  return {
    available: false,
    amount: unavailable(DISCOUNT_REASON, "sum(order.discounts.amount)"),
    discountedOrders: unavailable(DISCOUNT_REASON, "count(orders with discount)"),
    discountRate: unavailable(DISCOUNT_REASON, "discounted_orders / orders × 100"),
    trend: unavailable(DISCOUNT_REASON, "discount_period_over_period"),
    currency,
    reason: DISCOUNT_REASON,
    source: {
      documentedIn: "Order Details — amounts.discounts[] (full response, marked deprecated)",
      usedEndpoint: "GET /admin/v2/orders — no discount field",
      note: "لا تُحفظ تفاصيل الخصم في النسخة المحلية؛ ولذلك لا تُحسب أي قيمة خصم ولا تُستنتج من فرق السعر.",
    },
  };
}
