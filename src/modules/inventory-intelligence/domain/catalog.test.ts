import { describe, expect, it } from "vitest";

import { analyseInventoryProduct } from "./products";
import { buildCoverage, buildHealthScore, buildInventoryReport } from "./catalog";
import type { InventoryProductInput, InventorySyncState } from "./types";

/**
 * Coverage and the health score.
 *
 * The tests pin the difference between "measured zero" and "not measured", which
 * is the failure this phase exists to prevent: a store that never synced
 * inventory must not look like a store whose shelves are empty.
 */

const SYNCED: InventorySyncState = {
  inventorySynced: true,
  inventorySyncFailed: false,
  lastInventorySyncAt: "2026-10-21T09:00:00.000Z",
  staleResources: [],
};

const NEVER_SYNCED: InventorySyncState = {
  inventorySynced: false,
  inventorySyncFailed: false,
  lastInventorySyncAt: null,
  staleResources: [],
};

function product(id: string, quantity: number | null): InventoryProductInput {
  return {
    id,
    name: `منتج ${id}`,
    sku: `SKU-${id}`,
    productStatus: "sale",
    categories: [],
    stock:
      quantity === null
        ? null
        : {
            quantity,
            soldQuantity: 0,
            unlimitedQuantity: false,
            entries: 1,
            variants: [],
            lastSyncedAt: "2026-10-21T09:00:00.000Z",
          },
  };
}

function coverageFor(products: InventoryProductInput[], sync: InventorySyncState = SYNCED) {
  const tracked = products.filter((item) => item.stock !== null).length;

  return buildCoverage({
    productsTotal: products.length,
    productsTracked: tracked,
    inventoryEntries: tracked,
    unlinkedEntries: 0,
    lastSyncedAt: tracked === 0 ? null : "2026-10-21T09:00:00.000Z",
    sync,
  });
}

describe("inventory coverage", () => {
  it("reports 100% and complete when every product has a row", () => {
    const coverage = coverageFor([product("a", 4), product("b", 0)]);

    expect(coverage.status).toBe("complete");
    expect(coverage.coveragePercent).toMatchObject({ value: 100, availability: "available" });
    expect(coverage.productsTracked).toBe(2);
  });

  it("reports 80% and partial when one product in five has no row", () => {
    const coverage = coverageFor([
      product("a", 4),
      product("b", 2),
      product("c", 9),
      product("d", 1),
      product("e", null),
    ]);

    expect(coverage.status).toBe("partial");
    // The share is exactly measured over the whole catalogue (4 of 5), so the
    // value is `available` — and it is 80, never rounded to 100. The partial-ness
    // travels on `status` and `notes`.
    expect(coverage.coveragePercent.value).toBe(80);
    expect(coverage.coveragePercent.availability).toBe("available");
    expect(coverage.notes).toContain("products_without_inventory_record");
    expect(coverage.productsTracked).toBe(4);
    expect(coverage.productsTotal).toBe(5);
  });

  it("reports unavailable — not 0% and not 100% — when no product has a row", () => {
    const coverage = coverageFor([product("a", null), product("b", null)]);

    expect(coverage.status).toBe("empty");
    expect(coverage.coveragePercent.value).toBeNull();
    expect(coverage.coveragePercent.reason).toBe("no_inventory_rows");
    expect(coverage.notes).toContain("no_inventory_rows");
  });

  it("reports unavailable coverage when the store has no products at all", () => {
    const coverage = coverageFor([]);

    expect(coverage.status).toBe("empty");
    expect(coverage.coveragePercent.value).toBeNull();
    expect(coverage.coveragePercent.reason).toBe("no_products_stored");
  });

  it("says inventory was never synced when no rows exist and no sync succeeded", () => {
    const coverage = coverageFor([product("a", null), product("b", null)], NEVER_SYNCED);

    expect(coverage.coveragePercent.reason).toBe("inventory_not_synced");
    expect(coverage.notes).toContain("inventory_not_synced");
  });

  it("degrades to partial when rows exist but no sync is recorded", () => {
    // Rows present + no successful sync run is a partial snapshot, never
    // `unavailable` — the numbers are real, they are just not certified.
    const coverage = coverageFor([product("a", 4)], NEVER_SYNCED);

    expect(coverage.status).toBe("partial");
    expect(coverage.coveragePercent.availability).toBe("partial");
    expect(coverage.coveragePercent.reason).toBe("inventory_not_synced");
  });

  it("flags unlinked entries and marks the snapshot partial", () => {
    const coverage = buildCoverage({
      productsTotal: 2,
      productsTracked: 2,
      inventoryEntries: 3,
      unlinkedEntries: 1,
      lastSyncedAt: "2026-10-21T09:00:00.000Z",
      sync: SYNCED,
    });

    expect(coverage.status).toBe("partial");
    expect(coverage.notes).toContain("inventory_entries_unlinked");
    expect(coverage.unlinkedEntries).toBe(1);
  });
});

describe("inventory health score", () => {
  it("is unavailable when no products are stored", () => {
    const score = buildHealthScore({
      productsTotal: 0,
      productsTracked: 0,
      inStock: 0,
      lowStock: 0,
      outOfStock: 0,
      unlimited: 0,
      negativeQuantity: 0,
      inventorySynced: true,
    });

    expect(score.value).toBeNull();
    expect(score.reason).toBe("no_products_stored");
  });

  it("is unavailable when inventory was never synced and nothing is tracked", () => {
    const score = buildHealthScore({
      productsTotal: 3,
      productsTracked: 0,
      inStock: 0,
      lowStock: 0,
      outOfStock: 0,
      unlimited: 0,
      negativeQuantity: 0,
      inventorySynced: false,
    });

    expect(score.reason).toBe("inventory_not_synced");
  });

  it("gives a perfect score only when everything is in stock and covered", () => {
    const score = buildHealthScore({
      productsTotal: 4,
      productsTracked: 4,
      inStock: 4,
      lowStock: 0,
      outOfStock: 0,
      unlimited: 0,
      negativeQuantity: 0,
      inventorySynced: true,
    });

    expect(score.value).toBe(100);
    expect(score.availability).toBe("available");
  });

  it("is partial when coverage is below 100%", () => {
    const score = buildHealthScore({
      productsTotal: 10,
      productsTracked: 8,
      inStock: 8,
      lowStock: 0,
      outOfStock: 0,
      unlimited: 0,
      negativeQuantity: 0,
      inventorySynced: true,
    });

    expect(score.availability).toBe("partial");
    expect(score.reason).toBe("inventory_coverage_partial");
    expect(score.value).toBe(95);
  });

  it("penalises low and out-of-stock shares", () => {
    const score = buildHealthScore({
      productsTotal: 4,
      productsTracked: 4,
      inStock: 2,
      lowStock: 1,
      outOfStock: 1,
      unlimited: 0,
      negativeQuantity: 0,
      inventorySynced: true,
    });

    // 25 + 35×0.5 + 20×0.75 + 20×0.75 = 72.5
    expect(score.value).toBe(72.5);
  });

  it("is partial when a negative quantity exists even with full coverage", () => {
    const score = buildHealthScore({
      productsTotal: 2,
      productsTracked: 2,
      inStock: 1,
      lowStock: 0,
      outOfStock: 1,
      unlimited: 0,
      negativeQuantity: 1,
      inventorySynced: true,
    });

    expect(score.availability).toBe("partial");
    expect(score.reason).toBe("negative_quantity_present");
  });
});

describe("inventory report — no invented numbers", () => {
  const products = [product("a", 0), product("b", 3), product("c", 80), product("d", null)];
  const analyses = products.map((item) => analyseInventoryProduct(item));

  const report = buildInventoryReport({
    products,
    analyses,
    unlinkedEntries: [],
    coverage: coverageFor(products),
    sync: SYNCED,
  });

  it("keeps the forecast metrics unavailable with a reason", () => {
    for (const metric of [
      report.overview.daysOfStock,
      report.overview.deadStock,
      report.overview.reorderQuantity,
    ]) {
      expect(metric.value).toBeNull();
      expect(metric.availability).toBe("unavailable");
      expect(metric.reason).not.toBeNull();
    }
  });

  it("counts statuses without collapsing unknown into zero", () => {
    expect(report.counts).toMatchObject({
      productsTotal: 4,
      productsTracked: 3,
      outOfStock: 1,
      lowStock: 1,
      inStock: 1,
      unknown: 1,
    });
  });

  it("exposes the empty-inventory reason, not zeros, when nothing is tracked", () => {
    const emptyReport = buildInventoryReport({
      products: [product("x", null)],
      analyses: [analyseInventoryProduct(product("x", null))],
      unlinkedEntries: [],
      coverage: coverageFor([product("x", null)], NEVER_SYNCED),
      sync: NEVER_SYNCED,
    });

    expect(emptyReport.overview.outOfStock.value).toBeNull();
    expect(emptyReport.overview.outOfStock.reason).toBe("inventory_not_synced");
    expect(emptyReport.overview.productsTracked.value).toBeNull();
    expect(emptyReport.overview.unknownStock.value).toBe(1);
  });
});
