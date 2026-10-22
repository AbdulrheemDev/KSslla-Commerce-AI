import { and, asc, count, eq, inArray, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";

import type { DbExecutor } from "@/db/executor";
import { categories, productCategories } from "@/db/schema";
import type { CatalogCategoryInput } from "@/modules/catalog/domain/types";

/**
 * Category persistence.
 *
 * Upsert on `(store_id, external_category_id)`: re-running a sync updates rows
 * in place and never duplicates them.
 */

export interface UpsertResult {
  created: number;
  updated: number;
}

export async function upsertCategories(
  db: DbExecutor,
  input: {
    organizationId: string;
    storeId: string;
    items: readonly CatalogCategoryInput[];
    seenAt: Date;
  },
): Promise<UpsertResult> {
  if (input.items.length === 0) return { created: 0, updated: 0 };

  const rows = await db
    .insert(categories)
    .values(
      input.items.map((item) => ({
        organizationId: input.organizationId,
        storeId: input.storeId,
        externalCategoryId: item.externalId,
        name: item.name,
        parentExternalId: item.parentExternalId,
        status: item.status,
        sortOrder: item.sortOrder,
        imageUrl: item.imageUrl,
        sourceUpdatedAt: item.sourceUpdatedAt,
        lastSeenAt: input.seenAt,
        metadata: item.metadata,
      })),
    )
    .onConflictDoUpdate({
      target: [categories.storeId, categories.externalCategoryId],
      set: {
        name: sql`excluded.name`,
        parentExternalId: sql`excluded.parent_external_id`,
        status: sql`excluded.status`,
        sortOrder: sql`excluded.sort_order`,
        imageUrl: sql`excluded.image_url`,
        sourceUpdatedAt: sql`excluded.source_updated_at`,
        lastSeenAt: sql`excluded.last_seen_at`,
        metadata: sql`excluded.metadata`,
        updatedAt: sql`now()`,
      },
    })
    .returning({
      id: categories.id,
      created: sql<boolean>`(xmax = 0)`,
    });

  const created = rows.filter((row) => row.created).length;

  // Parent links are resolved within the store only: a parent id from another
  // tenant can never be attached, even if the provider repeats it.
  await db.execute(sql`
    update ${categories} as child
       set parent_category_id = parent.id
      from ${categories} as parent
     where child.store_id = ${input.storeId}
       and parent.store_id = child.store_id
       and child.parent_external_id = parent.external_category_id
       and child.parent_external_id is not null
       and child.parent_category_id is distinct from parent.id
  `);

  return { created, updated: rows.length - created };
}

export async function findCategoryIdsByExternalIds(
  db: DbExecutor,
  storeId: string,
  externalIds: readonly string[],
): Promise<Map<string, string>> {
  if (externalIds.length === 0) return new Map();

  const rows = await db
    .select({ id: categories.id, externalCategoryId: categories.externalCategoryId })
    .from(categories)
    .where(
      and(
        eq(categories.storeId, storeId),
        inArray(categories.externalCategoryId, [...externalIds]),
      ),
    );

  return new Map(rows.map((row) => [row.externalCategoryId, row.id]));
}

export interface CategoryListRow {
  id: string;
  externalCategoryId: string;
  name: string;
  status: string;
  parentExternalId: string | null;
  parentName: string | null;
  sortOrder: number | null;
  productCount: number;
  sourceUpdatedAt: Date | null;
  lastSeenAt: Date;
  updatedAt: Date;
}

const parentCategory = alias(categories, "parent_category");

export async function listCategories(
  db: DbExecutor,
  input: { storeId: string; limit: number; offset: number },
): Promise<{ rows: CategoryListRow[]; total: number }> {
  const rows = await db
    .select({
      id: categories.id,
      externalCategoryId: categories.externalCategoryId,
      name: categories.name,
      status: categories.status,
      parentExternalId: categories.parentExternalId,
      parentName: parentCategory.name,
      sortOrder: categories.sortOrder,
      productCount: sql<number>`(
        select count(*)::int from ${productCategories}
         where ${productCategories.categoryId} = ${categories.id}
      )`,
      sourceUpdatedAt: categories.sourceUpdatedAt,
      lastSeenAt: categories.lastSeenAt,
      updatedAt: categories.updatedAt,
    })
    .from(categories)
    .leftJoin(parentCategory, eq(parentCategory.id, categories.parentCategoryId))
    .where(eq(categories.storeId, input.storeId))
    .orderBy(asc(categories.sortOrder), asc(categories.name))
    .limit(input.limit)
    .offset(input.offset);

  const [totalRow] = await db
    .select({ value: count() })
    .from(categories)
    .where(eq(categories.storeId, input.storeId));

  return { rows, total: Number(totalRow?.value ?? 0) };
}

export async function countCategories(db: DbExecutor, storeId: string): Promise<number> {
  const [row] = await db
    .select({ value: count() })
    .from(categories)
    .where(eq(categories.storeId, storeId));
  return Number(row?.value ?? 0);
}
