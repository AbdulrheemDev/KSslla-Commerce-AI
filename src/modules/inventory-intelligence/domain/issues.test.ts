import { describe, expect, it } from "vitest";

import {
  issueSummary,
  productWithQuantity,
  stocklessProduct,
  unlinkedEntry,
} from "@/test/inventory-intelligence-fixtures";

import { INVENTORY_ISSUE_IDS, summariseIssues } from "./issues";
import { analyseInventoryProduct } from "./products";
import type { InventoryProductInput } from "./types";

/**
 * Issue ranking is deterministic and evidence-linked: the payload carries the
 * products that fired the rule, so a merchant can open them and check.
 */
describe("issue aggregation", () => {
  const products: InventoryProductInput[] = [
    { ...productWithQuantity(0), id: "p1", name: "سماعة" },
    { ...productWithQuantity(0), id: "p2", name: "شاحن" },
    { ...productWithQuantity(2), id: "p3", name: "كابل" },
    { ...stocklessProduct(), id: "p4", name: "حافظة" },
  ];
  const analyses = products.map((product) => analyseInventoryProduct(product));

  const issues = summariseIssues({
    products,
    analyses,
    unlinkedEntries: [unlinkedEntry({ productName: "منتج يتيم" })],
    productsTotal: products.length,
    inventoryEntries: 4,
  });

  it("only emits ids defined in the module", () => {
    for (const issue of issues) {
      expect(INVENTORY_ISSUE_IDS).toContain(issue.id);
    }
  });

  it("counts affected products and names them as evidence", () => {
    const outOfStock = issues.find((issue) => issue.id === "out_of_stock");

    expect(outOfStock?.affectedCount).toBe(2);
    expect(outOfStock?.evidence).toEqual(expect.arrayContaining(["سماعة", "شاحن"]));
    expect(outOfStock?.affectedPercent).toBe(50);
    expect(outOfStock?.score).toBe(6);
  });

  it("uses the product catalogue as the denominator for product rules", () => {
    const low = issues.find((issue) => issue.id === "low_stock");

    expect(low).toMatchObject({ population: "products", affectedCount: 1, affectedPercent: 25 });
  });

  it("uses inventory entries as the denominator for entry-level rules", () => {
    const unlinked = issues.find((issue) => issue.id === "inventory_entry_unlinked");

    expect(unlinked).toMatchObject({
      population: "inventory_entries",
      affectedCount: 1,
      affectedPercent: 25,
    });
  });

  it("sorts by score, then severity, then count, then id — deterministically", () => {
    const first = issues.map((issue) => issue.id);
    const second = summariseIssues({
      products,
      analyses,
      unlinkedEntries: [unlinkedEntry({ productName: "منتج يتيم" })],
      productsTotal: products.length,
      inventoryEntries: 4,
    }).map((issue) => issue.id);

    expect(first).toEqual(second);
    for (let index = 1; index < issues.length; index += 1) {
      const previous = issues[index - 1]!;
      const current = issues[index]!;
      expect(previous.score).toBeGreaterThanOrEqual(current.score);
    }
  });

  it("fires nothing when every product is healthy and every entry is linked", () => {
    const healthy = [
      { ...productWithQuantity(40), id: "h1" },
      { ...productWithQuantity(12), id: "h2" },
    ];
    const healthyAnalyses = healthy.map((product) => analyseInventoryProduct(product));

    expect(
      summariseIssues({
        products: healthy,
        analyses: healthyAnalyses,
        unlinkedEntries: [],
        productsTotal: healthy.length,
        inventoryEntries: healthy.length,
      }),
    ).toEqual([]);
  });
});

describe("issue summaries in recommendations", () => {
  it("keeps severity and rule from the summary it is built from", () => {
    const summary = issueSummary();

    expect(summary.rule).toContain("quantity <= 0");
    expect(summary.severity).toBe("high");
    expect(summary.evidence.length).toBeLessThanOrEqual(3);
  });
});
