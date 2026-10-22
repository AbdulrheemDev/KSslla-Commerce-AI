import { z } from "zod";

import { sallaCustomerDtoSchema } from "@/modules/customers/domain/dto";

/**
 * Provider DTO schemas for orders.
 *
 * Mirrors the documented `GET /admin/v2/orders` response
 * (docs/salla-reference.md §12.1–12.2). Only documented keys are read.
 *
 * Documented limitation, not an oversight: an order line in the list payload
 * carries exactly `name`, `quantity`, and `thumbnail`. The expanded Order
 * Details response that used to expose product ids, SKUs, and line prices is
 * retired, so this schema deliberately has no `product_id`, `sku`, or
 * `price` on the item. See docs/phase-05.md §Limitations.
 *
 * `date` is a local wall-clock value plus an IANA timezone
 * (`{date: "2026-10-20 14:33:00.000000", timezone: "Asia/Riyadh"}`), so it is
 * never treated as UTC.
 */

const numericId = z
  .union([z.string(), z.number()])
  .transform((value) => String(value))
  .refine((value) => value.length > 0, "id must not be empty");

const money = z
  .object({
    amount: z.union([z.number(), z.string()]).nullish(),
    currency: z.string().nullish(),
  })
  .nullish();

const orderDate = z
  .union([z.string(), z.object({ date: z.string(), timezone: z.string().nullish() }).loose()])
  .nullish();

const status = z
  .object({
    id: z.union([z.string(), z.number()]).nullish(),
    name: z.string().nullish(),
    slug: z.string().nullish(),
  })
  .loose()
  .nullish();

const item = z
  .object({
    name: z.string().nullish(),
    quantity: z.union([z.number(), z.string()]).nullish(),
    thumbnail: z.string().nullish(),
  })
  .loose();

export const sallaOrderDtoSchema = z
  .object({
    id: numericId,
    external_reference_id: z.union([z.string(), z.number()]).nullish(),
    reference_id: z.union([z.string(), z.number()]).nullish(),
    total: money,
    date: orderDate,
    source: z.string().nullish(),
    status,
    draft: z.boolean().nullish(),
    payment_method: z.string().nullish(),
    is_pending_payment: z.boolean().nullish(),
    items: z.array(item).nullish(),
    customer: sallaCustomerDtoSchema.nullish(),
  })
  .loose();

export type SallaOrderDto = z.infer<typeof sallaOrderDtoSchema>;

export const sallaOrderListSchema = z
  .object({
    status: z.number().optional(),
    success: z.boolean().optional(),
    data: z.array(sallaOrderDtoSchema),
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
