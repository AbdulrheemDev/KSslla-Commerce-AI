import { and, eq, gte, isNotNull, lte, sql } from "drizzle-orm";

import type { Transaction } from "@/db/tenant";
import { categories, productCategories, products } from "@/db/schema/catalog";
import { customers, orders } from "@/db/schema/commerce";
import { inventoryLevels } from "@/db/schema/inventory";
import type { InventoryMetricRow } from "@/modules/intelligence/domain/inventory";

/**
 * Read-only aggregate queries for store intelligence.
 *
 * Two rules hold for every function here:
 *
 * 1. it takes `storeId` and filters on it — the tenant is already resolved from
 *    the session, and RLS enforces the organization as a second wall;
 * 2. it selects only the columns an analysis needs. No customer e-mail, phone,
 *    address, or provider payload is ever loaded into the intelligence layer.
 */

export interface ProductRow {
  id: string;
  name: string;
  status: string;
  priceAmount: string | null;
  currency: string | null;
  quantity: number | null;
  isAvailable: boolean;
  imageUrl: string | null;
  categoryNames: string[];
  inventoryQuantity: number | null;
  soldQuantity: number | null;
  unlimitedQuantity: boolean | null;
}

interface ProductBaseRow {
  id: string;
  name: string;
  status: string;
  priceAmount: string | null;
  currency: string | null;
  quantity: number | null;
  isAvailable: boolean;
  imageUrl: string | null;
  categoryName: string | null;
}

export async function loadProductRows(tx: Transaction, storeId: string): Promise<ProductRow[]> {
  const baseRows = await tx
    .select({
      id: products.id,
      name: products.name,
      status: products.status,
      priceAmount: products.priceAmount,
      currency: products.currency,
      quantity: products.quantity,
      isAvailable: products.isAvailable,
      imageUrl: products.imageUrl,
      categoryName: categories.name,
    })
    .from(products)
    .leftJoin(productCategories, eq(productCategories.productId, products.id))
    .leftJoin(categories, eq(categories.id, productCategories.categoryId))
    .where(eq(products.storeId, storeId));

  const inventoryRows = await tx
    .select({
      productId: inventoryLevels.productId,
      quantity: sql<number>`coalesce(sum(${inventoryLevels.quantity}), 0)`,
      soldQuantity: sql<number>`coalesce(sum(${inventoryLevels.soldQuantity}), 0)`,
      unlimited: sql<boolean>`bool_or(${inventoryLevels.unlimitedQuantity})`,
    })
    .from(inventoryLevels)
    .where(and(eq(inventoryLevels.storeId, storeId), isNotNull(inventoryLevels.productId)))
    .groupBy(inventoryLevels.productId);

  const inventoryByProduct = new Map(
    inventoryRows
      .filter((row): row is typeof row & { productId: string } => row.productId !== null)
      .map((row) => [
        row.productId,
        {
          quantity: Number(row.quantity),
          soldQuantity: Number(row.soldQuantity),
          unlimited: Boolean(row.unlimited),
        },
      ]),
  );

  const byProduct = new Map<string, ProductBaseRow & { categoryNames: string[] }>();

  for (const row of baseRows) {
    const existing = byProduct.get(row.id);

    if (!existing) {
      byProduct.set(row.id, {
        ...row,
        categoryNames: row.categoryName ? [row.categoryName] : [],
      });
      continue;
    }

    if (row.categoryName && !existing.categoryNames.includes(row.categoryName)) {
      existing.categoryNames.push(row.categoryName);
    }
  }

  return [...byProduct.values()].map((row) => {
    const inventory = inventoryByProduct.get(row.id);

    return {
      id: row.id,
      name: row.name,
      status: row.status,
      priceAmount: row.priceAmount,
      currency: row.currency,
      quantity: row.quantity,
      isAvailable: row.isAvailable,
      imageUrl: row.imageUrl,
      categoryNames: row.categoryNames,
      inventoryQuantity: inventory?.quantity ?? null,
      soldQuantity: inventory?.soldQuantity ?? null,
      unlimitedQuantity: inventory?.unlimited ?? null,
    };
  });
}

export interface OrderRow {
  id: string;
  statusSlug: string | null;
  totalAmount: string | null;
  currency: string | null;
  draft: boolean;
  orderDate: Date | null;
  customerId: string | null;
}

export async function loadOrders(
  tx: Transaction,
  storeId: string,
  range: { from: Date; to: Date },
): Promise<OrderRow[]> {
  return tx
    .select({
      id: orders.id,
      statusSlug: orders.statusSlug,
      totalAmount: orders.totalAmount,
      currency: orders.currency,
      draft: orders.draft,
      orderDate: orders.orderDate,
      customerId: orders.customerId,
    })
    .from(orders)
    .where(
      and(
        eq(orders.storeId, storeId),
        gte(orders.orderDate, range.from),
        lte(orders.orderDate, range.to),
      ),
    );
}

export interface OrderBounds {
  total: number;
  firstOrderAt: Date | null;
  lastOrderAt: Date | null;
}

export async function loadOrderBounds(tx: Transaction, storeId: string): Promise<OrderBounds> {
  const [row] = await tx
    .select({
      total: sql<number>`count(*)`,
      firstOrderAt: sql<Date | null>`min(${orders.orderDate})`,
      lastOrderAt: sql<Date | null>`max(${orders.orderDate})`,
    })
    .from(orders)
    .where(eq(orders.storeId, storeId));

  return {
    total: Number(row?.total ?? 0),
    firstOrderAt: row?.firstOrderAt ? new Date(row.firstOrderAt) : null,
    lastOrderAt: row?.lastOrderAt ? new Date(row.lastOrderAt) : null,
  };
}

export interface CustomerRow {
  id: string;
  sourceCreatedAt: Date | null;
}

export async function loadCustomerRows(tx: Transaction, storeId: string): Promise<CustomerRow[]> {
  const rows = await tx
    .select({ id: customers.id, sourceCreatedAt: customers.sourceCreatedAt })
    .from(customers)
    .where(eq(customers.storeId, storeId));

  return rows.map((row) => ({
    id: row.id,
    sourceCreatedAt: row.sourceCreatedAt ? new Date(row.sourceCreatedAt) : null,
  }));
}

export async function loadCategoryRows(
  tx: Transaction,
  storeId: string,
): Promise<Array<{ id: string; name: string }>> {
  return tx
    .select({ id: categories.id, name: categories.name })
    .from(categories)
    .where(eq(categories.storeId, storeId));
}

export async function loadProductCategoryLinks(
  tx: Transaction,
  storeId: string,
): Promise<Array<{ productId: string; categoryId: string }>> {
  return tx
    .select({ productId: productCategories.productId, categoryId: productCategories.categoryId })
    .from(productCategories)
    .where(eq(productCategories.storeId, storeId));
}

/**
 * Raw provider entries, one row per quantity key (per variant when present).
 * The inventory domain aggregates them per product; nothing here interprets
 * stock on its own.
 */
export async function loadInventoryRows(
  tx: Transaction,
  storeId: string,
): Promise<InventoryMetricRow[]> {
  const rows = await tx
    .select({
      productId: inventoryLevels.productId,
      externalProductId: inventoryLevels.externalProductId,
      productName: inventoryLevels.productName,
      quantity: inventoryLevels.quantity,
      soldQuantity: inventoryLevels.soldQuantity,
      unlimitedQuantity: inventoryLevels.unlimitedQuantity,
      priceAmount: inventoryLevels.priceAmount,
      lastSyncedAt: inventoryLevels.lastSyncedAt,
    })
    .from(inventoryLevels)
    .where(eq(inventoryLevels.storeId, storeId));

  return rows.map((row) => ({
    productId: row.productId,
    externalProductId: row.externalProductId,
    productName: row.productName,
    quantity: row.quantity,
    soldQuantity: row.soldQuantity,
    unlimitedQuantity: row.unlimitedQuantity,
    priceAmount: row.priceAmount,
    lastSyncedAt: new Date(row.lastSyncedAt),
  }));
}
