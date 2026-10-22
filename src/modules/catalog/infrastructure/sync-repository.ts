import { and, desc, eq, sql } from "drizzle-orm";

import type { DbExecutor } from "@/db/executor";
import { syncLocks, syncRuns, type SyncRun } from "@/db/schema";
import type { SyncResource } from "@/modules/catalog/domain/types";

/**
 * Sync bookkeeping.
 *
 * The lock is a lease with an expiry: a worker that dies stops renewing, and
 * another request may take over after the TTL. Acquisition is a single atomic
 * statement, so two processes cannot both win.
 */

export async function acquireSyncLock(
  db: DbExecutor,
  input: {
    organizationId: string;
    storeId: string;
    resource: string;
    lockId: string;
    ttlSeconds: number;
    runId?: string | null;
  },
): Promise<boolean> {
  const rows = await db.execute(sql`
    insert into sync_locks (organization_id, store_id, resource, lock_id, acquired_at, expires_at, owner_run_id)
    values (
      ${input.organizationId},
      ${input.storeId},
      ${input.resource},
      ${input.lockId},
      now(),
      now() + make_interval(secs => ${input.ttlSeconds}),
      ${input.runId ?? null}
    )
    on conflict (store_id, resource) do update
       set organization_id = excluded.organization_id,
           lock_id = excluded.lock_id,
           acquired_at = now(),
           expires_at = excluded.expires_at,
           owner_run_id = excluded.owner_run_id
     where sync_locks.expires_at <= now()
    returning lock_id
  `);

  const returned = (rows as unknown as Array<{ lock_id: string }>)[0];
  return returned?.lock_id === input.lockId;
}

export async function renewSyncLock(
  db: DbExecutor,
  input: { storeId: string; resource: string; lockId: string; ttlSeconds: number },
): Promise<boolean> {
  const rows = await db
    .update(syncLocks)
    .set({ expiresAt: sql`now() + make_interval(secs => ${input.ttlSeconds})` })
    .where(
      and(
        eq(syncLocks.storeId, input.storeId),
        eq(syncLocks.resource, input.resource),
        eq(syncLocks.lockId, input.lockId),
      ),
    )
    .returning({ lockId: syncLocks.lockId });

  return rows.length > 0;
}

export async function releaseSyncLock(
  db: DbExecutor,
  input: { storeId: string; resource: string; lockId: string },
): Promise<void> {
  await db
    .delete(syncLocks)
    .where(
      and(
        eq(syncLocks.storeId, input.storeId),
        eq(syncLocks.resource, input.resource),
        eq(syncLocks.lockId, input.lockId),
      ),
    );
}

export async function insertSyncRun(
  db: DbExecutor,
  input: {
    organizationId: string;
    storeId: string;
    resource: SyncResource;
    correlationId: string;
    initiatedByUserId: string | null;
    trigger?: string;
  },
): Promise<SyncRun> {
  const [row] = await db
    .insert(syncRuns)
    .values({
      organizationId: input.organizationId,
      storeId: input.storeId,
      resource: input.resource,
      status: "running",
      correlationId: input.correlationId,
      trigger: input.trigger ?? "manual",
      initiatedByUserId: input.initiatedByUserId,
    })
    .returning();

  if (!row) throw new Error("insertSyncRun returned no row");
  return row;
}

export interface SyncRunDelta {
  pages?: number;
  items?: number;
  created?: number;
  updated?: number;
  linked?: number;
  skipped?: number;
}

export async function incrementSyncRun(
  db: DbExecutor,
  runId: string,
  delta: SyncRunDelta,
): Promise<void> {
  await db
    .update(syncRuns)
    .set({
      pagesProcessed: sql`${syncRuns.pagesProcessed} + ${delta.pages ?? 0}`,
      itemsProcessed: sql`${syncRuns.itemsProcessed} + ${delta.items ?? 0}`,
      itemsCreated: sql`${syncRuns.itemsCreated} + ${delta.created ?? 0}`,
      itemsUpdated: sql`${syncRuns.itemsUpdated} + ${delta.updated ?? 0}`,
      relationsLinked: sql`${syncRuns.relationsLinked} + ${delta.linked ?? 0}`,
      itemsSkipped: sql`${syncRuns.itemsSkipped} + ${delta.skipped ?? 0}`,
    })
    .where(eq(syncRuns.id, runId));
}

export async function finishSyncRun(
  db: DbExecutor,
  runId: string,
  input: { status: "succeeded" | "failed"; errorCode?: string | null },
): Promise<void> {
  await db
    .update(syncRuns)
    .set({
      status: input.status,
      errorCode: input.errorCode ?? null,
      finishedAt: new Date(),
    })
    .where(eq(syncRuns.id, runId));
}

export async function findLatestRun(
  db: DbExecutor,
  storeId: string,
  resource: SyncResource,
): Promise<SyncRun | undefined> {
  const [row] = await db
    .select()
    .from(syncRuns)
    .where(and(eq(syncRuns.storeId, storeId), eq(syncRuns.resource, resource)))
    .orderBy(desc(syncRuns.startedAt))
    .limit(1);
  return row;
}

export async function findLatestSuccessfulRun(
  db: DbExecutor,
  storeId: string,
): Promise<SyncRun | undefined> {
  const [row] = await db
    .select()
    .from(syncRuns)
    .where(and(eq(syncRuns.storeId, storeId), eq(syncRuns.status, "succeeded")))
    .orderBy(desc(syncRuns.finishedAt))
    .limit(1);
  return row;
}

export async function findRunningLock(
  db: DbExecutor,
  storeId: string,
  resource: SyncResource,
): Promise<boolean> {
  const [row] = await db
    .select({ lockId: syncLocks.lockId })
    .from(syncLocks)
    .where(
      and(
        eq(syncLocks.storeId, storeId),
        eq(syncLocks.resource, resource),
        sql`${syncLocks.expiresAt} > now()`,
      ),
    )
    .limit(1);
  return Boolean(row);
}

export async function findLatestRunWithStatus(
  db: DbExecutor,
  storeId: string,
  resource: SyncResource,
  status: "succeeded" | "failed",
): Promise<SyncRun | undefined> {
  const [row] = await db
    .select()
    .from(syncRuns)
    .where(
      and(
        eq(syncRuns.storeId, storeId),
        eq(syncRuns.resource, resource),
        eq(syncRuns.status, status),
      ),
    )
    .orderBy(desc(syncRuns.finishedAt))
    .limit(1);
  return row;
}
