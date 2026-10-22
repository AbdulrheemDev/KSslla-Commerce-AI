import { describe, expect, it } from "vitest";

import { ISSUE_IDS } from "@/modules/product-intelligence/domain/issues";
import { summariseIssues } from "@/modules/product-intelligence/domain/issues";
import { analyseProduct } from "@/modules/product-intelligence/domain/products";
import { buildRecommendations } from "@/modules/product-intelligence/domain/recommendations";
import { NOW, catalogProduct } from "@/test/product-intelligence-fixtures";

/**
 * The exit criterion for the phase is "no recommendation without evidence", so
 * these tests assert the coupling directly: recommendations are a projection of
 * fired issues, and an issue that did not fire cannot produce one.
 */

function recommendationsFor(overrides: Parameters<typeof catalogProduct>[0], total = 1) {
  const product = analyseProduct(catalogProduct(overrides), NOW);
  const issues = summariseIssues([product], total);
  return { issues, recommendations: buildRecommendations(issues, total) };
}

describe("buildRecommendations", () => {
  it("emits exactly one recommendation per fired issue", () => {
    const { issues, recommendations } = recommendationsFor({ description: null, sku: null });

    expect(recommendations).toHaveLength(issues.length);
    expect(recommendations.map((item) => item.issueId)).toEqual(issues.map((issue) => issue.id));
  });

  it("emits nothing for a clean catalogue", () => {
    expect(recommendationsFor({}).recommendations).toEqual([]);
  });

  it("carries the evidence: count, share, and example products", () => {
    const { recommendations } = recommendationsFor({ description: null }, 4);

    const first = recommendations[0]!;
    expect(first.affectedCount).toBe(1);
    expect(first.affectedPercent).toBe(25);
    expect(first.examples).toContain(catalogProduct().name);
    expect(first.rationale).toContain("1");
    expect(first.rationale).toContain("25%");
  });

  it("states the rule that produced it", () => {
    const { recommendations } = recommendationsFor({ imageUrl: null });

    expect(recommendations[0]?.rule).toBe("missing_image_count > 0");
    expect(recommendations[0]?.id).toBe("rec.missing_image");
  });

  it("maps severity to a priority and never invents a fourth level", () => {
    const { recommendations } = recommendationsFor({
      description: null,
      sku: null,
      status: "hidden",
    });

    const priorities = new Set(recommendations.map((item) => item.priority));
    for (const priority of priorities) expect(["P1", "P2", "P3"]).toContain(priority);
    expect(recommendations.find((item) => item.severity === "high")?.priority).toBe("P1");
    expect(recommendations.find((item) => item.severity === "low")?.priority).toBe("P3");
  });

  it("is advisory only, structurally", () => {
    const { recommendations } = recommendationsFor({ description: null });

    for (const item of recommendations) expect(item.advisoryOnly).toBe(true);
  });

  it("keeps the input order, so the ranking decides what is read first", () => {
    const { issues, recommendations } = recommendationsFor({
      description: null,
      sku: null,
      imageUrl: null,
    });

    expect(recommendations.map((item) => item.issueId)).toEqual(issues.map((issue) => issue.id));
  });

  it("has copy for every issue in the catalogue", () => {
    const issues = ISSUE_IDS.map((id) => ({
      id,
      category: "content" as const,
      severity: "low" as const,
      affectedCount: 1,
      affectedPercent: 100,
      score: 1,
      rule: `${id}_count > 0`,
      definition: "تعريف",
      evidence: ["منتج"],
    }));

    const recommendations = buildRecommendations(issues, 1);

    expect(recommendations).toHaveLength(ISSUE_IDS.length);
    for (const item of recommendations) {
      expect(item.title.length).toBeGreaterThan(0);
      expect(item.rationale.length).toBeGreaterThan(0);
      expect(item.examples).toHaveLength(1);
    }
  });
});
