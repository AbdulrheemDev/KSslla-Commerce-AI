import { z } from "zod";

import { AppError } from "@/lib/errors";

/**
 * Query-string validation for the sales-intelligence routes.
 *
 * Period syntax stays in the Phase 07 parser (`resolvePeriod`), which already
 * returns a 422 with a stable reason code. Only the phase-specific knobs are
 * validated here: chart granularity and the export dataset.
 */

const granularitySchema = z.enum(["day", "week", "month"]);

const datasetSchema = z.enum(["summary", "trends", "anomalies"]);

export const DEFAULT_GRANULARITY = "day" as const;

export const DEFAULT_DATASET = "summary" as const;

export function granularityFromSearch(search: URLSearchParams) {
  const raw = search.get("granularity");
  if (raw === null) return DEFAULT_GRANULARITY;

  const parsed = granularitySchema.safeParse(raw);
  if (!parsed.success) {
    throw new AppError({
      code: "VALIDATION_FAILED",
      message: "The requested granularity is not supported.",
      details: { field: "granularity" },
    });
  }

  return parsed.data;
}

export function datasetFromSearch(search: URLSearchParams) {
  const raw = search.get("dataset");
  if (raw === null) return DEFAULT_DATASET;

  const parsed = datasetSchema.safeParse(raw);
  if (!parsed.success) {
    throw new AppError({
      code: "VALIDATION_FAILED",
      message: "The requested export dataset is not supported.",
      details: { field: "dataset" },
    });
  }

  return parsed.data;
}
