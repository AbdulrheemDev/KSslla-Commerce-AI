/**
 * Pagination policy.
 *
 * Salla documents a page/per_page model with `pagination.currentPage`,
 * `totalPages`, and a maximum `per_page` of 60 (docs.salla-reference §2.4).
 * Pages are requested sequentially: the provider documents sequential reads for
 * list endpoints, and parallel fan-out would multiply rate-limit pressure.
 *
 * The guards below make a broken provider response terminate the run instead
 * of looping: a repeated page, an empty page before the last page, a page
 * number that does not match what was requested, and an absolute page ceiling.
 */

/** Documented maximum is 60; 30 keeps each write transaction small. */
export const DEFAULT_PAGE_SIZE = 30;

/** Hard ceiling: 200 pages × 30 rows = 6,000 objects per run. */
export const MAX_PAGES_PER_SYNC = 200;

export interface PageMeta {
  currentPage: number;
  totalPages: number;
  perPage?: number;
  total?: number;
}

export type PageFailure = "out_of_order" | "repeat" | "empty" | "limit";

export interface PageDecision {
  nextPage: number | null;
  failure: PageFailure | null;
}

export function pageSignature(externalIds: readonly string[]): string {
  return externalIds.join("|");
}

export function decideNextPage(input: {
  requestedPage: number;
  meta: PageMeta;
  receivedIds: readonly string[];
  seenSignatures: ReadonlySet<string>;
  pagesProcessed: number;
}): PageDecision {
  const { requestedPage, meta, receivedIds, seenSignatures, pagesProcessed } = input;

  if (meta.currentPage !== requestedPage) {
    return { nextPage: null, failure: "out_of_order" };
  }

  if (receivedIds.length === 0 && requestedPage < Math.max(meta.totalPages, 1)) {
    return { nextPage: null, failure: "empty" };
  }

  if (receivedIds.length > 0 && seenSignatures.has(pageSignature(receivedIds))) {
    return { nextPage: null, failure: "repeat" };
  }

  if (pagesProcessed >= MAX_PAGES_PER_SYNC) {
    return { nextPage: null, failure: "limit" };
  }

  if (requestedPage >= Math.max(meta.totalPages, 1)) {
    return { nextPage: null, failure: null };
  }

  return { nextPage: requestedPage + 1, failure: null };
}
