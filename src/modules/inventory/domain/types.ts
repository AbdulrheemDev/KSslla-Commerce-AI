/**
 * Inventory domain types.
 *
 * `quantityKey` is the local identity of a quantity row, derived from the only
 * stable fields the provider documents:
 *
 *   sku_id ? `sku:<sku_id>` : `product:<id>`
 */

export interface InventoryItemInput {
  quantityKey: string;
  externalProductId: string;
  externalSkuId: string | null;
  productName: string;
  sku: string | null;
  variant: string | null;
  imageUrl: string | null;
  quantity: number;
  soldQuantity: number;
  unlimitedQuantity: boolean;
  priceAmount: string | null;
}

export interface PersistedInventoryLevel {
  id: string;
  quantityKey: string;
  externalProductId: string;
  externalSkuId: string | null;
  productId: string | null;
  productName: string;
  sku: string | null;
  variant: string | null;
  quantity: number;
  soldQuantity: number;
  unlimitedQuantity: boolean;
  priceAmount: string | null;
  lastSyncedAt: string;
}

export interface InventoryPageResult {
  items: PersistedInventoryLevel[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

export interface InventorySummary {
  products: number;
  totalQuantity: number;
  unlimited: number;
  outOfStock: number;
  lastSyncedAt: string | null;
}
