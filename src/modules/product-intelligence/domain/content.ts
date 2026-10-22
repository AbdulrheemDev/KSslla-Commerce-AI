import type { Metric } from "@/modules/intelligence/domain/types";
import { available } from "@/modules/intelligence/domain/types";

import { PRODUCT_THRESHOLDS } from "./thresholds";
import { codePointLength, isBlank, isHttpUrl } from "./text";
import type { CatalogCheck, CatalogProductInput, ContentEvaluation } from "./types";

/**
 * Product content quality — deterministic, weighted, and fully explained.
 *
 * The score is **not** an SEO score and makes no search-engine claim. It
 * measures whether the product record carries the fields a shopper needs in
 * order to understand the item: a usable name, a description long enough to
 * answer "what is this", a product URL, and a SKU.
 *
 * Every check reports what it observed, so the UI can say *why* a product lost
 * points. Weights live in `thresholds.ts` and sum to 100.
 */

const WEIGHTS = PRODUCT_THRESHOLDS.CONTENT_WEIGHT;

export const CONTENT_CHECK_IDS = [
  "name",
  "description",
  "description_length",
  "url",
  "sku",
] as const;

export type ContentCheckId = (typeof CONTENT_CHECK_IDS)[number];

/** Arabic copy for the UI; the engine reasons in ids only. */
export const CONTENT_CHECK_LABELS_AR: Record<ContentCheckId, string> = {
  name: "اسم المنتج",
  description: "وصف المنتج",
  description_length: "طول الوصف",
  url: "رابط المنتج",
  sku: "رمز SKU",
};

function weightOf(id: ContentCheckId): number {
  switch (id) {
    case "name":
      return WEIGHTS.name;
    case "description":
      return WEIGHTS.description;
    case "description_length":
      return WEIGHTS.descriptionLength;
    case "url":
      return WEIGHTS.url;
    case "sku":
      return WEIGHTS.sku;
  }
}

export function evaluateContent(product: CatalogProductInput): ContentEvaluation {
  const name = isBlank(product.name) ? null : product.name.trim();
  const description = isBlank(product.description) ? null : (product.description as string).trim();
  const url = isBlank(product.url) ? null : product.url;
  const sku = isBlank(product.sku) ? null : (product.sku as string).trim();

  const nameLength = name === null ? 0 : codePointLength(name);
  const descriptionLength = description === null ? 0 : codePointLength(description);

  const checks: CatalogCheck[] = [
    {
      id: "name",
      passed: name !== null && nameLength >= PRODUCT_THRESHOLDS.MIN_NAME_CHARS,
      observed: nameLength,
    },
    { id: "description", passed: description !== null, observed: descriptionLength },
    {
      id: "description_length",
      passed: description !== null && descriptionLength >= PRODUCT_THRESHOLDS.MIN_DESCRIPTION_CHARS,
      observed: descriptionLength,
    },
    { id: "url", passed: isHttpUrl(url), observed: url },
    { id: "sku", passed: sku !== null, observed: sku },
  ];

  const passedWeight = checks.reduce(
    (total, check) => (check.passed ? total + weightOf(check.id as ContentCheckId) : total),
    0,
  );

  const score: Metric<number> = available(passedWeight, "sum(CONTENT_WEIGHT where check passed)");

  return {
    score,
    checks,
    failed: checks.filter((check) => !check.passed).map((check) => check.id),
  };
}

/** Points a product loses for one content check — used by evidence strings. */
export function contentWeight(id: ContentCheckId): number {
  return weightOf(id);
}
