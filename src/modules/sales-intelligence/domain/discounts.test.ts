import { describe, expect, it } from "vitest";

import { available } from "@/modules/intelligence/domain/types";

import { computeDiscountAnalysis, DISCOUNT_REASON } from "./discounts";

describe("discount analysis", () => {
  it("is explicitly unavailable instead of inferred", () => {
    const analysis = computeDiscountAnalysis(available("SAR", "test"));

    expect(analysis.available).toBe(false);
    expect(analysis.reason).toBe(DISCOUNT_REASON);

    for (const metric of [
      analysis.amount,
      analysis.discountedOrders,
      analysis.discountRate,
      analysis.trend,
    ]) {
      expect(metric.value).toBeNull();
      expect(metric.availability).toBe("unavailable");
      expect(metric.reason).toBe("discount_not_mirrored");
    }
  });

  it("states where discount data would have to come from", () => {
    const analysis = computeDiscountAnalysis(available("SAR", "test"));

    expect(analysis.source.usedEndpoint).toBe("GET /admin/v2/orders — no discount field");
    expect(analysis.source.documentedIn).toContain("amounts.discounts");
    expect(analysis.source.note.length).toBeGreaterThan(0);
  });

  it("keeps the window currency for context without inventing a discount currency", () => {
    const analysis = computeDiscountAnalysis(available("SAR", "test"));
    expect(analysis.currency.value).toBe("SAR");
  });

  it("remains unavailable even when the window currency is missing", () => {
    const analysis = computeDiscountAnalysis({
      value: null,
      availability: "unavailable",
      basis: null,
      reason: "no_order_totals",
    });

    expect(analysis.amount.reason).toBe("discount_not_mirrored");
    expect(analysis.currency.value).toBeNull();
  });
});
