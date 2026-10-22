import { describe, expect, it } from "vitest";

import { evaluateContent } from "@/modules/product-intelligence/domain/content";
import { PRODUCT_THRESHOLDS } from "@/modules/product-intelligence/domain/thresholds";
import { catalogProduct } from "@/test/product-intelligence-fixtures";

/**
 * Content quality: a weighted sum of named checks, never an SEO score.
 * Every weight is asserted here, so a change to `thresholds.ts` cannot silently
 * change a product's score.
 */

function score(overrides: Parameters<typeof catalogProduct>[0]): number {
  return evaluateContent(catalogProduct(overrides)).score.value ?? -1;
}

const LONG_DESCRIPTION = "ا".repeat(PRODUCT_THRESHOLDS.MIN_DESCRIPTION_CHARS);

describe("evaluateContent — score", () => {
  it("awards the full 100 when every check passes", () => {
    expect(score({ description: LONG_DESCRIPTION })).toBe(100);
  });

  it("sums the weights of exactly the checks that passed", () => {
    const weights = PRODUCT_THRESHOLDS.CONTENT_WEIGHT;

    expect(score({ name: "" })).toBe(100 - weights.name);
    expect(score({ description: null })).toBe(
      100 - weights.description - weights.descriptionLength,
    );
    expect(score({ description: "قصير جدًا" })).toBe(100 - weights.descriptionLength);
    expect(score({ url: null })).toBe(100 - weights.url);
    expect(score({ sku: null })).toBe(100 - weights.sku);
  });

  it("reaches zero for a product with nothing filled in", () => {
    expect(score({ name: "", description: null, url: null, sku: null })).toBe(0);
  });

  it("keeps the weights adding up to 100", () => {
    const weights = Object.values(PRODUCT_THRESHOLDS.CONTENT_WEIGHT);
    expect(weights.reduce((sum, weight) => sum + weight, 0)).toBe(100);
  });
});

describe("evaluateContent — checks", () => {
  it("reports what each check observed, so the score can be recomputed", () => {
    const result = evaluateContent(catalogProduct({ description: "أ".repeat(40) }));

    const descriptionLength = result.checks.find((check) => check.id === "description_length");
    expect(descriptionLength).toMatchObject({ passed: false, observed: 40 });

    const name = result.checks.find((check) => check.id === "name");
    expect(name?.observed).toBeGreaterThanOrEqual(PRODUCT_THRESHOLDS.MIN_NAME_CHARS);
  });

  it("counts a name exactly at the minimum length as passing", () => {
    const name = "أ".repeat(PRODUCT_THRESHOLDS.MIN_NAME_CHARS);
    expect(evaluateContent(catalogProduct({ name })).failed).not.toContain("name");
  });

  it("flags a one-character name as failing", () => {
    expect(evaluateContent(catalogProduct({ name: "أ" })).failed).toContain("name");
  });

  it("treats whitespace-only fields as missing", () => {
    const result = evaluateContent(catalogProduct({ name: "   ", description: "   ", sku: "  " }));

    expect(result.failed).toEqual(
      expect.arrayContaining(["name", "description", "description_length", "sku"]),
    );
  });

  it("measures length in code points, not UTF-16 units", () => {
    const emoji = "👕";
    expect(emoji.length).toBe(2);

    const result = evaluateContent(
      catalogProduct({ description: emoji.repeat(PRODUCT_THRESHOLDS.MIN_DESCRIPTION_CHARS) }),
    );

    expect(result.checks.find((check) => check.id === "description_length")?.passed).toBe(true);
  });

  it("accepts http and https URLs and rejects anything else", () => {
    expect(evaluateContent(catalogProduct({ url: "http://example.test/p" })).failed).not.toContain(
      "url",
    );
    expect(evaluateContent(catalogProduct({ url: "/products/p" })).failed).toContain("url");
    expect(evaluateContent(catalogProduct({ url: "javascript:alert(1)" })).failed).toContain("url");
  });
});
