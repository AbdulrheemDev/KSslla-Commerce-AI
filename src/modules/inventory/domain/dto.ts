import { z } from "zod";

/**
 * Provider DTO schema for product quantities.
 *
 * Mirrors the documented `GET /admin/v2/products/quantities` response
 * (docs/salla-reference.md §12.4). Documented quirks:
 * - `price` is a number in one sample and a string in the next;
 * - `sku_id` is `null` for a product without variants, and the same product
 *   `id` repeats once per variant;
 * - `quantity` / `sold_quantity` are integers;
 * - the endpoint **is** paginated (15 per page by default, `pagination` block),
 *   so `page` / `per_page` are used exactly like every other list endpoint.
 */

const numericId = z
  .union([z.string(), z.number()])
  .transform((value) => String(value))
  .refine((value) => value.length > 0, "id must not be empty");

const optionalId = z
  .union([z.string(), z.number()])
  .nullish()
  .transform((value) => (value === null || value === undefined ? null : String(value)));

export const sallaQuantityDtoSchema = z
  .object({
    id: numericId,
    name: z.string().nullish(),
    image: z.string().nullish(),
    sku_id: optionalId,
    sku: z.string().nullish(),
    quantity: z.union([z.number(), z.string()]).nullish(),
    sold_quantity: z.union([z.number(), z.string()]).nullish(),
    price: z.union([z.number(), z.string()]).nullish(),
    unlimited_quantity: z.boolean().nullish(),
    variant: z.string().nullish(),
  })
  .loose();

export type SallaQuantityDto = z.infer<typeof sallaQuantityDtoSchema>;

export const sallaQuantityListSchema = z
  .object({
    status: z.number().optional(),
    success: z.boolean().optional(),
    data: z.array(sallaQuantityDtoSchema),
    pagination: z
      .object({
        count: z.coerce.number().optional(),
        total: z.coerce.number().optional(),
        perPage: z.coerce.number().optional(),
        currentPage: z.coerce.number(),
        totalPages: z.coerce.number(),
      })
      .loose(),
  })
  .loose();
