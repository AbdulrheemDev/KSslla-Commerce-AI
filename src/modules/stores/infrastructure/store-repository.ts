import { asc, eq } from "drizzle-orm";

import type { DbExecutor } from "@/db/executor";
import { stores } from "@/db/schema";

export type StoreRecord = typeof stores.$inferSelect;

export async function insertStore(
  db: DbExecutor,
  values: { organizationId: string; name: string; slug: string },
): Promise<StoreRecord> {
  const [row] = await db
    .insert(stores)
    .values({ ...values, platform: "salla", status: "not_connected" })
    .returning();
  if (!row) throw new Error("insertStore returned no row");
  return row;
}

export async function listStoresForOrganization(
  db: DbExecutor,
  organizationId: string,
): Promise<StoreRecord[]> {
  return db
    .select()
    .from(stores)
    .where(eq(stores.organizationId, organizationId))
    .orderBy(asc(stores.createdAt));
}

export async function findStoreById(
  db: DbExecutor,
  storeId: string,
): Promise<StoreRecord | undefined> {
  const [row] = await db.select().from(stores).where(eq(stores.id, storeId)).limit(1);
  return row;
}

export async function findStoreBySlug(
  db: DbExecutor,
  organizationId: string,
  slug: string,
): Promise<StoreRecord | undefined> {
  const [row] = await db.select().from(stores).where(eq(stores.slug, slug)).limit(1);
  return row?.organizationId === organizationId ? row : undefined;
}

export async function updateStoreName(
  db: DbExecutor,
  storeId: string,
  name: string,
): Promise<StoreRecord | undefined> {
  const [row] = await db
    .update(stores)
    .set({ name, updatedAt: new Date() })
    .where(eq(stores.id, storeId))
    .returning();
  return row;
}
