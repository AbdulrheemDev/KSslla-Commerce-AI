import { describe, expect, it } from "vitest";

import { evaluateLifecycle } from "@/modules/product-intelligence/domain/lifecycle";
import { PRODUCT_THRESHOLDS } from "@/modules/product-intelligence/domain/thresholds";
import { NOW, catalogProduct } from "@/test/product-intelligence-fixtures";

const DAY_MS = 86_400_000;

function daysAgo(days: number): string {
  return new Date(NOW.getTime() - days * DAY_MS).toISOString();
}

describe("evaluateLifecycle", () => {
  it("reads last update from the provider timestamp", () => {
    const result = evaluateLifecycle(catalogProduct({ sourceUpdatedAt: daysAgo(3) }), NOW);

    expect(result.lastUpdated.availability).toBe("available");
    expect(result.lastUpdated.value).toBe(daysAgo(3));
    expect(result.lastUpdated.basis).toContain("source_updated_at");
    expect(result.daysSinceUpdate).toBe(3);
  });

  it("flags content stale exactly at the threshold, and not one day before", () => {
    expect(
      evaluateLifecycle(
        catalogProduct({ sourceUpdatedAt: daysAgo(PRODUCT_THRESHOLDS.STALE_CONTENT_DAYS) }),
        NOW,
      ).stale,
    ).toBe(true);

    expect(
      evaluateLifecycle(
        catalogProduct({ sourceUpdatedAt: daysAgo(PRODUCT_THRESHOLDS.STALE_CONTENT_DAYS - 1) }),
        NOW,
      ).stale,
    ).toBe(false);
  });

  it("marks a recent update within the recent window", () => {
    expect(
      evaluateLifecycle(
        catalogProduct({ sourceUpdatedAt: daysAgo(PRODUCT_THRESHOLDS.RECENT_UPDATE_DAYS) }),
        NOW,
      ).recentlyUpdated,
    ).toBe(true);

    expect(
      evaluateLifecycle(
        catalogProduct({ sourceUpdatedAt: daysAgo(PRODUCT_THRESHOLDS.RECENT_UPDATE_DAYS + 1) }),
        NOW,
      ).recentlyUpdated,
    ).toBe(false);
  });

  it("returns unavailable staleness when the provider timestamp is missing", () => {
    const result = evaluateLifecycle(catalogProduct({ sourceUpdatedAt: null }), NOW);

    expect(result.stale).toBeNull();
    expect(result.daysSinceUpdate).toBeNull();
    expect(result.lastUpdated.availability).toBe("unavailable");
    expect(result.lastUpdated.reason).toBe("provider_updated_at_missing");
  });

  it("never derives a product age from the update timestamp", () => {
    const result = evaluateLifecycle(catalogProduct({ sourceUpdatedAt: daysAgo(400) }), NOW);

    expect(result.ageDays.availability).toBe("unavailable");
    expect(result.ageDays.reason).toBe("created_at_not_documented");
  });

  it("treats an unparseable timestamp as missing rather than as an age", () => {
    const result = evaluateLifecycle(catalogProduct({ sourceUpdatedAt: "not-a-date" }), NOW);

    expect(result.lastUpdated.availability).toBe("unavailable");
    expect(result.stale).toBeNull();
  });

  it("reads a hidden product from the documented status value only", () => {
    expect(evaluateLifecycle(catalogProduct({ status: "hidden" }), NOW).hidden).toBe(true);
    expect(evaluateLifecycle(catalogProduct({ status: "out" }), NOW).hidden).toBe(false);
    expect(evaluateLifecycle(catalogProduct({ status: "sale" }), NOW).hidden).toBe(false);
  });
});
