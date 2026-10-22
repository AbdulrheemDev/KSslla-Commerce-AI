import type {
  CatalogInventoryState,
  CatalogProductInput,
} from "@/modules/product-intelligence/domain/types";

/**
 * Catalogue fixtures for the product-intelligence unit tests.
 *
 * The default product is deliberately *healthy* — every check passes — so each
 * test states one gap in its overrides and the assertion can only fail because
 * of that gap. Nothing here mirrors production data: the names and SKUs are
 * synthetic.
 */

export const NOW = new Date("2026-10-22T09:00:00.000Z");

export function inventoryState(
  overrides: Partial<CatalogInventoryState> = {},
): CatalogInventoryState {
  return {
    quantity: 12,
    soldQuantity: 4,
    unlimitedQuantity: false,
    entries: 1,
    lastSyncedAt: "2026-10-21T09:00:00.000Z",
    ...overrides,
  };
}

export function catalogProduct(overrides: Partial<CatalogProductInput> = {}): CatalogProductInput {
  return {
    id: "prod_1",
    name: "قميص قطني كلاسيكي",
    sku: "SKU-1",
    status: "sale",
    description:
      "قميص قطني كلاسيكي بقصة مستقيمة، مناسب للاستخدام اليومي، متوفر بعدة مقاسات وألوان هادئة. " +
      "الخامة قطنية 100% وقابلة للغسل في الغسالة، ويأتي المنتج بتغليف بسيط يصلح كهدية.",
    url: "https://example.test/products/cotton-shirt",
    imageUrl: "https://cdn.example.test/products/cotton-shirt.jpg",
    priceAmount: "149.00",
    currency: "SAR",
    quantity: 12,
    isAvailable: true,
    sourceUpdatedAt: "2026-10-20T09:00:00.000Z",
    lastSeenAt: "2026-10-21T09:00:00.000Z",
    metadataStored: true,
    metadataTitle: "قميص قطني كلاسيكي",
    metadataDescription: "قميص قطني بقصة مستقيمة من متجر تجريبي.",
    categories: [{ id: "cat_1", name: "قمصان", status: "sale" }],
    inventory: inventoryState(),
    ...overrides,
  };
}

/** A product with no optional field populated, and no inventory row. */
export function bareProduct(overrides: Partial<CatalogProductInput> = {}): CatalogProductInput {
  return catalogProduct({
    id: "prod_bare",
    name: "منتج",
    sku: null,
    description: null,
    url: null,
    imageUrl: null,
    priceAmount: null,
    currency: null,
    quantity: null,
    isAvailable: false,
    sourceUpdatedAt: null,
    metadataStored: false,
    metadataTitle: null,
    metadataDescription: null,
    categories: [],
    inventory: null,
    ...overrides,
  });
}
