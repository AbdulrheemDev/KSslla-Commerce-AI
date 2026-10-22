import { z } from "zod";

import { AppError } from "@/lib/errors";

/**
 * Query validation for the inventory-intelligence routes.
 *
 * There is no `period` and no `asOf` parameter. `inventory_levels` holds the
 * current quantity per provider entry (ADR-043) and nothing else, so a date range
 * would be a filter over data that does not exist — it would silently return the
 * same numbers for every window. Paging, name/SKU search, and a status filter are
 * the only real knobs.
 */

export const DEFAULT_PAGE_SIZE = 25;
export const MAX_PAGE_SIZE = 100;

export const INVENTORY_FILTERS = [
  "all",
  "out_of_stock",
  "low_stock",
  "in_stock",
  "unlimited",
  "unknown",
  "high_quantity",
] as const;

const inventoryFilterSchema = z.enum(INVENTORY_FILTERS);

export type InventoryFilter = z.infer<typeof inventoryFilterSchema>;

export interface InventoryQuery {
  readonly page: number;
  readonly pageSize: number;
  readonly query: string;
  readonly filter: InventoryFilter;
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

export function inventoryQueryFromSearch(search: URLSearchParams): InventoryQuery {
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
  let filter: InventoryFilter = "all";

  if (rawFilter !== null) {
    const parsed = inventoryFilterSchema.safeParse(rawFilter);
    if (!parsed.success) invalid("filter", `expected one of: ${INVENTORY_FILTERS.join(", ")}`);
    filter = parsed.data;
  }

  return { page, pageSize, query, filter };
}
