import { describe, expect, it } from "vitest";

import { issueSummary } from "@/test/inventory-intelligence-fixtures";

import { buildRecommendations } from "./recommendations";
import type { InventoryIssueSummary } from "./types";

/**
 * Recommendations are a projection of the issues that fired — one per issue, no
 * free-floating advice, no forecast language, and `advisoryOnly: true` on every
 * row.
 */
describe("inventory recommendations", () => {
  const issues: InventoryIssueSummary[] = [
    issueSummary({
      id: "out_of_stock",
      severity: "high",
      affectedCount: 2,
      affectedPercent: 20,
      score: 6,
      evidence: ["سماعة", "شاحن"],
    }),
    issueSummary({
      id: "low_stock",
      severity: "medium",
      affectedCount: 3,
      affectedPercent: 30,
      score: 6,
      rule: "0 < quantity <= 5 AND unlimited_quantity = false",
      evidence: ["كابل"],
    }),
  ];

  const recommendations = buildRecommendations(issues, 10);

  it("emits exactly one recommendation per fired issue", () => {
    expect(recommendations).toHaveLength(issues.length);
    expect(recommendations.map((item) => item.issueId)).toEqual(["out_of_stock", "low_stock"]);
  });

  it("is deterministic for the same snapshot", () => {
    expect(buildRecommendations(issues, 10)).toEqual(recommendations);
  });

  it("links every recommendation to its rule, counts, and evidence", () => {
    const outOfStock = recommendations[0]!;

    expect(outOfStock.rule).toContain("out_of_stock");
    expect(outOfStock.affectedCount).toBe(2);
    expect(outOfStock.affectedPercent).toBe(20);
    expect(outOfStock.evidence).toEqual(["سماعة", "شاحن"]);
  });

  it("marks every recommendation advisory-only", () => {
    for (const item of recommendations) {
      expect(item.advisoryOnly).toBe(true);
    }
  });

  it("maps severity to priority without escalating", () => {
    expect(recommendations.map((item) => item.priority)).toEqual(["P1", "P2"]);
  });

  it("states the count in the rationale so the sentence matches the numbers", () => {
    expect(recommendations[0]!.rationale).toContain("2 من 10");
  });

  it("contains no forecast, reorder, or dead-stock language", () => {
    const text = recommendations.map((item) => `${item.title} ${item.rationale}`).join(" ");

    expect(text).not.toMatch(/سيرتفع|سيبيع|سيصل|نفاد خلال|اطلب|أعد الطلب|كمية إعادة الطلب/);
    expect(text).not.toMatch(/خلال \d+ (يوم|أيام)/);
  });

  it("emits nothing when no issue fired", () => {
    expect(buildRecommendations([], 0)).toEqual([]);
  });

  it("keeps the rule on the payload for every issue, not only the first", () => {
    for (const item of recommendations) {
      expect(item.rule.length).toBeGreaterThan(0);
      expect(item.rationale.length).toBeGreaterThan(20);
    }
  });
});
