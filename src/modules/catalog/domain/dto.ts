import { z } from "zod";

/**
 * Provider DTO schemas.
 *
 * These mirror the documented List Products and List Categories responses
 * (docs/salla-reference.md §2.2–2.3), not the database. Validation is strict
 * about the fields this phase reads and permissive about the rest: unknown keys
 * are dropped by Zod, and missing optional keys become `null` in the mapper.
 *
 * Anything that fails here is a provider contract change, not user input.
 */

const numericId = z
  .union([z.string(), z.number()])
  .transform((value) => String(value))
  .refine((value) => value.length > 0, "id must not be empty");

/** Salla returns `amount` as a number or a string; `sale_price` may be `{}`. */
const money = z
  .object({
    amount: z.union([z.number(), z.string()]).nullish(),
    currency: z.string().nullish(),
  })
  .nullish();

/**
 * Timestamps are documented as `YYYY-MM-DD HH:mm:ss` strings. An embedded
 * category object may instead carry `{date, timezone_type, timezone}`.
 * Timezone semantics are not documented; see salla-reference §9.3.
 */
const timestamp = z.union([z.string(), z.object({ date: z.string() }).loose()]).nullish();

const count = z.union([z.number(), z.string()]).nullish();

const displayName = z
  .string()
  .min(1)
  .refine((value) => value.trim().length > 0, "name must not be blank");

export const sallaPaginationSchema = z.object({
  count: z.coerce.number().optional(),
  total: z.coerce.number().optional(),
  perPage: z.coerce.number().optional(),
  currentPage: z.coerce.number(),
  totalPages: z.coerce.number(),
});

export const sallaProductDtoSchema = z.object({
  id: numericId,
  name: displayName,
  sku: z.string().nullish(),
  type: z.string().nullish(),
  status: z.string().min(1),
  description: z.string().nullish(),
  url: z.string().nullish(),
  thumbnail: z.string().nullish(),
  main_image: z.string().nullish(),
  price: money,
  regular_price: money,
  sale_price: money,
  quantity: count,
  is_available: z.boolean().nullish(),
  updated_at: timestamp,
  categories: z.array(z.object({ id: numericId }).loose()).nullish(),
  brand: z
    .object({
      id: numericId.optional(),
      name: z.string().nullish(),
    })
    .nullish(),
  urls: z.record(z.string(), z.unknown()).nullish(),
  metadata: z.record(z.string(), z.unknown()).nullish(),
});

export const sallaCategoryDtoSchema = z.object({
  id: numericId,
  name: displayName,
  parent_id: z.union([z.string(), z.number()]).nullish(),
  status: z.string().min(1),
  sort_order: z.union([z.number(), z.string()]).nullish(),
  image: z.string().nullish(),
  update_at: timestamp,
  urls: z.record(z.string(), z.unknown()).nullish(),
  metadata: z.record(z.string(), z.unknown()).nullish(),
  show_in: z.record(z.string(), z.unknown()).nullish(),
});

export function listEnvelopeSchema<T extends z.ZodTypeAny>(item: T) {
  return z.object({
    status: z.number().optional(),
    success: z.boolean().optional(),
    data: z.array(item),
    pagination: sallaPaginationSchema,
  });
}

export const sallaProductListSchema = listEnvelopeSchema(sallaProductDtoSchema);
export const sallaCategoryListSchema = listEnvelopeSchema(sallaCategoryDtoSchema);

export type SallaProductDto = z.infer<typeof sallaProductDtoSchema>;
export type SallaCategoryDto = z.infer<typeof sallaCategoryDtoSchema>;
export type SallaPaginationDto = z.infer<typeof sallaPaginationSchema>;
