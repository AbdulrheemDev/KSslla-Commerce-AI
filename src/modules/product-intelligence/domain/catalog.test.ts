import { describe, expect, it } from "vitest";

import {
  buildCatalogReport,
  buildConfidence,
  buildCoverage,
  buildOverview,
  type CatalogSyncState,
} from "@/modules/product-intelligence/domain/catalog";
import { buildCategoryHealth } from "@/modules/product-intelligence/domain/categories";
import { analyseProduct } from "@/modules/product-intelligence/domain/products";
import type { CatalogProductInput } from "@/modules/product-intelligence/domain/types";
import {
  NOW,
  bareProduct,
  catalogProduct,
  inventoryState,
} from "@/test/product-intelligence-fixtures";

function syncState(overrides: Partial<CatalogSyncState> = {}): CatalogSyncState {
  return {
    productsSynced: true,
    productsSyncFailed: false,
    categoriesSynced: true,
    categoriesSyncFailed: false,
    productsSkipped: 0,
    categoriesSkipped: 0,
    lastProductsSyncAt: "2026-10-21T09:00:00.000Z",
    lastCategoriesSyncAt: "2026-10-21T09:00:00.000Z",
    staleResources: [],
    ...overrides,
  };
}

function report(products: CatalogProductInput[], sync: CatalogSyncState) {
  const analyses = products.map((product) => analyseProduct(product, NOW));
  return buildCatalogReport(
    products,
    analyses,
    [{ id: "cat_1", name: "قمصان", status: "sale" }],
    sync,
  );
}

describe("buildCoverage", () => {
  it("is empty, with no notes about missing data, when nothing is stored", () => {
    const coverage = buildCoverage([], [], syncState({ productsSynced: false }));

    expect(coverage.status).toBe("empty");
    expect(coverage.notes).toContain("products_not_synced");
    expect(coverage.notes).toContain("no_products_stored");
  });

  it("is complete for a synced catalogue with fully captured metadata", () => {
    expect(buildCoverage([catalogProduct()], [], syncState()).status).toBe("complete");
  });

  it("is partial when the last run skipped products or metadata is missing", () => {
    const skipped = buildCoverage([catalogProduct()], [], syncState({ productsSkipped: 4 }));
    expect(skipped.status).toBe("partial");
    expect(skipped.notes).toContain("products_skipped_in_last_run");

    const noMetadata = buildCoverage([catalogProduct({ metadataStored: false })], [], syncState());
    expect(noMetadata.status).toBe("partial");
    expect(noMetadata.notes).toContain("metadata_not_captured");
  });

  it("records a failed sync as a coverage note", () => {
    const coverage = buildCoverage([catalogProduct()], [], syncState({ productsSyncFailed: true }));

    expect(coverage.notes).toContain("products_sync_incomplete");
    expect(coverage.status).toBe("partial");
  });
});

describe("buildConfidence", () => {
  it("is low when products were never synced", () => {
    const sync = syncState({ productsSynced: false });
    expect(buildConfidence(buildCoverage([], [], sync), sync).level).toBe("low");
  });

  it("is low after a failed products sync", () => {
    const sync = syncState({ productsSyncFailed: true });
    const products = [catalogProduct()];
    expect(buildConfidence(buildCoverage(products, [], sync), sync).level).toBe("low");
  });

  it("is medium when coverage is partial or a resource is stale", () => {
    const stale = syncState({ staleResources: ["products"] });
    expect(buildConfidence(buildCoverage([catalogProduct()], [], stale), stale).level).toBe(
      "medium",
    );

    const partial = syncState({ productsSkipped: 2 });
    expect(buildConfidence(buildCoverage([catalogProduct()], [], partial), partial).level).toBe(
      "medium",
    );
  });

  it("ignores staleness of resources this module does not read", () => {
    const sync = syncState({ staleResources: ["orders"] });
    expect(buildConfidence(buildCoverage([catalogProduct()], [], sync), sync).level).toBe("high");
  });
});

describe("buildOverview", () => {
  it("reports an unavailable catalogue metric before the first products sync", () => {
    const sync = syncState({ productsSynced: false });
    const { overview } = buildOverview([], [], sync);

    expect(overview.totalProducts.availability).toBe("unavailable");
    expect(overview.totalProducts.reason).toBe("catalog_not_synced");
    expect(overview.totalProducts.value).toBeNull();
  });

  it("reports zero only when zero is measured", () => {
    const { overview } = report([catalogProduct()], syncState());

    expect(overview.needsAttention.value).toBe(0);
    expect(overview.hiddenProducts.value).toBe(0);
    expect(overview.uncategorized.value).toBe(0);
  });

  it("computes coverage percentages from products", () => {
    const products = [
      catalogProduct({ id: "p1" }),
      catalogProduct({ id: "p2", imageUrl: null }),
      catalogProduct({ id: "p3", categories: [] }),
      catalogProduct({ id: "p4", metadataTitle: null }),
    ];

    const { overview, counts } = buildOverview(
      products,
      products.map((product) => analyseProduct(product, NOW)),
      syncState(),
    );

    expect(counts.total).toBe(4);
    expect(overview.imageCoveragePercent.value).toBe(75);
    expect(overview.categoryCoveragePercent.value).toBe(75);
    expect(overview.metadataHealthPercent.value).toBe(75);
    expect(overview.uncategorized.value).toBe(1);
  });

  it("marks metadata health partial when metadata was not captured for every product", () => {
    const products = [
      catalogProduct({ id: "p1" }),
      catalogProduct({ id: "p2", metadataStored: false }),
    ];

    const { overview } = buildOverview(
      products,
      products.map((product) => analyseProduct(product, NOW)),
      syncState(),
    );

    expect(overview.metadataHealthPercent.availability).toBe("partial");
    expect(overview.metadataHealthPercent.reason).toBe("metadata_not_captured");
    expect(overview.metadataHealthPercent.value).toBe(100);
  });

  it("reports staleness as unavailable when no product has a provider timestamp", () => {
    const { overview } = report([bareProduct()], syncState());

    expect(overview.staleProducts.availability).toBe("unavailable");
    expect(overview.staleProducts.reason).toBe("provider_updated_at_missing");
  });

  it("marks staleness partial when only some products carry a timestamp", () => {
    const products = [catalogProduct(), bareProduct()];

    const { overview } = report(products, syncState());

    expect(overview.staleProducts.availability).toBe("partial");
    expect(overview.staleProducts.reason).toBe("updated_at_missing_for_some_products");
  });

  it("marks stock partial when only some products have a known quantity", () => {
    const products = [
      catalogProduct({ inventory: inventoryState({ quantity: 0 }) }),
      bareProduct(),
    ];

    const { overview } = report(products, syncState());

    expect(overview.outOfStock.availability).toBe("partial");
    expect(overview.outOfStock.reason).toBe("stock_known_for_some_products");
    expect(overview.outOfStock.value).toBe(1);
  });

  it("computes the average content score across products", () => {
    const products = [catalogProduct({ description: null }), catalogProduct({ id: "p2" })];

    const { overview } = report(products, syncState());

    // 55 (no description pair) and 100 → 77.5
    expect(overview.averageContentScore.value).toBe(77.5);
  });

  it("reports category coverage as unavailable when categories were not synced", () => {
    const { overview } = report([catalogProduct()], syncState({ categoriesSynced: false }));

    expect(overview.categoryCoveragePercent.availability).toBe("unavailable");
    expect(overview.categoryCoveragePercent.reason).toBe("categories_not_synced");
    expect(overview.uncategorized.availability).toBe("unavailable");
  });
});

describe("buildCatalogReport", () => {
  it("ranks issues and states coverage and confidence together", () => {
    const result = report([catalogProduct({ description: null, sku: null })], syncState());

    expect(result.issues.map((issue) => issue.id)).toEqual(["missing_description", "missing_sku"]);
    expect(result.coverage.status).toBe("complete");
    expect(result.confidence.level).toBe("high");
    expect(result.counts.issueCount).toBe(2);
  });
});

describe("buildCategoryHealth", () => {
  const categories = [
    { id: "cat_1", name: "قمصان", status: "sale" },
    { id: "cat_2", name: "أحذية", status: "hidden" },
  ];

  it("counts members and their gaps", () => {
    const products = [
      catalogProduct({ id: "p1" }),
      catalogProduct({ id: "p2", description: null, imageUrl: null }),
    ];

    const health = buildCategoryHealth(
      products,
      products.map((product) => analyseProduct(product, NOW)),
      categories,
    );

    const shirts = health.find((category) => category.id === "cat_1");
    expect(shirts?.productCount).toBe(2);
    expect(shirts?.missingDescription).toBe(1);
    expect(shirts?.missingDescriptionPercent).toBe(50);
    expect(shirts?.missingImage).toBe(1);
    expect(shirts?.averageContentScore.value).toBe(77.5);
  });

  it("returns unavailable averages for an empty category rather than zero", () => {
    const health = buildCategoryHealth([], [], categories);

    for (const category of health) {
      expect(category.averageContentScore.availability).toBe("unavailable");
      expect(category.averageContentScore.reason).toBe("no_products_in_category");
      expect(category.completenessPercent.availability).toBe("unavailable");
      expect(category.belowVerdictThreshold).toBe(true);
    }
  });

  it("never reports a sales attribution", () => {
    const products = [catalogProduct()];
    const health = buildCategoryHealth(
      products,
      products.map((product) => analyseProduct(product, NOW)),
      categories,
    );

    for (const category of health) {
      expect(category.salesAttribution.availability).toBe("unavailable");
      expect(category.salesAttribution.reason).toBe("product_sales_not_linked");
    }
  });

  it("reports a hidden category from the stored status", () => {
    const health = buildCategoryHealth([], [], categories);
    expect(health.find((category) => category.id === "cat_2")?.hidden).toBe(true);
  });
});
