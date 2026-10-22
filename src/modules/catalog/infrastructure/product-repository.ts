import { and, count, desc, eq, ilike, inArray, or, sql, type SQL } from "drizzle-orm";

import type { DbExecutor } from "@/db/executor";
import { categories, productCategories, products } from "@/db/schema";
import type { CatalogProductInput } from "@/modules/catalog/domain/types";

/**
 * Product persistence.
 *
 * Upsert on `(store_id, external_product_id)`. A page is written in one
 * transaction by the sync service, so a failure never leaves counters ahead of
 * the rows they describe.
 */

export interface ProductUpsertResult {
  created: number;
  updated: number;
  linked: number;
  skippedRelations: number;
}

export async function upsertProducts(
  db: DbExecutor,
  input: {
    organizationId: string;
    storeId: string;
    items: readonly CatalogProductInput[];
    seenAt: Date;
  },
): Promise<ProductUpsertResult> {
  if (input.items.length === 0) {
    return { created: 0, updated: 0, linked: 0, skippedRelations: 0 };
  }

  const rows = await db
    .insert(products)
    .values(
      input.items.map((item) => ({
        organizationId: input.organizationId,
        storeId: input.storeId,
        externalProductId: item.externalId,
        name: item.name,
        sku: item.sku,
        productType: item.productType,
        status: item.status,
        priceAmount: item.priceAmount,
        currency: item.currency,
        regularPriceAmount: item.regularPriceAmount,
        salePriceAmount: item.salePriceAmount,
        quantity: item.quantity,
        isAvailable: item.isAvailable,
        url: item.url,
        imageUrl: item.imageUrl,
        description: item.description,
        brandName: item.brandName,
        sourceUpdatedAt: item.sourceUpdatedAt,
        lastSeenAt: input.seenAt,
        metadata: item.metadata,
      })),
    )
    .onConflictDoUpdate({
      target: [products.storeId, products.externalProductId],
      set: {
        name: sql`excluded.name`,
        sku: sql`excluded.sku`,
        productType: sql`excluded.product_type`,
        status: sql`excluded.status`,
        priceAmount: sql`excluded.price_amount`,
        currency: sql`excluded.currency`,
        regularPriceAmount: sql`excluded.regular_price_amount`,
        salePriceAmount: sql`excluded.sale_price_amount`,
        quantity: sql`excluded.quantity`,
        isAvailable: sql`excluded.is_available`,
        url: sql`excluded.url`,
        imageUrl: sql`excluded.image_url`,
        description: sql`excluded.description`,
        brandName: sql`excluded.brand_name`,
        sourceUpdatedAt: sql`excluded.source_updated_at`,
        lastSeenAt: sql`excluded.last_seen_at`,
        metadata: sql`excluded.metadata`,
        updatedAt: sql`now()`,
      },
    })
    .returning({
      id: products.id,
      externalProductId: products.externalProductId,
      created: sql<boolean>`(xmax = 0)`,
    });

  const created = rows.filter((row) => row.created).length;

  const local = new Map(rows.map((row) => [row.externalProductId, row.id]));
  const productIds = rows.map((row) => row.id);

  // The page is an authoritative snapshot for its own products: replace their
  // links, which also removes a category the merchant detached in Salla.
  await db.delete(productCategories).where(inArray(productCategories.productId, productIds));

  const wanted = input.items.flatMap((item) =>
    item.categoryExternalIds.map((externalId) => ({
      productId: local.get(item.externalId),
      externalCategoryId: externalId,
    })),
  );

  if (wanted.length === 0) {
    return { created, updated: rows.length - created, linked: 0, skippedRelations: 0 };
  }

  const externalIds = [...new Set(wanted.map((entry) => entry.externalCategoryId))];
  const categoryRows = await db
    .select({ id: categories.id, externalCategoryId: categories.externalCategoryId })
    .from(categories)
    .where(
      and(
        eq(categories.storeId, input.storeId),
        inArray(categories.externalCategoryId, externalIds),
      ),
    );

  const categoryByExternal = new Map(categoryRows.map((row) => [row.externalCategoryId, row.id]));

  const links: Array<{
    organizationId: string;
    storeId: string;
    productId: string;
    categoryId: string;
  }> = [];
  let skippedRelations = 0;

  for (const entry of wanted) {
    const categoryId = categoryByExternal.get(entry.externalCategoryId);
    if (!entry.productId || !categoryId) {
      skippedRelations += 1;
      continue;
    }
    links.push({
      organizationId: input.organizationId,
      storeId: input.storeId,
      productId: entry.productId,
      categoryId,
    });
  }

  if (links.length > 0) {
    const unique = [
      ...new Map(links.map((link) => [`${link.productId}:${link.categoryId}`, link])).values(),
    ];
    await db.insert(productCategories).values(unique).onConflictDoNothing();
  }

  return {
    created,
    updated: rows.length - created,
    linked: links.length,
    skippedRelations,
  };
}

export interface ProductListRow {
  id: string;
  externalProductId: string;
  name: string;
  sku: string | null;
  productType: string | null;
  status: string;
  priceAmount: string | null;
  currency: string | null;
  regularPriceAmount: string | null;
  salePriceAmount: string | null;
  quantity: number | null;
  isAvailable: boolean;
  url: string | null;
  imageUrl: string | null;
  description: string | null;
  brandName: string | null;
  sourceUpdatedAt: Date | null;
  lastSeenAt: Date;
  updatedAt: Date;
  categories: Array<{ id: string; name: string }>;
}

export interface ProductListFilter {
  storeId: string;
  query?: string;
  limit: number;
  offset: number;
}

function whereFor(filter: ProductListFilter): SQL | undefined {
  const conditions: SQL[] = [eq(products.storeId, filter.storeId)];

  const query = filter.query?.trim();
  if (query) {
    const pattern = `%${query.replace(/[%_\\]/g, (char) => `\\${char}`)}%`;
    const search = or(
      ilike(products.name, pattern),
      ilike(products.sku, pattern),
      ilike(products.externalProductId, pattern),
    );
    if (search) conditions.push(search);
  }

  return and(...conditions);
}

export async function listProducts(
  db: DbExecutor,
  filter: ProductListFilter,
): Promise<{ rows: ProductListRow[]; total: number }> {
  const where = whereFor(filter);

  const rows = await db
    .select({
      id: products.id,
      externalProductId: products.externalProductId,
      name: products.name,
      sku: products.sku,
      productType: products.productType,
      status: products.status,
      priceAmount: products.priceAmount,
      currency: products.currency,
      regularPriceAmount: products.regularPriceAmount,
      salePriceAmount: products.salePriceAmount,
      quantity: products.quantity,
      isAvailable: products.isAvailable,
      url: products.url,
      imageUrl: products.imageUrl,
      description: products.description,
      brandName: products.brandName,
      sourceUpdatedAt: products.sourceUpdatedAt,
      lastSeenAt: products.lastSeenAt,
      updatedAt: products.updatedAt,
    })
    .from(products)
    .where(where)
    .orderBy(desc(products.updatedAt), products.name)
    .limit(filter.limit)
    .offset(filter.offset);

  const [totalRow] = await db.select({ value: count() }).from(products).where(where);

  const categoryRows =
    rows.length === 0
      ? []
      : await db
          .select({
            productId: productCategories.productId,
            categoryId: categories.id,
            name: categories.name,
          })
          .from(productCategories)
          .innerJoin(categories, eq(categories.id, productCategories.categoryId))
          .where(
            inArray(
              productCategories.productId,
              rows.map((row) => row.id),
            ),
          );

  const categoriesByProduct = new Map<string, Array<{ id: string; name: string }>>();
  for (const row of categoryRows) {
    const list = categoriesByProduct.get(row.productId) ?? [];
    list.push({ id: row.categoryId, name: row.name });
    categoriesByProduct.set(row.productId, list);
  }

  return {
    rows: rows.map((row) => ({ ...row, categories: categoriesByProduct.get(row.id) ?? [] })),
    total: Number(totalRow?.value ?? 0),
  };
}

export async function countProducts(db: DbExecutor, storeId: string): Promise<number> {
  const [row] = await db
    .select({ value: count() })
    .from(products)
    .where(eq(products.storeId, storeId));
  return Number(row?.value ?? 0);
}

export async function findProductById(
  db: DbExecutor,
  storeId: string,
  productId: string,
): Promise<ProductListRow | undefined> {
  // Direct lookup keeps the detail page independent of list ordering.
  const [row] = await db
    .select({
      id: products.id,
      externalProductId: products.externalProductId,
      name: products.name,
      sku: products.sku,
      productType: products.productType,
      status: products.status,
      priceAmount: products.priceAmount,
      currency: products.currency,
      regularPriceAmount: products.regularPriceAmount,
      salePriceAmount: products.salePriceAmount,
      quantity: products.quantity,
      isAvailable: products.isAvailable,
      url: products.url,
      imageUrl: products.imageUrl,
      description: products.description,
      brandName: products.brandName,
      sourceUpdatedAt: products.sourceUpdatedAt,
      lastSeenAt: products.lastSeenAt,
      updatedAt: products.updatedAt,
    })
    .from(products)
    .where(and(eq(products.storeId, storeId), eq(products.id, productId)))
    .limit(1);

  if (!row) return undefined;

  const categoryRows = await db
    .select({ name: categories.name, id: categories.id })
    .from(productCategories)
    .innerJoin(categories, eq(categories.id, productCategories.categoryId))
    .where(eq(productCategories.productId, row.id));

  return {
    ...row,
    categories: categoryRows.map((category) => ({ id: category.id, name: category.name })),
  };
}
