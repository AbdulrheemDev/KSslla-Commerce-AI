import { available, unavailable, type Metric } from "@/modules/intelligence/domain/types";

import { PRODUCT_THRESHOLDS } from "./thresholds";
import { daysBetween } from "./text";
import type { CatalogProductInput, LifecycleEvaluation } from "./types";

/**
 * Product lifecycle, built only from dates the mirror really has.
 *
 * - `source_updated_at` is the provider `updated_at` (documented on both List
 *   Products and Product Details). It answers "when was this product last
 *   changed in Salla", so it drives `stale_content`.
 * - The provider documents **no** product creation date; the documented example
 *   carries `updated_at` only. Therefore `ageDays` is `unavailable` and is never
 *   derived from `updated_at` — "last touched" is not "created".
 * - `last_seen_at` is our own observation time (set by the sync), not a provider
 *   fact, and is returned separately by the repository rather than mixed in.
 *
 * The `hidden` flag reads the documented `status` example `hidden`. Salla
 * publishes no closed status enumeration, so every other value is left alone
 * rather than mapped to "hidden" or "deleted".
 */

export const HIDDEN_STATUS = "hidden";

export function evaluateLifecycle(product: CatalogProductInput, now: Date): LifecycleEvaluation {
  const updatedAt = product.sourceUpdatedAt === null ? null : new Date(product.sourceUpdatedAt);
  const validUpdatedAt =
    updatedAt !== null && !Number.isNaN(updatedAt.getTime()) ? updatedAt : null;

  const daysSinceUpdate = validUpdatedAt === null ? null : daysBetween(validUpdatedAt, now);

  const lastUpdated: Metric<string> =
    validUpdatedAt === null
      ? unavailable("provider_updated_at_missing")
      : available(validUpdatedAt.toISOString(), "products.source_updated_at (provider updated_at)");

  const stale =
    daysSinceUpdate === null ? null : daysSinceUpdate >= PRODUCT_THRESHOLDS.STALE_CONTENT_DAYS;

  return {
    lastUpdated,
    daysSinceUpdate,
    stale,
    recentlyUpdated:
      daysSinceUpdate !== null && daysSinceUpdate <= PRODUCT_THRESHOLDS.RECENT_UPDATE_DAYS,
    // No documented creation date exists; a fabricated age would be a lie.
    ageDays: unavailable("created_at_not_documented"),
    hidden: product.status === HIDDEN_STATUS,
  };
}
