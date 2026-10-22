import type { Severity } from "@/modules/intelligence/domain/opportunities";

import { PRODUCT_THRESHOLDS } from "./thresholds";
import type {
  CatalogProductInput,
  ContentEvaluation,
  ImageEvaluation,
  IssueCategory,
  LifecycleEvaluation,
  MetadataEvaluation,
  CommercialEvaluation,
  ProductAnalysis,
  IssueSummary,
} from "./types";

/**
 * The issue catalogue: one rule per gap, each with a fixed severity.
 *
 * Severity answers "how much does this hurt a shopper reading the catalogue",
 * not "how hard is it to fix". It is a constant per rule so the ranking cannot
 * drift between requests, and every rule states the population it judged and
 * the field it read.
 *
 * Nothing here uses AI, a model, or a subjective score.
 */

export const ISSUE_IDS = [
  "missing_name",
  "short_name",
  "missing_description",
  "short_description",
  "missing_metadata_title",
  "missing_metadata_description",
  "missing_image",
  "invalid_image_url",
  "missing_sku",
  "missing_url",
  "missing_category",
  "hidden_category_link",
  "hidden_product",
  "stale_content",
  "missing_price",
  "non_positive_price",
  "missing_currency",
  "out_of_stock",
] as const;

export type IssueId = (typeof ISSUE_IDS)[number];

export interface IssueDefinition {
  readonly id: IssueId;
  readonly category: IssueCategory;
  readonly severity: Severity;
  /** What the rule measured, in one sentence. */
  readonly definition: string;
  /** The rule as a boolean expression a reader can re-evaluate. */
  readonly rule: string;
}

export const ISSUE_DEFINITIONS: Record<IssueId, IssueDefinition> = {
  missing_name: {
    id: "missing_name",
    category: "identity",
    severity: "high",
    definition: "المنتج بلا اسم ظاهر، فلا يمكن التعرف عليه في أي قائمة.",
    rule: "name is blank",
  },
  short_name: {
    id: "short_name",
    category: "identity",
    severity: "medium",
    definition: `اسم المنتج أقصر من ${PRODUCT_THRESHOLDS.MIN_NAME_CHARS} أحرف، ويصعب فهمه في نتيجة بحث.`,
    rule: `0 < length(name) < ${PRODUCT_THRESHOLDS.MIN_NAME_CHARS}`,
  },
  missing_description: {
    id: "missing_description",
    category: "content",
    severity: "high",
    definition: "لا يوجد وصف للمنتج في النسخة المحلية.",
    rule: "description is null or blank",
  },
  short_description: {
    id: "short_description",
    category: "content",
    severity: "medium",
    definition: `الوصف أقصر من ${PRODUCT_THRESHOLDS.MIN_DESCRIPTION_CHARS} حرفًا، ولا يكفي لشرح المنتج.`,
    rule: `length(description) < ${PRODUCT_THRESHOLDS.MIN_DESCRIPTION_CHARS}`,
  },
  missing_metadata_title: {
    id: "missing_metadata_title",
    category: "metadata",
    severity: "high",
    definition: "لا يوجد عنوان في بيانات المنتج الوصفية (metadata.title).",
    rule: "metadata.title is blank",
  },
  missing_metadata_description: {
    id: "missing_metadata_description",
    category: "metadata",
    severity: "medium",
    definition: "لا يوجد وصف في بيانات المنتج الوصفية (metadata.description).",
    rule: "metadata.description is blank",
  },
  missing_image: {
    id: "missing_image",
    category: "images",
    severity: "high",
    definition: "المنتج بلا صورة رئيسية محفوظة.",
    rule: "image_url is null or blank",
  },
  invalid_image_url: {
    id: "invalid_image_url",
    category: "images",
    severity: "medium",
    definition: "رابط الصورة المحفوظ ليس رابط http(s) صالحًا.",
    rule: "image_url does not parse as http(s)",
  },
  missing_sku: {
    id: "missing_sku",
    category: "identity",
    severity: "medium",
    definition: "لا يوجد رمز SKU، وهو المعرّف التشغيلي للمنتج في المخزون والطلبات.",
    rule: "sku is null or blank",
  },
  missing_url: {
    id: "missing_url",
    category: "identity",
    severity: "medium",
    definition: "لا يوجد رابط صفحة المنتج في النسخة المحلية.",
    rule: "url is null or blank",
  },
  missing_category: {
    id: "missing_category",
    category: "category",
    severity: "high",
    definition: "المنتج غير مرتبط بأي تصنيف، فلا يمكن الوصول إليه عبر تصفح المتجر.",
    rule: "product_categories has no row for the product",
  },
  hidden_category_link: {
    id: "hidden_category_link",
    category: "category",
    severity: "low",
    definition: "المنتج مرتبط بتصنيف حالته hidden، وقد لا يظهر عبره.",
    rule: "any linked category.status = 'hidden'",
  },
  hidden_product: {
    id: "hidden_product",
    category: "lifecycle",
    severity: "low",
    definition: "حالة المنتج hidden، فهو غير معروض للزوار.",
    rule: "product.status = 'hidden'",
  },
  stale_content: {
    id: "stale_content",
    category: "lifecycle",
    severity: "medium",
    definition: `لم يُحدَّث المنتج في Salla منذ ${PRODUCT_THRESHOLDS.STALE_CONTENT_DAYS} يومًا أو أكثر.`,
    rule: `days_since(updated_at) >= ${PRODUCT_THRESHOLDS.STALE_CONTENT_DAYS}`,
  },
  missing_price: {
    id: "missing_price",
    category: "commercial",
    severity: "high",
    definition: "لا يوجد سعر محفوظ للمنتج.",
    rule: "price_amount is null",
  },
  non_positive_price: {
    id: "non_positive_price",
    category: "commercial",
    severity: "high",
    definition: "السعر المحفوظ صفر أو أقل، وهو ليس سعر بيع صالحًا.",
    rule: "price_amount <= 0",
  },
  missing_currency: {
    id: "missing_currency",
    category: "commercial",
    severity: "medium",
    definition: "لا توجد عملة محفوظة للسعر.",
    rule: "currency is null or blank",
  },
  out_of_stock: {
    id: "out_of_stock",
    category: "inventory",
    severity: "medium",
    definition: "الكمية الحالية صفر أو أقل، والمنتج ليس بكمية غير محدودة.",
    rule: "stock <= 0 and not unlimited",
  },
};

interface IssueInput {
  readonly product: CatalogProductInput;
  readonly content: ContentEvaluation;
  readonly metadata: MetadataEvaluation;
  readonly images: ImageEvaluation;
  readonly lifecycle: LifecycleEvaluation;
  readonly commercial: CommercialEvaluation;
}

/** Issues fired for one product, in a fixed order. */
export function detectIssues(input: IssueInput): IssueId[] {
  const { product, content, metadata, images, lifecycle, commercial } = input;
  const issues: IssueId[] = [];

  const nameCheck = content.checks.find((check) => check.id === "name");
  if (nameCheck && !nameCheck.passed) {
    issues.push(Number(nameCheck.observed) === 0 ? "missing_name" : "short_name");
  }

  if (content.failed.includes("description")) {
    issues.push("missing_description");
  } else if (content.failed.includes("description_length")) {
    issues.push("short_description");
  }

  if (!metadata.titlePresent) issues.push("missing_metadata_title");
  if (!metadata.descriptionPresent) issues.push("missing_metadata_description");

  if (images.status === "missing") issues.push("missing_image");
  if (images.status === "invalid") issues.push("invalid_image_url");

  if (content.failed.includes("sku")) issues.push("missing_sku");
  if (content.failed.includes("url")) issues.push("missing_url");

  if (product.categories.length === 0) issues.push("missing_category");
  else if (product.categories.some((category) => category.status === "hidden")) {
    issues.push("hidden_category_link");
  }

  if (lifecycle.hidden) issues.push("hidden_product");
  if (lifecycle.stale === true) issues.push("stale_content");

  if (commercial.price.availability === "unavailable") issues.push("missing_price");
  else if ((commercial.price.value ?? 0) <= 0) issues.push("non_positive_price");

  if (commercial.currency.availability === "unavailable") issues.push("missing_currency");
  if (commercial.outOfStock === true) issues.push("out_of_stock");

  return issues;
}

const SEVERITY_RANK: Record<Severity, number> = { high: 3, medium: 2, low: 1 };

export function highestSeverity(issues: readonly IssueId[]): Severity | null {
  let highest: Severity | null = null;
  for (const id of issues) {
    const severity = ISSUE_DEFINITIONS[id].severity;
    if (highest === null || SEVERITY_RANK[severity] > SEVERITY_RANK[highest]) highest = severity;
  }
  return highest;
}

/**
 * Aggregates product issues into ranked rows.
 *
 * `score = affectedCount × SEVERITY_WEIGHT[severity]`. Sorting is therefore
 * fully determined by the payload: score desc → severity desc → affected count
 * desc → id asc. Ties on the first three keys can only be broken by the id, so
 * two runs over the same snapshot always produce the same order.
 */
export function summariseIssues(
  products: readonly ProductAnalysis[],
  totalProducts: number,
): IssueSummary[] {
  const byIssue = new Map<IssueId, string[]>();

  for (const product of products) {
    for (const issue of product.issues as IssueId[]) {
      const list = byIssue.get(issue) ?? [];
      list.push(product.name);
      byIssue.set(issue, list);
    }
  }

  const summaries: IssueSummary[] = [];

  for (const [id, names] of byIssue) {
    const definition = ISSUE_DEFINITIONS[id];
    const affectedCount = names.length;
    const affectedPercent =
      totalProducts === 0 ? 0 : Math.round((affectedCount / totalProducts) * 1000) / 10;

    summaries.push({
      id,
      category: definition.category,
      severity: definition.severity,
      affectedCount,
      affectedPercent,
      score: affectedCount * PRODUCT_THRESHOLDS.SEVERITY_WEIGHT[definition.severity],
      rule: definition.rule,
      definition: definition.definition,
      evidence: names.slice(0, 3),
    });
  }

  return summaries.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    const severityDelta = SEVERITY_RANK[b.severity] - SEVERITY_RANK[a.severity];
    if (severityDelta !== 0) return severityDelta;
    if (b.affectedCount !== a.affectedCount) return b.affectedCount - a.affectedCount;
    return a.id.localeCompare(b.id);
  });
}
