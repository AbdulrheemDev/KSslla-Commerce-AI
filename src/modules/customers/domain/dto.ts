import { z } from "zod";

/**
 * Provider DTO schemas for customers.
 *
 * Mirrors the documented `GET /admin/v2/customers` response and the customer
 * object embedded in `GET /admin/v2/orders` (docs/salla-reference.md §12.3).
 * Only documented keys are read. Anything absent stays absent, and the mapper
 * turns it into `null` — no field is ever inferred from another.
 *
 * Documented quirks handled here:
 * - `mobile` is an **object** on orders (`{number, mobile_code}`) but a plain
 *   number/string on some customer payloads;
 * - `mobile_code` is written `"+966"` on orders and `"967"` on customers;
 * - `country_code` is `"SA"` on orders and `"sa"` on customer details;
 * - `birthday` is `{date, timezone_type, timezone}`;
 * - `updated_at` is `{date, ...}`; List Customers documents no `created_at`.
 */

/** Salla sends ids as numbers; a string is accepted and normalised to text. */
const numericId = z
  .union([z.string(), z.number()])
  .transform((value) => String(value))
  .refine((value) => value.length > 0, "id must not be empty");

const timestamp = z.union([z.string(), z.object({ date: z.string() }).loose()]).nullish();

const mobileObject = z
  .object({
    number: z.union([z.string(), z.number()]).nullish(),
    mobile_code: z.string().nullish(),
  })
  .loose();

const mobile = z.union([mobileObject, z.string(), z.number()]).nullish();

export const sallaCustomerDtoSchema = z
  .object({
    id: numericId,
    first_name: z.string().nullish(),
    last_name: z.string().nullish(),
    full_name: z.string().nullish(),
    mobile,
    mobile_code: z.string().nullish(),
    email: z.string().nullish(),
    gender: z.string().nullish(),
    birthday: timestamp,
    city: z.string().nullish(),
    country: z.string().nullish(),
    country_code: z.string().nullish(),
    currency: z.string().nullish(),
    lang: z.string().nullish(),
    type: z.string().nullish(),
    created_at: timestamp,
    updated_at: timestamp,
    groups: z.array(z.unknown()).nullish(),
  })
  .loose();

export type SallaCustomerDto = z.infer<typeof sallaCustomerDtoSchema>;

/** `perPage` on List Customers defaults to 15; it is documented as overridable. */
export const sallaCustomerListSchema = z
  .object({
    status: z.number().optional(),
    success: z.boolean().optional(),
    data: z.array(sallaCustomerDtoSchema),
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
