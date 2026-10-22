import { describe, expect, it } from "vitest";

import {
  MAX_PAGES_PER_SYNC,
  decideNextPage,
  pageSignature,
} from "@/modules/catalog/domain/pagination";

const meta = (currentPage: number, totalPages: number) => ({
  currentPage,
  totalPages,
  perPage: 30,
  total: totalPages * 30,
});

describe("pagination decisions", () => {
  it("advances while more pages remain", () => {
    const decision = decideNextPage({
      requestedPage: 1,
      meta: meta(1, 4),
      receivedIds: ["a", "b"],
      seenSignatures: new Set(),
      pagesProcessed: 1,
    });

    expect(decision).toEqual({ nextPage: 2, failure: null });
  });

  it("stops after the last page", () => {
    const decision = decideNextPage({
      requestedPage: 4,
      meta: meta(4, 4),
      receivedIds: ["z"],
      seenSignatures: new Set(),
      pagesProcessed: 4,
    });

    expect(decision).toEqual({ nextPage: null, failure: null });
  });

  it("treats totalPages 0 as a single empty page", () => {
    const decision = decideNextPage({
      requestedPage: 1,
      meta: meta(1, 0),
      receivedIds: [],
      seenSignatures: new Set(),
      pagesProcessed: 1,
    });

    expect(decision).toEqual({ nextPage: null, failure: null });
  });

  it("fails when the provider returns an empty page before the last page", () => {
    const decision = decideNextPage({
      requestedPage: 2,
      meta: meta(2, 5),
      receivedIds: [],
      seenSignatures: new Set(),
      pagesProcessed: 2,
    });

    expect(decision.failure).toBe("empty");
  });

  it("fails when the provider repeats the same page", () => {
    const ids = ["product-1", "product-2"];
    const decision = decideNextPage({
      requestedPage: 3,
      meta: meta(3, 9),
      receivedIds: ids,
      seenSignatures: new Set([pageSignature(ids)]),
      pagesProcessed: 3,
    });

    expect(decision.failure).toBe("repeat");
  });

  it("fails when the provider reports a different page than requested", () => {
    const decision = decideNextPage({
      requestedPage: 2,
      meta: meta(1, 5),
      receivedIds: ["a"],
      seenSignatures: new Set(),
      pagesProcessed: 2,
    });

    expect(decision.failure).toBe("out_of_order");
  });

  it("fails at the absolute page ceiling", () => {
    const decision = decideNextPage({
      requestedPage: 5,
      meta: meta(5, MAX_PAGES_PER_SYNC + 10),
      receivedIds: ["a"],
      seenSignatures: new Set(),
      pagesProcessed: MAX_PAGES_PER_SYNC,
    });

    expect(decision.failure).toBe("limit");
  });

  it("builds a stable signature for the same page content", () => {
    expect(pageSignature(["a", "b"])).toBe(pageSignature(["a", "b"]));
    expect(pageSignature(["a", "b"])).not.toBe(pageSignature(["b", "a"]));
  });
});
