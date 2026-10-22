import { eq } from "drizzle-orm";

import { inventoryLevels, products } from "@/db/schema";
import type { Transaction } from "@/db/tenant";
import {
  loadCategoryRows,
  loadProductCategoryLinks,
} from "@/modules/intelligence/infrastructure/intelligence-repository";
import type { InventoryCategoryRef } from "@/modules/inventory-intelligence/domain/types";

import type { InventorySnapshotRows } from "../domain/snapshot-rows";

/**
 * Read access for inventory intelligence.
 *
 * Three bulk statements, no per-product round trip:
 *
 * 1. every catalogued product of the store (id, name, sku, status only);
 * 2. every category and every product↔category link — Phase 07's existing
 *    loaders, unchanged;
 * 3. every inventory row of the store, aggregated here per product.
 *
 * The inventory table is a current-state mirror (`quantity_key` unique per store,
 * ADR-043), so the raw row count is bounded by the catalogue rather than by sync
 * history. Nothing here writes, and every statement filters on the `storeId` that
 * was already verified against the session inside `withTenantTransaction`.
 *
 * Product-linked rows and unlinked rows are separated rather than dropped: a row
 * whose `product_id` is null is a real observation about a product the catalogue
 * has not mirrored, and silently ignoring it would understate the store's stock.
 */

interface StockBucket {
  quantity: number;
  soldQuantity: number;
  unlimitedQuantity: boolean;
  entries: number;
  variants: string[];
  lastSyncedAt: string;
}

export async function loadInventorySnapshot(
  tx: Transaction,
  storeId: string,
): Promise<InventorySnapshotRows> {
  const [productRows, links, categoryRows, inventoryRows] = await Promise.all([
    tx
      .select({
        id: products.id,
        name: products.name,
        sku: products.sku,
        status: products.status,
      })
      .from(products)
      .where(eq(products.storeId, storeId)),
    loadProductCategoryLinks(tx, storeId),
    loadCategoryRows(tx, storeId),
    tx.select().from(inventoryLevels).where(eq(inventoryLevels.storeId, storeId)),
  ]);

  const categoryById = new Map(categoryRows.map((category) => [category.id, category]));

  const categoriesByProduct = new Map<string, InventoryCategoryRef[]>();
  for (const link of links) {
    const category = categoryById.get(link.categoryId);
    if (!category) continue;

    const list = categoriesByProduct.get(link.productId) ?? [];
    list.push({ id: category.id, name: category.name, status: category.status });
    categoriesByProduct.set(link.productId, list);
  }

  const linkedByProduct = new Map<string, StockBucket>();
  const unlinked: InventorySnapshotRows["unlinked"][number][] = [];
  let inventoryEntries = 0;

  for (const row of inventoryRows) {
    inventoryEntries += 1;

    if (row.productId === null) {
      unlinked.push({
        quantity: row.quantity,
        soldQuantity: row.soldQuantity,
        unlimitedQuantity: row.unlimitedQuantity,
        productName: row.productName,
        externalProductId: row.externalProductId,
        lastSyncedAt: row.lastSyncedAt.toISOString(),
      });
      continue;
    }

    const existing = linkedByProduct.get(row.productId);
    const variant = row.variant === null || row.variant.trim() === "" ? null : row.variant;

    if (existing === undefined) {
      linkedByProduct.set(row.productId, {
        quantity: row.quantity,
        soldQuantity: row.soldQuantity,
        unlimitedQuantity: row.unlimitedQuantity,
        entries: 1,
        variants: variant === null ? [] : [variant],
        lastSyncedAt: row.lastSyncedAt.toISOString(),
      });
      continue;
    }

    existing.quantity += row.quantity;
    existing.soldQuantity += row.soldQuantity;
    existing.unlimitedQuantity = existing.unlimitedQuantity || row.unlimitedQuantity;
    existing.entries += 1;
    if (variant !== null) existing.variants.push(variant);
    if (row.lastSyncedAt.toISOString() > existing.lastSyncedAt) {
      existing.lastSyncedAt = row.lastSyncedAt.toISOString();
    }
  }

  const catalogProducts = productRows
    .map((row) => {
      const bucket = linkedByProduct.get(row.id);

      return {
        id: row.id,
        name: row.name,
        sku: row.sku,
        productStatus: row.status,
        categories: categoriesByProduct.get(row.id) ?? [],
        stock:
          bucket === undefined
            ? null
            : {
                quantity: bucket.quantity,
                soldQuantity: bucket.soldQuantity,
                unlimitedQuantity: bucket.unlimitedQuantity,
                entries: bucket.entries,
                variants: bucket.variants,
                lastSyncedAt: bucket.lastSyncedAt,
              },
      };
    })
    .sort((a, b) => a.name.localeCompare(b.name, "ar"));

  const lastSyncedAt =
    inventoryRows.length === 0
      ? null
      : inventoryRows.reduce((latest, row) => {
          const value = row.lastSyncedAt.toISOString();
          return value > latest ? value : latest;
        }, inventoryRows[0]!.lastSyncedAt.toISOString());

  return {
    products: catalogProducts,
    categories: categoryRows.map((category) => ({
      id: category.id,
      name: category.name,
      status: category.status,
    })),
    unlinked,
    inventoryEntries,
    lastSyncedAt,
  };
}
