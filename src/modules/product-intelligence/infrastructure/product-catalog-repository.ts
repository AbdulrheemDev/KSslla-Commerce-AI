import { eq } from "drizzle-orm";

import type { Transaction } from "@/db/tenant";
import { products } from "@/db/schema/catalog";
import type { CategoryRef } from "@/modules/product-intelligence/domain/catalog";
import { readProviderMetadata } from "@/modules/product-intelligence/domain/provider-metadata";
import type {
  CatalogCategoryRef,
  CatalogInventoryState,
  CatalogProductInput,
} from "@/modules/product-intelligence/domain/types";
import {
  loadCategoryRows,
  loadInventoryRows,
  loadProductCategoryLinks,
} from "@/modules/intelligence/infrastructure/intelligence-repository";

/**
 * Read access for product intelligence.
 *
 * Four bulk statements, no per-product round trip:
 * 1. the products of the store (narrow projection of the columns this phase reads);
 * 2. every product↔category link — Phase 07's existing loader;
 * 3. every category — Phase 07's loader, now carrying `status`;
 * 4. every inventory row — Phase 07's loader, aggregated here per product.
 *
 * Phase 07's `loadProductRows` is deliberately **not** reused: it projects the
 * six columns its own metrics need and would have to grow description, SKU, URL,
 * metadata, and two timestamps to serve this phase. The tenant rule is identical
 * either way — the caller is inside `withTenantTransaction` and every statement
 * filters on the `storeId` that was already verified against the session.
 */

export interface CatalogSnapshotRows {
  readonly products: CatalogProductInput[];
  readonly categories: CategoryRef[];
}

interface InventoryBucket {
  quantity: number;
  soldQuantity: number;
  unlimited: boolean;
  entries: number;
  lastSyncedAt: Date;
}

export async function loadCatalog(tx: Transaction, storeId: string): Promise<CatalogSnapshotRows> {
  const [productRows, links, categoryRows, inventoryRows] = await Promise.all([
    tx
      .select({
        id: products.id,
        name: products.name,
        sku: products.sku,
        status: products.status,
        description: products.description,
        url: products.url,
        imageUrl: products.imageUrl,
        priceAmount: products.priceAmount,
        currency: products.currency,
        quantity: products.quantity,
        isAvailable: products.isAvailable,
        sourceUpdatedAt: products.sourceUpdatedAt,
        lastSeenAt: products.lastSeenAt,
        metadata: products.metadata,
      })
      .from(products)
      .where(eq(products.storeId, storeId)),
    loadProductCategoryLinks(tx, storeId),
    loadCategoryRows(tx, storeId),
    loadInventoryRows(tx, storeId),
  ]);

  const categoryById = new Map(categoryRows.map((category) => [category.id, category]));

  const categoriesByProduct = new Map<string, CatalogCategoryRef[]>();
  for (const link of links) {
    const category = categoryById.get(link.categoryId);
    if (!category) continue;

    const list = categoriesByProduct.get(link.productId) ?? [];
    list.push({ id: category.id, name: category.name, status: category.status });
    categoriesByProduct.set(link.productId, list);
  }

  const inventoryByProduct = new Map<string, InventoryBucket>();
  for (const row of inventoryRows) {
    if (row.productId === null) continue;

    const bucket = inventoryByProduct.get(row.productId) ?? {
      quantity: 0,
      soldQuantity: 0,
      unlimited: false,
      entries: 0,
      lastSyncedAt: row.lastSyncedAt,
    };

    bucket.quantity += row.quantity;
    bucket.soldQuantity += row.soldQuantity;
    bucket.unlimited = bucket.unlimited || row.unlimitedQuantity;
    bucket.entries += 1;
    if (row.lastSyncedAt > bucket.lastSyncedAt) bucket.lastSyncedAt = row.lastSyncedAt;

    inventoryByProduct.set(row.productId, bucket);
  }

  const catalogProducts: CatalogProductInput[] = productRows
    .map((row) => {
      const metadata = readProviderMetadata(row.metadata);
      const inventory = inventoryByProduct.get(row.id);

      const inventoryState: CatalogInventoryState | null =
        inventory === undefined
          ? null
          : {
              quantity: inventory.quantity,
              soldQuantity: inventory.soldQuantity,
              unlimitedQuantity: inventory.unlimited,
              entries: inventory.entries,
              lastSyncedAt: inventory.lastSyncedAt.toISOString(),
            };

      return {
        id: row.id,
        name: row.name,
        sku: row.sku,
        status: row.status,
        description: row.description,
        url: row.url,
        imageUrl: row.imageUrl,
        priceAmount: row.priceAmount,
        currency: row.currency,
        quantity: row.quantity,
        isAvailable: row.isAvailable,
        sourceUpdatedAt: row.sourceUpdatedAt?.toISOString() ?? null,
        lastSeenAt: row.lastSeenAt.toISOString(),
        metadataStored: metadata.stored,
        metadataTitle: metadata.title,
        metadataDescription: metadata.description,
        categories: categoriesByProduct.get(row.id) ?? [],
        inventory: inventoryState,
      } satisfies CatalogProductInput;
    })
    .sort((a, b) => a.name.localeCompare(b.name, "ar") || a.id.localeCompare(b.id));

  return {
    products: catalogProducts,
    categories: categoryRows
      .map((category) => ({
        id: category.id,
        name: category.name,
        status: category.status,
      }))
      .sort((a, b) => a.name.localeCompare(b.name, "ar") || a.id.localeCompare(b.id)),
  };
}
