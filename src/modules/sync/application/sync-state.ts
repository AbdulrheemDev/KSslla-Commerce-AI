import type { Database } from "@/db/client";
import type { SyncRun } from "@/db/schema";
import { withTenantTransaction } from "@/db/tenant";
import type {
  SyncResource,
  SyncResourceState,
  SyncRunSummary,
} from "@/modules/catalog/domain/types";
import {
  findLatestRun,
  findLatestRunWithStatus,
  findRunningLock,
} from "@/modules/catalog/infrastructure/sync-repository";
import type { TenantContext } from "@/modules/identity/application/types";

/**
 * Sync state for every resource, from the existing `sync_runs` table.
 *
 * Phase 04 introduced this shape for products and categories. Phase 05 extends
 * it to customers, orders, and inventory by adding resources to the existing
 * table — there is no second state store, so the two cannot drift.
 *
 * `status: "running"` is decided by the database lease, not by a stale row:
 * a crashed run whose lease expired reports its real outcome.
 */

export function toRunSummary(run: SyncRun): SyncRunSummary {
  return {
    id: run.id,
    resource: run.resource as SyncResource,
    status: run.status as SyncRunSummary["status"],
    correlationId: run.correlationId,
    itemsProcessed: run.itemsProcessed,
    itemsCreated: run.itemsCreated,
    itemsUpdated: run.itemsUpdated,
    relationsLinked: run.relationsLinked,
    itemsSkipped: run.itemsSkipped,
    pagesProcessed: run.pagesProcessed,
    errorCode: run.errorCode,
    startedAt: run.startedAt.toISOString(),
    finishedAt: run.finishedAt?.toISOString() ?? null,
  };
}

export async function resolveResourceState(
  db: Database,
  context: TenantContext,
  storeId: string,
  resource: SyncResource,
): Promise<SyncResourceState> {
  return withTenantTransaction(
    db,
    { userId: context.userId, organizationId: context.organizationId },
    async (tx) => {
      const [latest, success, failure, running] = await Promise.all([
        findLatestRun(tx, storeId, resource),
        findLatestRunWithStatus(tx, storeId, resource, "succeeded"),
        findLatestRunWithStatus(tx, storeId, resource, "failed"),
        findRunningLock(tx, storeId, resource),
      ]);

      const status: SyncResourceState["status"] = running
        ? "running"
        : !latest
          ? "never"
          : latest.status === "running"
            ? "running"
            : latest.status === "succeeded"
              ? "succeeded"
              : "failed";

      return {
        resource,
        status,
        lastRun: latest ? toRunSummary(latest) : null,
        lastStartedAt: latest?.startedAt.toISOString() ?? null,
        lastCompletedAt: latest?.finishedAt?.toISOString() ?? null,
        lastSuccessAt: success?.finishedAt?.toISOString() ?? null,
        lastFailureAt: failure?.finishedAt?.toISOString() ?? null,
        lastErrorCode: latest?.errorCode ?? null,
      };
    },
  );
}
