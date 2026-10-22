import type {
  InventoryCategoryRef,
  InventoryIssueSummary,
  InventoryProductInput,
  InventoryStockState,
  UnlinkedInventoryEntry,
} from "@/modules/inventory-intelligence/domain/types";
import { analyseInventoryProduct } from "@/modules/inventory-intelligence/domain/products";

/**
 * Inventory fixtures for the unit tests.
 *
 * The default product is deliberately healthy — one linked row, 12 units, no
 * issue — so every test states one gap in its overrides and the assertion can
 * only fail because of that gap. Names and SKUs are synthetic; nothing here
 * mirrors production data.
 */

export const SYNCED_AT = "2026-10-21T09:00:00.000Z";

export const CATEGORY: InventoryCategoryRef = {
  id: "cat_1",
  name: "قمصان",
  status: "sale",
};

export function stockState(overrides: Partial<InventoryStockState> = {}): InventoryStockState {
  return {
    quantity: 12,
    soldQuantity: 4,
    unlimitedQuantity: false,
    entries: 1,
    variants: [],
    lastSyncedAt: SYNCED_AT,
    ...overrides,
  };
}

export function inventoryProduct(
  overrides: Partial<InventoryProductInput> = {},
): InventoryProductInput {
  return {
    id: "prod_1",
    name: "قميص قطني كلاسيكي",
    sku: "SKU-1",
    productStatus: "sale",
    categories: [CATEGORY],
    stock: stockState(),
    ...overrides,
  };
}

/** A catalogued product with no linked inventory row at all. */
export function stocklessProduct(
  overrides: Partial<InventoryProductInput> = {},
): InventoryProductInput {
  return inventoryProduct({
    id: "prod_missing",
    name: "منتج بلا سجل مخزون",
    sku: "SKU-MISSING",
    categories: [],
    stock: null,
    ...overrides,
  });
}

export function productWithQuantity(
  quantity: number,
  overrides: Partial<InventoryStockState> = {},
): InventoryProductInput {
  return inventoryProduct({ stock: stockState({ quantity, ...overrides }) });
}

export function analysisOf(
  product: InventoryProductInput,
): ReturnType<typeof analyseInventoryProduct> {
  return analyseInventoryProduct(product);
}

export function unlinkedEntry(
  overrides: Partial<UnlinkedInventoryEntry> = {},
): UnlinkedInventoryEntry {
  return {
    quantity: 3,
    soldQuantity: 0,
    unlimitedQuantity: false,
    productName: "منتج غير مرتبط",
    externalProductId: "ext-9",
    lastSyncedAt: SYNCED_AT,
    ...overrides,
  };
}

export function issueSummary(
  overrides: Partial<InventoryIssueSummary> = {},
): InventoryIssueSummary {
  return {
    id: "out_of_stock",
    category: "availability",
    severity: "high",
    population: "products",
    affectedCount: 2,
    affectedPercent: 20,
    score: 6,
    rule: "quantity <= 0 AND unlimited_quantity = false",
    definition: "الكمية الحالية صفر أو أقل والمنتج ليس بكمية غير محدودة.",
    evidence: ["سماعة", "شاحن"],
    ...overrides,
  };
}
