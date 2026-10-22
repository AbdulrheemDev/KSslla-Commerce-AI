import type { SallaCategoryDto, SallaProductDto } from "@/modules/catalog/domain/dto";
import type { CatalogCategoryInput, CatalogProductInput } from "@/modules/catalog/domain/types";

/**
 * DTO → domain mapping.
 *
 * Mapping is total: a malformed optional field becomes `null` rather than a
 * guessed value. Money is converted to an exact 2-decimal string so no float
 * rounding is introduced between the provider and the `numeric` column.
 */

export function toMoneyString(value: number | string | null | undefined): string | null {
  if (value === null || value === undefined || value === "") return null;

  const parsed = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(parsed)) return null;

  return parsed.toFixed(2);
}

export function toInteger(value: number | string | null | undefined): number | null {
  if (value === null || value === undefined || value === "") return null;

  const parsed = typeof value === "number" ? value : Number.parseInt(value, 10);
  if (!Number.isFinite(parsed)) return null;

  return Math.trunc(parsed);
}

const NAIVE_TIMESTAMP = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2}):(\d{2})$/;

/**
 * Parses the two documented timestamp shapes.
 *
 * Salla does not document the timezone of the naive `YYYY-MM-DD HH:mm:ss`
 * value. It is parsed as UTC to keep the result deterministic across machines;
 * it is used for change detection only and is never presented as an exact
 * instant. An unparseable value yields `null` (never `Invalid Date`).
 */
export function parseSallaTimestamp(value: unknown): Date | null {
  if (value === null || value === undefined) return null;

  const raw =
    typeof value === "object" && value !== null && "date" in value
      ? String((value as { date: unknown }).date)
      : typeof value === "string"
        ? value
        : null;

  if (!raw) return null;

  const match = NAIVE_TIMESTAMP.exec(raw.trim());
  if (match) {
    const [, year, month, day, hour, minute, second] = match;
    const date = new Date(
      Date.UTC(
        Number(year),
        Number(month) - 1,
        Number(day),
        Number(hour),
        Number(minute),
        Number(second),
      ),
    );
    return Number.isNaN(date.getTime()) ? null : date;
  }

  const parsed = new Date(raw);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function trimmedOrNull(value: string | null | undefined): string | null {
  if (value === null || value === undefined) return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function compact(record: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(record).filter(([, value]) => value !== undefined && value !== null),
  );
}

export function mapProduct(dto: SallaProductDto): CatalogProductInput {
  return {
    externalId: dto.id,
    name: dto.name.trim(),
    sku: trimmedOrNull(dto.sku),
    productType: trimmedOrNull(dto.type),
    status: dto.status,
    priceAmount: toMoneyString(dto.price?.amount),
    currency: trimmedOrNull(dto.price?.currency),
    regularPriceAmount: toMoneyString(dto.regular_price?.amount),
    salePriceAmount: toMoneyString(dto.sale_price?.amount),
    quantity: toInteger(dto.quantity),
    isAvailable: dto.is_available === true,
    url: trimmedOrNull(dto.url),
    imageUrl: trimmedOrNull(dto.main_image ?? dto.thumbnail),
    description: trimmedOrNull(dto.description),
    brandName: trimmedOrNull(dto.brand?.name),
    sourceUpdatedAt: parseSallaTimestamp(dto.updated_at),
    metadata: compact({
      urls: dto.urls,
      sallaMetadata: dto.metadata,
      brandId: dto.brand?.id,
    }),
    categoryExternalIds: [
      ...new Set((dto.categories ?? []).map((category) => category.id).filter(Boolean)),
    ],
  };
}

export function mapCategory(dto: SallaCategoryDto): CatalogCategoryInput {
  const parent =
    dto.parent_id === null || dto.parent_id === undefined ? null : String(dto.parent_id);

  return {
    externalId: dto.id,
    name: dto.name.trim(),
    // Salla documents root categories as `parent_id: 0`.
    parentExternalId: parent === null || parent === "" || parent === "0" ? null : parent,
    status: dto.status,
    sortOrder: toInteger(dto.sort_order),
    imageUrl: trimmedOrNull(dto.image),
    sourceUpdatedAt: parseSallaTimestamp(dto.update_at),
    metadata: compact({
      urls: dto.urls,
      sallaMetadata: dto.metadata,
      showIn: dto.show_in,
    }),
  };
}
