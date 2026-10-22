import { z } from "zod";

import { AppError } from "@/lib/errors";

/**
 * Query validation for the product-intelligence routes.
 *
 * There is deliberately no `period` parameter: the catalogue is a current-state
 * mirror, not a time series, and inventing a window for it would imply that the
 * numbers change with it. The only knobs are paging, a name/SKU search, and the
 * attention filter.
 */

export const DEFAULT_PAGE_SIZE = 25;
export const MAX_PAGE_SIZE = 100;

const productFilterSchema = z.enum(["all", "attention", "clean"]);

export type ProductFilter = z.infer<typeof productFilterSchema>;

export interface CatalogQuery {
  readonly page: number;
  readonly pageSize: number;
  readonly query: string;
  readonly filter: ProductFilter;
}

function invalid(field: string, reason: string): never {
  throw new AppError({
    code: "VALIDATION_FAILED",
    message: "Invalid query parameter.",
    details: { field, reason },
  });
}

function parseInteger(
  raw: string | null,
  field: string,
  fallback: number,
  min: number,
  max: number,
): number {
  if (raw === null) return fallback;

  const parsed = z.coerce.number().int().min(min).max(max).safeParse(raw);
  if (!parsed.success) invalid(field, `expected an integer between ${min} and ${max}`);

  return parsed.data;
}

export function catalogQueryFromSearch(search: URLSearchParams): CatalogQuery {
  const page = parseInteger(search.get("page"), "page", 1, 1, 10_000);
  const pageSize = parseInteger(
    search.get("pageSize"),
    "pageSize",
    DEFAULT_PAGE_SIZE,
    1,
    MAX_PAGE_SIZE,
  );

  const rawQuery = search.get("q");
  const query = rawQuery === null ? "" : rawQuery.trim();
  if (query.length > 120) invalid("q", "expected at most 120 characters");

  const rawFilter = search.get("filter");
  let filter: ProductFilter = "all";

  if (rawFilter !== null) {
    const parsed = productFilterSchema.safeParse(rawFilter);
    if (!parsed.success) invalid("filter", "expected all, attention, or clean");
    filter = parsed.data;
  }

  return { page, pageSize, query, filter };
}
