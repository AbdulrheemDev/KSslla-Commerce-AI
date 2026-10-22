import { available, partial, unavailable, type Metric } from "@/modules/intelligence/domain/types";

import { summariseIssues } from "./issues";
import type { CatalogProductInput, IssueSummary, ProductAnalysis } from "./types";

/**
 * Catalogue-level summary.
 *
 * Every metric states the population it divided by. Where a denominator is
 * incomplete (some products carry no provider `updated_at`, some carry no stock
 * row) the metric is `partial` and says which part of the catalogue it covered;
 * where the whole source is missing it is `unavailable` with the reason. Zero is
 * only ever reported when zero is the measured fact.
 */

export interface CategoryRef {
  readonly id: string;
  readonly name: string;
  readonly status: string;
}

export interface CatalogSyncState {
  readonly productsSynced: boolean;
  readonly productsSyncFailed: boolean;
  readonly categoriesSynced: boolean;
  readonly categoriesSyncFailed: boolean;
  /** `items_skipped` of the last successful products run. */
  readonly productsSkipped: number;
  readonly categoriesSkipped: number;
  readonly lastProductsSyncAt: string | null;
  readonly lastCategoriesSyncAt: string | null;
  readonly staleResources: readonly string[];
}

export interface CatalogCoverage {
  readonly status: "complete" | "partial" | "empty";
  readonly productCount: number;
  readonly categoryCount: number;
  readonly lastProductsSyncAt: string | null;
  readonly lastCategoriesSyncAt: string | null;
  readonly notes: readonly string[];
}

export interface CatalogConfidence {
  readonly level: "high" | "medium" | "low";
  readonly productsSynced: boolean;
  readonly categoriesSynced: boolean;
  readonly syncFailed: boolean;
  readonly coverageStatus: CatalogCoverage["status"];
  readonly staleResources: readonly string[];
}

export interface CatalogOverview {
  readonly totalProducts: Metric<number>;
  readonly needsAttention: Metric<number>;
  readonly averageContentScore: Metric<number>;
  readonly metadataHealthPercent: Metric<number>;
  readonly imageCoveragePercent: Metric<number>;
  readonly categoryCoveragePercent: Metric<number>;
  readonly hiddenProducts: Metric<number>;
  readonly staleProducts: Metric<number>;
  readonly outOfStock: Metric<number>;
  readonly uncategorized: Metric<number>;
}

export interface CatalogReport {
  readonly overview: CatalogOverview;
  readonly issues: readonly IssueSummary[];
  readonly coverage: CatalogCoverage;
  readonly confidence: CatalogConfidence;
  readonly counts: {
    readonly total: number;
    readonly needsAttention: number;
    readonly clean: number;
    readonly withImage: number;
    readonly withCompleteMetadata: number;
    readonly categorized: number;
    readonly hidden: number;
    readonly stale: number;
    readonly staleEvaluated: number;
    readonly outOfStock: number;
    readonly stockKnown: number;
    readonly metadataCaptured: number;
    readonly issueCount: number;
  };
}

function percent(numerator: number, denominator: number): number {
  return Math.round((numerator / denominator) * 1000) / 10;
}

export function buildCoverage(
  products: readonly CatalogProductInput[],
  categories: readonly CategoryRef[],
  sync: CatalogSyncState,
): CatalogCoverage {
  const notes: string[] = [];

  if (!sync.productsSynced) notes.push("products_not_synced");
  if (sync.productsSyncFailed) notes.push("products_sync_incomplete");
  if (!sync.categoriesSynced) notes.push("categories_not_synced");
  if (sync.categoriesSyncFailed) notes.push("categories_sync_incomplete");
  if (sync.productsSkipped > 0) notes.push("products_skipped_in_last_run");
  if (sync.categoriesSkipped > 0) notes.push("categories_skipped_in_last_run");
  if (products.length === 0) notes.push("no_products_stored");
  if (products.some((product) => !product.metadataStored)) notes.push("metadata_not_captured");

  const empty = products.length === 0;
  const partialCoverage =
    !empty &&
    (sync.productsSyncFailed ||
      sync.categoriesSyncFailed ||
      !sync.categoriesSynced ||
      sync.productsSkipped > 0 ||
      sync.categoriesSkipped > 0 ||
      products.some((product) => !product.metadataStored));

  return {
    status: empty ? "empty" : partialCoverage ? "partial" : "complete",
    productCount: products.length,
    categoryCount: categories.length,
    lastProductsSyncAt: sync.lastProductsSyncAt,
    lastCategoriesSyncAt: sync.lastCategoriesSyncAt,
    notes,
  };
}

export function buildConfidence(
  coverage: CatalogCoverage,
  sync: CatalogSyncState,
): CatalogConfidence {
  const staleResources = sync.staleResources.filter(
    (resource) => resource === "products" || resource === "categories",
  );

  const level: CatalogConfidence["level"] =
    !sync.productsSynced || sync.productsSyncFailed || coverage.status === "empty"
      ? "low"
      : coverage.status === "partial" || staleResources.length > 0
        ? "medium"
        : "high";

  return {
    level,
    productsSynced: sync.productsSynced,
    categoriesSynced: sync.categoriesSynced,
    syncFailed: sync.productsSyncFailed || sync.categoriesSyncFailed,
    coverageStatus: coverage.status,
    staleResources,
  };
}

/**
 * Wraps a value that was measured from rows the mirror already holds.
 *
 * Three states, deliberately distinct:
 * - no rows and no successful sync → `unavailable("catalog_not_synced")`:
 *   nothing was ever captured, so there is nothing to count;
 * - rows exist but the products resource never recorded a success → `partial`
 *   with the same reason: the count is real, the completeness is not vouched
 *   for (a hand-seeded or interrupted mirror looks like this);
 * - a successful sync → `available`.
 *
 * A zero is therefore only ever "0 products", never "0 because we did not look".
 */
function catalogMetric<T>(
  value: T,
  basis: string,
  sync: CatalogSyncState,
  total: number,
): Metric<T> {
  if (total === 0) {
    return sync.productsSynced
      ? unavailable("no_products_stored", basis)
      : unavailable("catalog_not_synced", basis);
  }

  return sync.productsSynced
    ? available(value, basis)
    : partial(value, basis, "catalog_not_synced");
}

export function buildOverview(
  products: readonly CatalogProductInput[],
  analyses: readonly ProductAnalysis[],
  sync: CatalogSyncState,
): { overview: CatalogOverview; counts: CatalogReport["counts"] } {
  const total = products.length;
  const needsAttention = analyses.filter((product) => product.needsAttention).length;
  const withImage = analyses.filter((product) => product.images.status === "present").length;
  const categorized = products.filter((product) => product.categories.length > 0).length;
  const hidden = analyses.filter((product) => product.lifecycle.hidden).length;

  const metadataCaptured = products.filter((product) => product.metadataStored).length;
  // Only products whose metadata object was actually stored can be counted as
  // "complete": a row with no captured object is unknown, not complete.
  const withCompleteMetadata = analyses.filter(
    (product) =>
      product.metadata.stored &&
      product.metadata.titlePresent &&
      product.metadata.descriptionPresent,
  ).length;

  const staleEvaluated = analyses.filter((product) => product.lifecycle.stale !== null).length;
  const stale = analyses.filter((product) => product.lifecycle.stale === true).length;

  const stockKnown = analyses.filter((product) => product.commercial.outOfStock !== null).length;
  const outOfStock = analyses.filter((product) => product.commercial.outOfStock === true).length;

  const averageContentScore =
    total === 0
      ? 0
      : Math.round(
          (analyses.reduce((sum, product) => sum + (product.content.score.value ?? 0), 0) / total) *
            10,
        ) / 10;

  const totalProducts: Metric<number> =
    total === 0
      ? sync.productsSynced
        ? available(0, "count(products where store_id = ?)")
        : unavailable("catalog_not_synced")
      : sync.productsSynced
        ? available(total, "count(products where store_id = ?)")
        : partial(total, "count(products where store_id = ?)", "catalog_not_synced");

  const overview: CatalogOverview = {
    totalProducts,
    needsAttention: catalogMetric(
      needsAttention,
      "products with at least one high/medium issue",
      sync,
      total,
    ),
    averageContentScore:
      total === 0
        ? unavailable(sync.productsSynced ? "no_products_stored" : "catalog_not_synced")
        : catalogMetric(averageContentScore, "mean(product.content.score)", sync, total),
    metadataHealthPercent:
      total === 0
        ? unavailable(sync.productsSynced ? "no_products_stored" : "catalog_not_synced")
        : !sync.productsSynced
          ? partial(
              percent(withCompleteMetadata, Math.max(metadataCaptured, 1)),
              "products with complete metadata ÷ products whose metadata object was stored",
              "catalog_not_synced",
            )
          : metadataCaptured === total
            ? available(
                percent(withCompleteMetadata, total),
                "products with metadata.title AND metadata.description ÷ products",
              )
            : partial(
                percent(withCompleteMetadata, Math.max(metadataCaptured, 1)),
                "products with complete metadata ÷ products whose metadata object was stored",
                "metadata_not_captured",
              ),
    imageCoveragePercent:
      total === 0
        ? unavailable(sync.productsSynced ? "no_products_stored" : "catalog_not_synced")
        : catalogMetric(
            percent(withImage, total),
            "products with a main image ÷ products",
            sync,
            total,
          ),
    categoryCoveragePercent:
      total === 0
        ? unavailable(sync.productsSynced ? "no_products_stored" : "catalog_not_synced")
        : sync.categoriesSynced
          ? available(
              percent(categorized, total),
              "products linked to at least one category ÷ products",
            )
          : unavailable("categories_not_synced"),
    hiddenProducts: catalogMetric(hidden, "products with status = 'hidden'", sync, total),
    staleProducts:
      total === 0
        ? unavailable(sync.productsSynced ? "no_products_stored" : "catalog_not_synced")
        : !sync.productsSynced
          ? partial(
              stale,
              "products older than the staleness threshold ÷ products with provider updated_at",
              "catalog_not_synced",
            )
          : staleEvaluated === 0
            ? unavailable("provider_updated_at_missing")
            : staleEvaluated === total
              ? available(stale, "products older than the staleness threshold ÷ products")
              : partial(
                  stale,
                  "products older than the staleness threshold ÷ products with provider updated_at",
                  "updated_at_missing_for_some_products",
                ),
    outOfStock:
      total === 0
        ? unavailable(sync.productsSynced ? "no_products_stored" : "catalog_not_synced")
        : !sync.productsSynced
          ? partial(
              outOfStock,
              "products with stock <= 0 ÷ products whose stock is known",
              "catalog_not_synced",
            )
          : stockKnown === 0
            ? unavailable("no_stock_data")
            : stockKnown === total
              ? available(outOfStock, "products with stock <= 0 and not unlimited")
              : partial(
                  outOfStock,
                  "products with stock <= 0 ÷ products whose stock is known",
                  "stock_known_for_some_products",
                ),
    uncategorized: sync.categoriesSynced
      ? available(total - categorized, "products with no category link")
      : unavailable("categories_not_synced"),
  };

  return {
    overview,
    counts: {
      total,
      needsAttention,
      clean: total - needsAttention,
      withImage,
      withCompleteMetadata,
      categorized,
      hidden,
      stale,
      staleEvaluated,
      outOfStock,
      stockKnown,
      metadataCaptured,
      issueCount: analyses.reduce((sum, product) => sum + product.issues.length, 0),
    },
  };
}

export function buildCatalogReport(
  products: readonly CatalogProductInput[],
  analyses: readonly ProductAnalysis[],
  categories: readonly CategoryRef[],
  sync: CatalogSyncState,
): CatalogReport {
  const { overview, counts } = buildOverview(products, analyses, sync);
  const coverage = buildCoverage(products, categories, sync);

  return {
    overview,
    issues: summariseIssues(analyses, products.length),
    coverage,
    confidence: buildConfidence(coverage, sync),
    counts,
  };
}
