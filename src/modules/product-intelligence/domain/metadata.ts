import type { Metric } from "@/modules/intelligence/domain/types";
import { available, partial } from "@/modules/intelligence/domain/types";

import { PRODUCT_THRESHOLDS } from "./thresholds";
import { isBlank } from "./text";
import type { CatalogProductInput, MetadataEvaluation } from "./types";

/**
 * Provider metadata (`metadata.title` / `metadata.description`) health.
 *
 * Salla documents the product `metadata` object in the List Products and
 * Product Details examples (docs/salla-reference.md §17.1). Phase 04 stores
 * that object verbatim in `products.metadata.sallaMetadata`, so the two fields
 * are available locally **when the provider returned them**.
 *
 * `stored` distinguishes the two different facts:
 * - `stored: true`  → the object exists; a missing field is a real gap;
 * - `stored: false` → the provider sent no metadata object for this product.
 *   The score is still reported, but as `partial`, because "no object" cannot
 *   be told apart from "the sync stored nothing" for a row written before the
 *   object was captured. Those rows are rare (the mapper has stored the object
 *   since the first catalogue sync) but the distinction is free to carry.
 */

const WEIGHTS = PRODUCT_THRESHOLDS.METADATA_WEIGHT;

export function evaluateMetadata(product: CatalogProductInput): MetadataEvaluation {
  const titlePresent = !isBlank(product.metadataTitle);
  const descriptionPresent = !isBlank(product.metadataDescription);

  const score = (titlePresent ? WEIGHTS.title : 0) + (descriptionPresent ? WEIGHTS.description : 0);

  const metric: Metric<number> = product.metadataStored
    ? available(score, "sum(METADATA_WEIGHT where metadata field present)")
    : partial(score, "sum(METADATA_WEIGHT where metadata field present)", "metadata_not_captured");

  return {
    score: metric,
    titlePresent,
    descriptionPresent,
    stored: product.metadataStored,
  };
}
