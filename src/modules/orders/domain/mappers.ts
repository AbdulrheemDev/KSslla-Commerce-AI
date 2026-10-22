import { toInteger, toMoneyString, parseSallaTimestamp } from "@/modules/catalog/domain/mappers";
import { mapCustomer } from "@/modules/customers/domain/mappers";
import type { SallaOrderDto } from "@/modules/orders/domain/dto";
import type { OrderInput, OrderItemInput } from "@/modules/orders/domain/types";

/**
 * Order DTO → domain mapping.
 *
 * `date.date` is a **local wall-clock** value (`2026-10-20 14:33:00.000000`)
 * plus a documented IANA timezone. It is parsed as if it were UTC so the same
 * payload always produces the same stored value on every machine, and the
 * timezone name is stored beside it. Nothing here claims the value is UTC, and
 * the UI reads it back with UTC getters so the merchant sees the wall clock
 * Salla sent.
 */

function cleanText(value: string | number | null | undefined): string | null {
  if (value === null || value === undefined) return null;
  const trimmed = String(value).trim();
  return trimmed.length > 0 ? trimmed : null;
}

function orderDateValue(value: SallaOrderDto["date"]): {
  date: Date | null;
  timezone: string | null;
} {
  if (value === null || value === undefined) return { date: null, timezone: null };
  if (typeof value === "string") return { date: parseSallaTimestamp(value), timezone: null };

  return {
    date: parseSallaTimestamp({ date: value.date }),
    timezone: cleanText(value.timezone),
  };
}

/**
 * Maps one documented line.
 *
 * Only `name`, `quantity`, and `thumbnail` are documented for a list line, so
 * a line can never be linked to a product here. The status says exactly that
 * instead of pretending the line is linked or dropping it.
 */
export function mapOrderItem(
  raw: NonNullable<SallaOrderDto["items"]>[number],
  index: number,
): OrderItemInput {
  return {
    lineNumber: index + 1,
    externalProductId: null,
    externalSkuId: null,
    productName: cleanText(raw.name) ?? "—",
    sku: null,
    quantity: toInteger(raw.quantity) ?? 0,
    unitPrice: null,
    totalPrice: null,
    thumbnailUrl: cleanText(raw.thumbnail),
    linkStatus: "no_product_reference",
  };
}

/**
 * Keys kept in `orders.raw_payload`.
 *
 * Allowlist, never denylist: a provider field added tomorrow cannot leak into
 * the column by accident. Excluded on purpose — `customer` (phone, e-mail,
 * address), `urls` (signed customer links), `notes`, `bank` (IBAN),
 * `payment_actions`, `source_details`, `features`, `payment_methods`.
 */
const RAW_PAYLOAD_KEYS = [
  "id",
  "external_reference_id",
  "reference_id",
  "total",
  "date",
  "source",
  "status",
  "draft",
  "payment_method",
  "is_pending_payment",
  "items",
] as const;

/**
 * Builds the stored snapshot.
 *
 * `status` keeps `{id, name, slug}` and `items` keeps `{name, quantity,
 * thumbnail}` — the documented shapes — so the snapshot cannot smuggle extra
 * keys that the provider happened to attach.
 */
export function buildRawPayload(dto: SallaOrderDto): Record<string, unknown> | null {
  const source = dto as unknown as Record<string, unknown>;
  const payload: Record<string, unknown> = {};

  for (const key of RAW_PAYLOAD_KEYS) {
    const value = source[key];
    if (value === undefined) continue;
    payload[key] = value;
  }

  if (dto.status && typeof dto.status === "object") {
    payload.status = {
      id: dto.status.id ?? null,
      name: dto.status.name ?? null,
      slug: dto.status.slug ?? null,
    };
  }

  payload.items = (dto.items ?? []).map((line) => ({
    name: line.name ?? null,
    quantity: line.quantity ?? null,
    thumbnail: line.thumbnail ?? null,
  }));

  return Object.keys(payload).length > 0 ? payload : null;
}

export function mapOrder(dto: SallaOrderDto): OrderInput {
  const { date, timezone } = orderDateValue(dto.date);
  const customer = dto.customer ? mapCustomer(dto.customer) : null;

  return {
    externalOrderId: dto.id,
    externalReferenceId: cleanText(dto.external_reference_id),
    referenceId: cleanText(dto.reference_id),
    statusId: cleanText(dto.status?.id),
    statusName: cleanText(dto.status?.name),
    statusSlug: cleanText(dto.status?.slug),
    source: cleanText(dto.source),
    totalAmount: toMoneyString(dto.total?.amount),
    currency: cleanText(dto.total?.currency)?.toUpperCase() ?? null,
    paymentMethod: cleanText(dto.payment_method),
    isPendingPayment: dto.is_pending_payment === true,
    draft: dto.draft === true,
    orderDate: date,
    orderTimezone: timezone,
    customerExternalId: customer?.externalCustomerId ?? null,
    customer,
    items: (dto.items ?? []).map(mapOrderItem),
    rawPayload: buildRawPayload(dto),
  };
}

/**
 * Formats the stored wall-clock value for display without a timezone shift.
 *
 * The stored timestamp is the merchant-local wall clock; rendering it with
 * UTC getters reproduces exactly what Salla reported.
 */
export function formatOrderWallClock(value: Date | string | null): string | null {
  if (!value) return null;
  const date = typeof value === "string" ? new Date(value) : value;
  if (Number.isNaN(date.getTime())) return null;

  const pad = (n: number) => String(n).padStart(2, "0");
  return (
    `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())}` +
    ` ${pad(date.getUTCHours())}:${pad(date.getUTCMinutes())}`
  );
}
