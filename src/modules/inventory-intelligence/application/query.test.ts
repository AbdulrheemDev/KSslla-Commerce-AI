import { describe, expect, it } from "vitest";

import { DEFAULT_PAGE_SIZE, inventoryQueryFromSearch, MAX_PAGE_SIZE } from "./query";

/**
 * Query parsing. The defaults matter: an unparameterised request must return the
 * first page of the unfiltered catalogue, never a partial or filtered view.
 */
describe("inventory query parsing", () => {
  it("defaults to page 1, 25 per page, no search, no filter", () => {
    expect(inventoryQueryFromSearch(new URLSearchParams())).toEqual({
      page: 1,
      pageSize: DEFAULT_PAGE_SIZE,
      query: "",
      filter: "all",
    });
  });

  it("trims the search term and keeps an empty one empty", () => {
    expect(inventoryQueryFromSearch(new URLSearchParams("q=  شاحن  ")).query).toBe("شاحن");
    expect(inventoryQueryFromSearch(new URLSearchParams("q=   ")).query).toBe("");
  });

  it("accepts every declared filter", () => {
    for (const filter of [
      "all",
      "out_of_stock",
      "low_stock",
      "in_stock",
      "unlimited",
      "unknown",
      "high_quantity",
    ]) {
      expect(inventoryQueryFromSearch(new URLSearchParams(`filter=${filter}`)).filter).toBe(filter);
    }
  });

  it("rejects an unknown filter with a 422-shaped error", () => {
    expect(() => inventoryQueryFromSearch(new URLSearchParams("filter=sold_out"))).toThrowError(
      expect.objectContaining({ code: "VALIDATION_FAILED", httpStatus: 422 }),
    );
  });

  it("rejects non-integer and out-of-range paging", () => {
    for (const search of [
      "page=0",
      "page=-1",
      "page=1.5",
      "page=10001",
      `pageSize=${MAX_PAGE_SIZE + 1}`,
    ]) {
      expect(() => inventoryQueryFromSearch(new URLSearchParams(search))).toThrowError(
        expect.objectContaining({ code: "VALIDATION_FAILED" }),
      );
    }
  });

  it("rejects an over-long search term", () => {
    expect(() =>
      inventoryQueryFromSearch(new URLSearchParams(`q=${"ا".repeat(121)}`)),
    ).toThrowError(expect.objectContaining({ code: "VALIDATION_FAILED" }));
  });

  it("has no period or as-of parameter, because the mirror has no history", () => {
    const parsed = inventoryQueryFromSearch(
      new URLSearchParams("from=2026-01-01&to=2026-02-01&asOf=2026-03-01"),
    );

    expect(parsed).toEqual({
      page: 1,
      pageSize: DEFAULT_PAGE_SIZE,
      query: "",
      filter: "all",
    });
  });
});
