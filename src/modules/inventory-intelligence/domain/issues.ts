import type { Severity } from "@/modules/intelligence/domain/opportunities";

import { INVENTORY_THRESHOLDS } from "./thresholds";
import { isNegativeQuantity } from "./stock";
import type {
  InventoryIssueSummary,
  InventoryProductInput,
  ProductInventoryAnalysis,
  UnlinkedInventoryEntry,
} from "./types";

/**
 * The inventory issue catalogue: one rule per gap, each with a fixed severity.
 *
 * Severity answers "how much does this hurt the store right now", not "how hard
 * is it to fix": an empty sellable shelf outranks a missing inventory row, which
 * outranks a row the catalogue has not linked yet.
 *
 * There is deliberately **no** issue for "excess", "dead stock", or "will run
 * out". Those are claims that need a demand rate; a rule cannot fire on evidence
 * that does not exist.
 */

export const INVENTORY_ISSUE_IDS = [
  "missing_inventory_record",
  "inventory_entry_unlinked",
  "out_of_stock",
  "low_stock",
  "negative_quantity",
] as const;

export type InventoryIssueId = (typeof INVENTORY_ISSUE_IDS)[number];

export interface InventoryIssueDefinition {
  readonly id: InventoryIssueId;
  readonly category: "coverage" | "availability" | "quality" | "demand";
  readonly severity: Severity;
  /** What the rule measured, in one sentence. */
  readonly definition: string;
  /** The rule as a boolean expression a reader can re-evaluate. */
  readonly rule: string;
  /** What the rule counted: products or raw inventory entries. */
  readonly population: "products" | "inventory_entries";
}

export const INVENTORY_ISSUE_DEFINITIONS: Record<InventoryIssueId, InventoryIssueDefinition> = {
  missing_inventory_record: {
    id: "missing_inventory_record",
    category: "coverage",
    severity: "medium",
    definition: "المنتج موجود في الكتالوج بلا سجل مخزون محفوظ، فحالته غير معروفة.",
    rule: "no inventory_levels row is linked to the product",
    population: "products",
  },
  inventory_entry_unlinked: {
    id: "inventory_entry_unlinked",
    category: "coverage",
    severity: "low",
    definition: "سجل مخزون لم يُربط بمنتج في الكتالوج المحلي، فلا يظهر ضمن تغطية أي منتج.",
    rule: "inventory_levels.product_id is null",
    population: "inventory_entries",
  },
  out_of_stock: {
    id: "out_of_stock",
    category: "availability",
    severity: "high",
    definition: "الكمية الحالية صفر أو أقل والمنتج ليس بكمية غير محدودة.",
    rule: "quantity <= 0 AND unlimited_quantity = false",
    population: "products",
  },
  low_stock: {
    id: "low_stock",
    category: "availability",
    severity: "medium",
    definition: `الكمية الحالية بين 1 و${INVENTORY_THRESHOLDS.LOW_STOCK_UNITS} وحدات — حدّ مطلق معلن، وليس توقعًا.`,
    rule: `0 < quantity <= ${INVENTORY_THRESHOLDS.LOW_STOCK_UNITS} AND unlimited_quantity = false`,
    population: "products",
  },
  negative_quantity: {
    id: "negative_quantity",
    category: "quality",
    severity: "high",
    definition: "الكمية المحفوظة سالبة، وهي قيمة لا تمثّل مخزونًا صالحًا.",
    rule: "quantity < 0",
    population: "products",
  },
};

/** Issues fired for one product, in a fixed order. */
export function detectIssues(product: InventoryProductInput): InventoryIssueId[] {
  const issues: InventoryIssueId[] = [];
  const stock = product.stock;

  if (stock === null) {
    issues.push("missing_inventory_record");
    return issues;
  }

  if (isNegativeQuantity(stock.quantity)) issues.push("negative_quantity");
  else if (!stock.unlimitedQuantity) {
    if (stock.quantity <= 0) issues.push("out_of_stock");
    else if (stock.quantity <= INVENTORY_THRESHOLDS.LOW_STOCK_UNITS) issues.push("low_stock");
  }

  return issues;
}

const SEVERITY_RANK: Record<Severity, number> = { high: 3, medium: 2, low: 1 };

export function highestSeverity(issues: readonly InventoryIssueId[]): Severity | null {
  let highest: Severity | null = null;
  for (const id of issues) {
    const severity = INVENTORY_ISSUE_DEFINITIONS[id].severity;
    if (highest === null || SEVERITY_RANK[severity] > SEVERITY_RANK[highest]) highest = severity;
  }
  return highest;
}

function percentOf(count: number, total: number): number {
  return total === 0 ? 0 : Math.round((count / total) * 1000) / 10;
}

/**
 * Aggregates issues into ranked rows.
 *
 * `score = affectedCount × SEVERITY_WEIGHT[severity]`, sorted by score desc,
 * severity desc, affected count desc, then id asc. The first three keys can tie;
 * the id always decides, so two runs over the same snapshot produce the same
 * order and a reader can recompute it from the payload.
 */
export function summariseIssues(input: {
  readonly products: readonly InventoryProductInput[];
  readonly analyses: readonly ProductInventoryAnalysis[];
  readonly unlinkedEntries: readonly UnlinkedInventoryEntry[];
  readonly productsTotal: number;
  /** Every inventory entry of the store, linked or not — the denominator for entry-level rules. */
  readonly inventoryEntries: number;
}): InventoryIssueSummary[] {
  const byIssue = new Map<InventoryIssueId, string[]>();

  for (const analysis of input.analyses) {
    for (const issue of analysis.issues as InventoryIssueId[]) {
      const list = byIssue.get(issue) ?? [];
      list.push(analysis.name);
      byIssue.set(issue, list);
    }
  }

  if (input.unlinkedEntries.length > 0) {
    byIssue.set(
      "inventory_entry_unlinked",
      input.unlinkedEntries.map((entry) => entry.productName),
    );
  }

  const summaries: InventoryIssueSummary[] = [];

  for (const [id, names] of byIssue) {
    const definition = INVENTORY_ISSUE_DEFINITIONS[id];
    const affectedCount = names.length;
    const denominator =
      definition.population === "products" ? input.productsTotal : input.inventoryEntries;

    summaries.push({
      id,
      category: definition.category,
      severity: definition.severity,
      population: definition.population,
      affectedCount,
      affectedPercent: percentOf(affectedCount, denominator),
      score: affectedCount * INVENTORY_THRESHOLDS.SEVERITY_WEIGHT[definition.severity],
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
