import { describe, expect, it } from "vitest";

import {
  DEFAULT_PAGE_SIZE,
  MAX_PAGE_SIZE,
  catalogQueryFromSearch,
} from "@/modules/product-intelligence/application/query";
import { pageProducts } from "@/modules/product-intelligence/application/product-intelligence-service";
import { analyseProduct } from "@/modules/product-intelligence/domain/products";
import { NOW, catalogProduct } from "@/test/product-intelligence-fixtures";

function search(params: Record<string, string> = {}): URLSearchParams {
  return new URLSearchParams(params);
}

describe("catalogQueryFromSearch", () => {
  it("defaults to the first page with no search and no filter", () => {
    expect(catalogQueryFromSearch(search())).toEqual({
      page: 1,
      pageSize: DEFAULT_PAGE_SIZE,
      query: "",
      filter: "all",
    });
  });

  it("rejects a non-integer or out-of-range page", () => {
    for (const page of ["0", "-1", "1.5", "abc", "10001"]) {
      expect(() => catalogQueryFromSearch(search({ page }))).toThrow();
    }
  });

  it("rejects a page size above the ceiling", () => {
    expect(() => catalogQueryFromSearch(search({ pageSize: String(MAX_PAGE_SIZE + 1) }))).toThrow();
    expect(catalogQueryFromSearch(search({ pageSize: String(MAX_PAGE_SIZE) })).pageSize).toBe(
      MAX_PAGE_SIZE,
    );
  });

  it("rejects an unknown filter instead of silently ignoring it", () => {
    expect(() => catalogQueryFromSearch(search({ filter: "worst" }))).toThrow();
    expect(catalogQueryFromSearch(search({ filter: "attention" })).filter).toBe("attention");
  });

  it("rejects an over-long search term", () => {
    expect(() => catalogQueryFromSearch(search({ q: "ا".repeat(121) }))).toThrow();
  });

  it("trims the search term", () => {
    expect(catalogQueryFromSearch(search({ q: "  قميص  " })).query).toBe("قميص");
  });

  it("does not accept a period", () => {
    const query = catalogQueryFromSearch(search({ period: "last_30_days" }));
    expect(query).not.toHaveProperty("period");
  });
});

describe("pageProducts", () => {
  const products = [
    analyseProduct(catalogProduct({ id: "p1", name: "قميص" }), NOW),
    analyseProduct(catalogProduct({ id: "p2", name: "حذاء", sku: "SHOE-9" }), NOW),
    analyseProduct(
      catalogProduct({ id: "p3", name: "جاكيت", description: null, imageUrl: null }),
      NOW,
    ),
  ];

  const base = { page: 1, pageSize: 25, query: "", filter: "all" as const };

  it("sorts the worst products first", () => {
    expect(pageProducts(products, base).items.map((item) => item.id)[0]).toBe("p3");
  });

  it("filters by name and by SKU", () => {
    expect(pageProducts(products, { ...base, query: "قميص" }).items.map((i) => i.id)).toEqual([
      "p1",
    ]);
    expect(pageProducts(products, { ...base, query: "shoe-9" }).items.map((i) => i.id)).toEqual([
      "p2",
    ]);
  });

  it("filters attention versus clean using the same rule as the work queue", () => {
    expect(pageProducts(products, { ...base, filter: "attention" }).items.map((i) => i.id)).toEqual(
      ["p3"],
    );
    expect(pageProducts(products, { ...base, filter: "clean" }).total).toBe(2);
  });

  it("paginates and reports the totals", () => {
    const page = pageProducts(products, { ...base, pageSize: 2 });

    expect(page.total).toBe(3);
    expect(page.pageCount).toBe(2);
    expect(page.items).toHaveLength(2);
  });

  it("returns page zero for an empty result rather than an out-of-range page", () => {
    const page = pageProducts(products, { ...base, query: "لا يوجد" });

    expect(page).toMatchObject({ total: 0, page: 0, pageCount: 0, items: [] });
  });

  it("clamps a page beyond the end to the last page", () => {
    const page = pageProducts(products, { ...base, pageSize: 2, page: 9 });
    expect(page.page).toBe(2);
  });
});
