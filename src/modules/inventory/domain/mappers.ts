import { toInteger, toMoneyString } from "@/modules/catalog/domain/mappers";
import type { SallaQuantityDto } from "@/modules/inventory/domain/dto";
import type { InventoryItemInput } from "@/modules/inventory/domain/types";

/**
 * Quantity DTO → domain mapping.
 *
 * Two documented details drive this:
 * - a product with variants appears once per `sku_id`, so the row key must
 *   include `sku_id`; using the product id alone would collapse variants;
 * - `price` is a number in one sample and a string in another, so it is routed
 *   through the shared money normaliser to an exact 2-decimal string.
 */

function cleanText(value: string | null | undefined): string | null {
  if (value === null || value === undefined) return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

export function quantityKeyFor(item: { id: string; skuId: string | null }): string {
  return item.skuId ? `sku:${item.skuId}` : `product:${item.id}`;
}

export function mapQuantity(dto: SallaQuantityDto): InventoryItemInput {
  const externalSkuId = cleanText(dto.sku_id);

  return {
    quantityKey: quantityKeyFor({ id: dto.id, skuId: externalSkuId }),
    externalProductId: dto.id,
    externalSkuId,
    productName: cleanText(dto.name) ?? "—",
    sku: cleanText(dto.sku),
    variant: cleanText(dto.variant),
    imageUrl: cleanText(dto.image),
    quantity: toInteger(dto.quantity) ?? 0,
    soldQuantity: toInteger(dto.sold_quantity) ?? 0,
    unlimitedQuantity: dto.unlimited_quantity === true,
    priceAmount: toMoneyString(dto.price),
  };
}
