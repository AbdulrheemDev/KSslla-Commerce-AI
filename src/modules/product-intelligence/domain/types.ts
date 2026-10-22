import type { Metric } from "@/modules/intelligence/domain/types";
import type { Severity } from "@/modules/intelligence/domain/opportunities";

/**
 * Vocabulary for product intelligence.
 *
 * It reuses Phase 07's `Metric` (value + availability + basis + reason) and its
 * severity labels: a second metric shape or a second severity scale would let
 * the two screens disagree about the same product.
 *
 * The catalogue has no time window — it is the state that was last mirrored —
 * so there is no period in this module. "How fresh is it" is answered by the
 * Phase 07 freshness record (`sync_runs`), which is reused unchanged.
 */

export type IssueCategory =
  | "identity"
  | "content"
  | "metadata"
  | "images"
  | "commercial"
  | "category"
  | "lifecycle"
  | "inventory";

/** One category as the catalogue links it to a product. */
export interface CatalogCategoryRef {
  readonly id: string;
  readonly name: string;
  readonly status: string;
}

/** Aggregated current inventory for one product, when the mirror has any. */
export interface CatalogInventoryState {
  readonly quantity: number;
  readonly soldQuantity: number;
  readonly unlimitedQuantity: boolean;
  /** Number of inventory rows (variants) that were summed. */
  readonly entries: number;
  readonly lastSyncedAt: string;
}

/**
 * One product exactly as the mirror stores it.
 *
 * `metadataTitle` / `metadataDescription` come from the provider `metadata`
 * object that Phase 04 stores verbatim; `metadataStored` records whether the
 * object existed at all, so "no metadata" is never confused with "not
 * captured".
 */
export interface CatalogProductInput {
  readonly id: string;
  readonly name: string;
  readonly sku: string | null;
  readonly status: string;
  readonly description: string | null;
  readonly url: string | null;
  readonly imageUrl: string | null;
  readonly priceAmount: string | null;
  readonly currency: string | null;
  readonly quantity: number | null;
  readonly isAvailable: boolean;
  readonly sourceUpdatedAt: string | null;
  readonly lastSeenAt: string;
  readonly metadataStored: boolean;
  readonly metadataTitle: string | null;
  readonly metadataDescription: string | null;
  readonly categories: readonly CatalogCategoryRef[];
  readonly inventory: CatalogInventoryState | null;
}

/** A catalogue-level health check with the value that produced it. */
export interface CatalogCheck {
  readonly id: string;
  readonly passed: boolean;
  /** What was measured, in machine-readable form (for the UI and CSV). */
  readonly observed: string | number | boolean | null;
}

export interface ContentEvaluation {
  readonly score: Metric<number>;
  readonly checks: readonly CatalogCheck[];
  readonly failed: readonly string[];
}

export interface MetadataEvaluation {
  readonly score: Metric<number>;
  readonly titlePresent: boolean;
  readonly descriptionPresent: boolean;
  readonly stored: boolean;
}

export type ImageStatus = "present" | "missing" | "invalid";

export interface ImageEvaluation {
  readonly status: ImageStatus;
  /** `unavailable` — the mirror keeps one image URL, not the image list. */
  readonly count: Metric<number>;
  /** `unavailable` — alt text is not mirrored. */
  readonly altText: Metric<string>;
  readonly urlValid: boolean | null;
}

export interface LifecycleEvaluation {
  readonly lastUpdated: Metric<string>;
  readonly daysSinceUpdate: number | null;
  readonly stale: boolean | null;
  readonly recentlyUpdated: boolean;
  /** `unavailable` — the provider documents no product creation date. */
  readonly ageDays: Metric<number>;
  readonly hidden: boolean;
}

export interface CommercialEvaluation {
  readonly price: Metric<number>;
  readonly currency: Metric<string>;
  readonly stock: Metric<number>;
  readonly stockSource: "inventory" | "products" | null;
  readonly unlimitedQuantity: boolean | null;
  readonly outOfStock: boolean | null;
}

export interface ProductPerformance {
  /** `unavailable` — order lines carry no product reference (Phase 05 §13.1). */
  readonly periodSales: Metric<number>;
  /** `unavailable` — same reason: there is no reliable line-level revenue. */
  readonly revenue: Metric<number>;
  /** Provider cumulative counter; the period is undocumented. */
  readonly cumulativeSoldQuantity: Metric<number>;
}

export interface ProductAnalysis {
  readonly id: string;
  readonly name: string;
  readonly sku: string | null;
  readonly status: string;
  readonly categories: readonly string[];
  readonly categoryRefs: readonly CatalogCategoryRef[];
  readonly content: ContentEvaluation;
  readonly metadata: MetadataEvaluation;
  readonly images: ImageEvaluation;
  readonly lifecycle: LifecycleEvaluation;
  readonly commercial: CommercialEvaluation;
  readonly performance: ProductPerformance;
  readonly issues: readonly string[];
  /** Highest severity among the product's issues, or null. */
  readonly severity: Severity | null;
  readonly needsAttention: boolean;
}

/** Aggregated issue row: one rule, every product it fired on. */
export interface IssueSummary {
  readonly id: string;
  readonly category: IssueCategory;
  readonly severity: Severity;
  readonly affectedCount: number;
  readonly affectedPercent: number;
  /** `affectedCount × SEVERITY_WEIGHT[severity]`. */
  readonly score: number;
  readonly rule: string;
  readonly definition: string;
  readonly evidence: readonly string[];
}

export interface Recommendation {
  readonly id: string;
  readonly issueId: string;
  readonly title: string;
  readonly rationale: string;
  readonly priority: "P1" | "P2" | "P3";
  readonly severity: Severity;
  readonly rule: string;
  readonly affectedCount: number;
  readonly affectedPercent: number;
  readonly examples: readonly string[];
  /** Structural: a recommendation is never an executed action. */
  readonly advisoryOnly: true;
}
