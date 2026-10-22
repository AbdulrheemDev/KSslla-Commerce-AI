import { and, eq, gte, sql } from "drizzle-orm";

import type { Database } from "@/db/client";
import { syncRuns } from "@/db/schema";
import { withTenantTransaction } from "@/db/tenant";
import type { RequestMeta } from "@/modules/identity/application/types";
import { syncStore, type SyncOutcome } from "@/modules/catalog/application/sync-service";
import { syncStoreData } from "@/modules/sync/application/store-data-sync-service";
import { systemTenantContext } from "@/modules/sync/application/system-context";

/**
 * One entry point for "refresh a resource for a store".
 *
 * Manual syncs call their services directly today; the webhook worker calls
 * this facade so the event → resource → sync mapping lives in exactly one
 * place. A future scheduler or reconciliation pass will call the same function
 * instead of growing a third code path (ADR-048).
 *
 * Coalescing: if a run for the same (store, resource) already **succeeded**
 * at or after the event arrived, that run read the provider after the change
 * and the event is covered — no second run, no duplicate API spend.
 *
 * Only succeeded runs count. A failed or in-flight attempt proves nothing about
 * the provider's state, and treating it as coverage would silently swallow the
 * event that the retry policy is supposed to deliver.
 */

export type EngineResource = "products" | "categories" | "orders" | "customers" | "inventory";

export interface EngineRequest {
  db: Database;
  organizationId: string;
  storeId: string;
  resource: EngineResource;
  meta: RequestMeta;
  /** Skip the run when a sync for this resource started at or after this time. */
  notBefore?: Date;
  trigger?: string;
}

export type EngineOutcome =
  { action: "synced"; run: SyncOutcome } | { action: "covered"; since: string };

async function lastRunStartedAt(request: EngineRequest, since: Date): Promise<string | null> {
  const row = await withTenantTransaction(
    request.db,
    { organizationId: request.organizationId },
    (tx) =>
      tx
        .select({ startedAt: syncRuns.startedAt })
        .from(syncRuns)
        .where(
          and(
            eq(syncRuns.organizationId, request.organizationId),
            eq(syncRuns.storeId, request.storeId),
            eq(syncRuns.resource, request.resource),
            eq(syncRuns.status, "succeeded"),
            gte(syncRuns.startedAt, since),
          ),
        )
        .orderBy(sql`${syncRuns.startedAt} desc`)
        .limit(1)
        .then((rows) => rows[0] ?? null),
  );

  return row?.startedAt ? row.startedAt.toISOString() : null;
}

export async function runResourceSync(request: EngineRequest): Promise<EngineOutcome> {
  if (request.notBefore) {
    const since = await lastRunStartedAt(request, request.notBefore);
    if (since) return { action: "covered", since };
  }

  const context = systemTenantContext(request.organizationId);
  const runtime = { actorUserId: null, trigger: request.trigger ?? "webhook" };

  if (request.resource === "products" || request.resource === "categories") {
    const result = await syncStore(
      request.db,
      context,
      { storeId: request.storeId, resource: request.resource },
      request.meta,
      runtime,
    );

    const run = result.runs.find((entry) => entry.resource === request.resource) ?? result.runs[0];
    return { action: "synced", run: run as SyncOutcome };
  }

  const result = await syncStoreData(
    request.db,
    context,
    { storeId: request.storeId, resource: request.resource },
    request.meta,
    runtime,
  );

  const run = result.runs.find((entry) => entry.resource === request.resource) ?? result.runs[0];
  return { action: "synced", run: run as SyncOutcome };
}
