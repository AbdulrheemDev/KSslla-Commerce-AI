import { describe, expect, it } from "vitest";

import {
  ISSUE_DEFINITIONS,
  ISSUE_IDS,
  summariseIssues,
  type IssueId,
} from "@/modules/product-intelligence/domain/issues";
import { analyseProduct } from "@/modules/product-intelligence/domain/products";
import { PRODUCT_THRESHOLDS } from "@/modules/product-intelligence/domain/thresholds";
import type { ProductAnalysis } from "@/modules/product-intelligence/domain/types";
import {
  NOW,
  bareProduct,
  catalogProduct,
  inventoryState,
} from "@/test/product-intelligence-fixtures";

function issuesOf(overrides: Parameters<typeof catalogProduct>[0]): readonly IssueId[] {
  return analyseProduct(catalogProduct(overrides), NOW).issues as readonly IssueId[];
}

describe("detectIssues — one rule at a time", () => {
  const cases: Array<[string, Parameters<typeof catalogProduct>[0], IssueId]> = [
    ["blank name", { name: "" }, "missing_name"],
    ["one-character name", { name: "أ" }, "short_name"],
    ["no description", { description: null }, "missing_description"],
    ["short description", { description: "وصف قصير" }, "short_description"],
    ["no metadata title", { metadataTitle: null }, "missing_metadata_title"],
    ["no metadata description", { metadataDescription: null }, "missing_metadata_description"],
    ["no image", { imageUrl: null }, "missing_image"],
    ["broken image URL", { imageUrl: "image.jpg" }, "invalid_image_url"],
    ["no SKU", { sku: null }, "missing_sku"],
    ["no URL", { url: null }, "missing_url"],
    ["no category", { categories: [] }, "missing_category"],
    [
      "hidden category",
      { categories: [{ id: "cat_1", name: "قمصان", status: "hidden" }] },
      "hidden_category_link",
    ],
    ["hidden product", { status: "hidden" }, "hidden_product"],
    [
      "stale content",
      {
        sourceUpdatedAt: new Date(
          NOW.getTime() - (PRODUCT_THRESHOLDS.STALE_CONTENT_DAYS + 1) * 86_400_000,
        ).toISOString(),
      },
      "stale_content",
    ],
    ["no price", { priceAmount: null }, "missing_price"],
    ["zero price", { priceAmount: "0.00" }, "non_positive_price"],
    ["negative price", { priceAmount: "-5.00" }, "non_positive_price"],
    ["no currency", { currency: null }, "missing_currency"],
    ["out of stock", { inventory: inventoryState({ quantity: 0 }) }, "out_of_stock"],
  ];

  for (const [label, overrides, expected] of cases) {
    it(`fires ${expected} for ${label}`, () => {
      expect(issuesOf(overrides)).toContain(expected);
    });
  }

  it("fires nothing for a healthy product", () => {
    expect(issuesOf({})).toEqual([]);
  });

  it("distinguishes a missing description from a short one, never both", () => {
    const missing = issuesOf({ description: null });
    expect(missing).toContain("missing_description");
    expect(missing).not.toContain("short_description");

    const short = issuesOf({ description: "قصير" });
    expect(short).toContain("short_description");
    expect(short).not.toContain("missing_description");
  });

  it("treats an unlimited out-of-stock-looking product as available", () => {
    expect(
      issuesOf({ inventory: inventoryState({ quantity: 0, unlimitedQuantity: true }) }),
    ).not.toContain("out_of_stock");
  });

  it("reports a bare product with every identity and content gap it really has", () => {
    const issues = analyseProduct(bareProduct(), NOW).issues as readonly IssueId[];

    expect(issues).toEqual(
      expect.arrayContaining([
        "missing_description",
        "missing_metadata_title",
        "missing_metadata_description",
        "missing_image",
        "missing_sku",
        "missing_url",
        "missing_category",
        "missing_price",
        "missing_currency",
      ]),
    );
    expect(issues).not.toContain("missing_name");
  });

  it("gives every issue a rule and a fixed severity", () => {
    for (const id of ISSUE_IDS) {
      const definition = ISSUE_DEFINITIONS[id];
      expect(definition.id).toBe(id);
      expect(definition.rule.length).toBeGreaterThan(0);
      expect(definition.definition.length).toBeGreaterThan(0);
      expect(["high", "medium", "low"]).toContain(definition.severity);
    }
  });
});

describe("needsAttention", () => {
  it("puts a high or medium issue in the work queue", () => {
    expect(analyseProduct(catalogProduct({ description: null }), NOW).needsAttention).toBe(true);
  });

  it("leaves a product whose only finding is low out of the queue", () => {
    const product = analyseProduct(catalogProduct({ status: "hidden" }), NOW);

    expect(product.issues).toEqual(["hidden_product"]);
    expect(product.severity).toBe("low");
    expect(product.needsAttention).toBe(false);
  });
});

function analysis(id: string, issues: readonly IssueId[], name = id): ProductAnalysis {
  const product = analyseProduct(catalogProduct({ id, name }), NOW);
  return { ...product, issues };
}

describe("summariseIssues — ranking", () => {
  it("scores every issue as affected count × severity weight", () => {
    const rows = summariseIssues(
      [
        analysis("a", ["missing_name"]),
        analysis("b", ["missing_name"]),
        analysis("c", ["missing_sku"]),
      ],
      3,
    );

    const byId = new Map(rows.map((row) => [row.id, row]));
    expect(byId.get("missing_name")?.score ?? -1).toBe(2 * PRODUCT_THRESHOLDS.SEVERITY_WEIGHT.high);
    expect(byId.get("missing_sku")?.score ?? -1).toBe(
      1 * PRODUCT_THRESHOLDS.SEVERITY_WEIGHT.medium,
    );
  });

  it("sorts by score, then severity, then affected count, then id", () => {
    const rows = summariseIssues(
      [
        analysis("a", ["missing_name", "missing_sku"]),
        analysis("b", ["missing_name", "hidden_product"]),
        analysis("c", ["hidden_product"]),
      ],
      3,
    );

    expect(rows.map((row) => row.id)).toEqual(["missing_name", "missing_sku", "hidden_product"]);
  });

  it("is deterministic regardless of the order products arrive in", () => {
    const products = [
      analysis("a", ["missing_image", "missing_sku"]),
      analysis("b", ["missing_sku", "missing_category"]),
      analysis("c", ["missing_image"]),
      analysis("d", ["missing_url", "missing_sku"]),
    ];

    const first = summariseIssues(products, 4).map((row) => row.id);
    const second = summariseIssues([...products].reverse(), 4).map((row) => row.id);

    expect(first).toEqual(second);
  });

  it("omits rules that never fired", () => {
    const rows = summariseIssues([analysis("a", ["missing_sku"])], 1);

    expect(rows).toHaveLength(1);
    expect(rows[0]?.id).toBe("missing_sku");
  });

  it("carries up to three example products and the computed percentage", () => {
    const rows = summariseIssues(
      [analysis("a", ["missing_sku"], "أ"), analysis("b", ["missing_sku"], "ب")],
      4,
    );

    expect(rows[0]?.affectedCount).toBe(2);
    expect(rows[0]?.affectedPercent).toBe(50);
    expect(rows[0]?.evidence).toEqual(["أ", "ب"]);
  });

  it("returns nothing for an empty catalogue", () => {
    expect(summariseIssues([], 0)).toEqual([]);
  });
});
