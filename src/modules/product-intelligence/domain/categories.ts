import { available, unavailable, type Metric } from "@/modules/intelligence/domain/types";

import type { CategoryRef } from "./catalog";
import { PRODUCT_THRESHOLDS } from "./thresholds";
import type { CatalogProductInput, ProductAnalysis } from "./types";

/**
 * Category **catalogue** health.
 *
 * This is deliberately not "category performance". There is no product↔order
 * line link (Phase 05 §13.1), so revenue, units, and conversion per category
 * cannot be computed; the metric is present in every row as `unavailable` with
 * that reason rather than omitted, so the UI can say why the column is empty.
 *
 * Everything else here is counting: how many products the category holds, how
 * many of them miss a description, metadata, an image, or a category link, and
 * the average content score. A category with no products returns `unavailable`
 * averages — not zero, which would read as "the products score badly".
 */

export interface CategoryHealth {
  readonly id: string;
  readonly name: string;
  readonly status: string;
  readonly hidden: boolean;
  readonly productCount: number;
  readonly missingDescription: number;
  readonly missingDescriptionPercent: number;
  readonly missingMetadata: number;
  readonly missingMetadataPercent: number;
  readonly missingImage: number;
  readonly missingImagePercent: number;
  readonly hiddenProducts: number;
  readonly averageContentScore: Metric<number>;
  /** Share of products with a full content score, complete metadata, and an image. */
  readonly completenessPercent: Metric<number>;
  /** Always unavailable: no reliable product-level sales attribution exists. */
  readonly salesAttribution: Metric<number>;
  /** True when the category has too few products for its percentages to mean much. */
  readonly belowVerdictThreshold: boolean;
}

function percentOf(count: number, total: number): number {
  return total === 0 ? 0 : Math.round((count / total) * 1000) / 10;
}

export function buildCategoryHealth(
  products: readonly CatalogProductInput[],
  analyses: readonly ProductAnalysis[],
  categories: readonly CategoryRef[],
): CategoryHealth[] {
  const analysisById = new Map(analyses.map((analysis) => [analysis.id, analysis]));

  return categories.map((category) => {
    const members = products.filter((product) =>
      product.categories.some((ref) => ref.id === category.id),
    );
    const memberAnalyses = members
      .map((product) => analysisById.get(product.id))
      .filter((analysis): analysis is ProductAnalysis => analysis !== undefined);

    const count = members.length;
    const missingDescription = memberAnalyses.filter((analysis) =>
      analysis.issues.includes("missing_description"),
    ).length;
    const missingMetadata = memberAnalyses.filter(
      (analysis) =>
        analysis.issues.includes("missing_metadata_title") ||
        analysis.issues.includes("missing_metadata_description"),
    ).length;
    const missingImage = memberAnalyses.filter((analysis) =>
      analysis.issues.includes("missing_image"),
    ).length;
    const hiddenProducts = memberAnalyses.filter((analysis) =>
      analysis.issues.includes("hidden_product"),
    ).length;

    const complete = memberAnalyses.filter(
      (analysis) =>
        analysis.content.score.value === 100 &&
        !analysis.issues.includes("missing_metadata_title") &&
        !analysis.issues.includes("missing_metadata_description") &&
        analysis.images.status === "present",
    ).length;

    const averageScore =
      count === 0
        ? null
        : Math.round(
            (memberAnalyses.reduce(
              (sum, analysis) => sum + (analysis.content.score.value ?? 0),
              0,
            ) /
              count) *
              10,
          ) / 10;

    return {
      id: category.id,
      name: category.name,
      status: category.status,
      hidden: category.status === "hidden",
      productCount: count,
      missingDescription,
      missingDescriptionPercent: percentOf(missingDescription, count),
      missingMetadata,
      missingMetadataPercent: percentOf(missingMetadata, count),
      missingImage,
      missingImagePercent: percentOf(missingImage, count),
      hiddenProducts,
      averageContentScore:
        averageScore === null
          ? unavailable("no_products_in_category")
          : available(averageScore, "mean(product.content.score) over the category's products"),
      completenessPercent:
        count === 0
          ? unavailable("no_products_in_category")
          : available(
              percentOf(complete, count),
              "products with complete content, metadata, and image ÷ products",
            ),
      salesAttribution: unavailable("product_sales_not_linked"),
      belowVerdictThreshold: count < PRODUCT_THRESHOLDS.MIN_PRODUCTS_FOR_CATEGORY_HEALTH,
    };
  });
}
