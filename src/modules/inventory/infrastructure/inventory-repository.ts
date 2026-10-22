import { and, count, eq, inArray, sql } from "drizzle-orm";

import type { DbExecutor } from "@/db/executor";
import { inventoryLevels, products } from "@/db/schema";
import type { InventoryItemInput } from "@/modules/inventory/domain/types";

/**
 * Inventory persistence — current state, one row per provider quantity entry.
 *
 * Storage policy (ADR-043): an upsert, never an append. Re-syncing a store
 * rewrites at most one row per catalogue entry, so growth is bounded by the
 * catalogue, not by sync frequency. `lastSyncedAt` answers "as of when". No
 * history table exists because nothing consumes it in this phase and per-run
 * snapshots would grow without bound.
 *
 * The local product link is resolved by `(store_id, external_product_id)` and
 * is allowed to be null: a quantity entry may reference a product the catalogue
 * sync has not written yet. That never fails the run.
 */

export interface InventoryUpsertResult {
  created: number;
  updated: number;
  linked: number;
  unlinked: number;
}

export async function upsertInventoryLevels(
  db: DbExecutor,
  input: {
    organizationId: string;
    storeId: string;
    items: readonly InventoryItemInput[];
    seenAt: Date;
  },
): Promise<InventoryUpsertResult> {
  if (input.items.length === 0) return { created: 0, updated: 0, linked: 0, unlinked: 0 };

  const unique = new Map<string, InventoryItemInput>();
  for (const item of input.items) unique.set(item.quantityKey, item);
  const page = [...unique.values()];

  const externalIds = [...new Set(page.map((item) => item.externalProductId))];
  const productRows = await db
    .select({
      id: products.id,
      externalProductId: products.externalProductId,
      currency: products.currency,
    })
    .from(products)
    .where(
      and(eq(products.storeId, input.storeId), inArray(products.externalProductId, externalIds)),
    );

  const productByExternal = new Map(productRows.map((row) => [row.externalProductId, row]));

  const rows = await db
    .insert(inventoryLevels)
    .values(
      page.map((item) => {
        const product = productByExternal.get(item.externalProductId);
        return {
          organizationId: input.organizationId,
          storeId: input.storeId,
          quantityKey: item.quantityKey,
          externalProductId: item.externalProductId,
          externalSkuId: item.externalSkuId,
          productId: product?.id ?? null,
          productName: item.productName,
          sku: item.sku,
          variant: item.variant,
          imageUrl: item.imageUrl,
          quantity: item.quantity,
          soldQuantity: item.soldQuantity,
          unlimitedQuantity: item.unlimitedQuantity,
          priceAmount: item.priceAmount,
          // The quantities endpoint documents no currency; the local product's
          // currency is used when the product is known, otherwise nothing.
          priceCurrency: product?.currency ?? null,
          lastSyncedAt: input.seenAt,
        };
      }),
    )
    .onConflictDoUpdate({
      target: [inventoryLevels.storeId, inventoryLevels.quantityKey],
      set: {
        externalProductId: sql`excluded.external_product_id`,
        externalSkuId: sql`excluded.external_sku_id`,
        productId: sql`excluded.product_id`,
        productName: sql`excluded.product_name`,
        sku: sql`excluded.sku`,
        variant: sql`excluded.variant`,
        imageUrl: sql`excluded.image_url`,
        quantity: sql`excluded.quantity`,
        soldQuantity: sql`excluded.sold_quantity`,
        unlimitedQuantity: sql`excluded.unlimited_quantity`,
        priceAmount: sql`excluded.price_amount`,
        priceCurrency: sql`excluded.price_currency`,
        lastSyncedAt: sql`excluded.last_synced_at`,
        updatedAt: sql`now()`,
      },
    })
    .returning({
      id: inventoryLevels.id,
      created: sql<boolean>`(xmax = 0)`,
      productId: inventoryLevels.productId,
    });

  const created = rows.filter((row) => row.created).length;
  const linked = rows.filter((row) => row.productId !== null).length;

  return { created, updated: rows.length - created, linked, unlinked: rows.length - linked };
}

export interface InventoryListRow {
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
  lastSyncedAt: Date;
}

export async function listInventoryLevels(
  db: DbExecutor,
  input: { storeId: string; query?: string; limit: number; offset: number },
): Promise<{ rows: InventoryListRow[]; total: number }> {
  const search = input.query?.trim();
  const where = search
    ? and(
        eq(inventoryLevels.storeId, input.storeId),
        sql`(${inventoryLevels.productName} ilike ${`%${search}%`} or coalesce(${inventoryLevels.sku}, '') ilike ${`%${search}%`})`,
      )
    : eq(inventoryLevels.storeId, input.storeId);

  const [rows, totals] = await Promise.all([
    db
      .select({
        id: inventoryLevels.id,
        quantityKey: inventoryLevels.quantityKey,
        externalProductId: inventoryLevels.externalProductId,
        externalSkuId: inventoryLevels.externalSkuId,
        productId: inventoryLevels.productId,
        productName: inventoryLevels.productName,
        sku: inventoryLevels.sku,
        variant: inventoryLevels.variant,
        quantity: inventoryLevels.quantity,
        soldQuantity: inventoryLevels.soldQuantity,
        unlimitedQuantity: inventoryLevels.unlimitedQuantity,
        priceAmount: inventoryLevels.priceAmount,
        lastSyncedAt: inventoryLevels.lastSyncedAt,
      })
      .from(inventoryLevels)
      .where(where)
      .orderBy(inventoryLevels.productName, inventoryLevels.quantityKey)
      .limit(input.limit)
      .offset(input.offset),
    db.select({ value: count() }).from(inventoryLevels).where(where),
  ]);

  return { rows, total: Number(totals[0]?.value ?? 0) };
}

export async function inventorySummary(
  db: DbExecutor,
  storeId: string,
): Promise<{
  products: number;
  totalQuantity: number;
  unlimited: number;
  outOfStock: number;
  lastSyncedAt: Date | null;
}> {
  const [row] = await db
    .select({
      products: count(),
      totalQuantity: sql<number>`coalesce(sum(${inventoryLevels.quantity}), 0)`,
      unlimited: sql<number>`count(*) filter (where ${inventoryLevels.unlimitedQuantity} = true)`,
      outOfStock: sql<number>`count(*) filter (where ${inventoryLevels.quantity} = 0 and ${inventoryLevels.unlimitedQuantity} = false)`,
      lastSyncedAt: sql<Date | null>`max(${inventoryLevels.lastSyncedAt})`,
    })
    .from(inventoryLevels)
    .where(eq(inventoryLevels.storeId, storeId));

  return {
    products: Number(row?.products ?? 0),
    totalQuantity: Number(row?.totalQuantity ?? 0),
    unlimited: Number(row?.unlimited ?? 0),
    outOfStock: Number(row?.outOfStock ?? 0),
    lastSyncedAt: row?.lastSyncedAt ? new Date(row.lastSyncedAt) : null,
  };
}
