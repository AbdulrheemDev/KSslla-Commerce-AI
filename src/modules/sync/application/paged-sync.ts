import { randomUUID } from "node:crypto";

import type { Database } from "@/db/client";
import type { DbExecutor } from "@/db/executor";
import type { StoreConnection } from "@/db/schema";
import { withTenantTransaction } from "@/db/tenant";
import { AppError } from "@/lib/errors";
import { logger } from "@/lib/logger";
import { metrics } from "@/lib/metrics";
import { recordAudit, type AuditAction } from "@/modules/audit/infrastructure/audit-repository";
import { decideNextPage, pageSignature, type PageMeta } from "@/modules/catalog/domain/pagination";
import {
  DEFAULT_MAX_ATTEMPTS,
  fitsRetryBudget,
  retryDelayMs,
  shouldRetry,
} from "@/modules/catalog/domain/retry";
import type { SyncResource } from "@/modules/catalog/domain/types";
import {
  acquireSyncLock,
  finishSyncRun,
  incrementSyncRun,
  insertSyncRun,
  releaseSyncLock,
  renewSyncLock,
} from "@/modules/catalog/infrastructure/sync-repository";
import type { RequestMeta, TenantContext } from "@/modules/identity/application/types";
import { getAccessToken } from "@/modules/integrations/salla/application/token-manager";
import {
  sallaInvalidGrant,
  sallaInvalidResponse,
} from "@/modules/integrations/salla/domain/errors";
import {
  createSallaCommerceClient,
  type SallaCommerceClient,
} from "@/modules/integrations/salla/infrastructure/commerce-client";
import { markReauthRequired } from "@/modules/integrations/salla/infrastructure/connection-repository";
import {
  classifyProviderFailure,
  normalizeProviderError,
  providerFailureCode,
} from "@/modules/sync/domain/failures";

/**
 * Shared paged read-sync runner.
 *
 * One implementation of the parts every resource needs, so no endpoint grows
 * its own HTTP, retry, or page-walking logic:
 *
 * - one `sync_runs` row per resource per run, with start/complete/fail audit;
 * - the existing database lease, renewed after every page;
 * - one transaction per page (a page is authoritative for the rows it holds);
 * - sequential page walking driven by the provider's `pagination` envelope;
 * - bounded retry, exact `Retry-After`, and a single token refresh on 401;
 * - a documented-window stop (`sequentialWindowMs`) for Orders.
 *
 * A partial failure never aborts the run by itself: the resource adapter decides
 * what `persistPage` does with a bad record. System-level failures (auth,
 * network, contract, tenant, transaction) throw and end the run.
 */

export const SEQUENTIAL_WINDOW_MS = 15 * 60 * 1000;

export interface PageCounters {
  created: number;
  updated: number;
  linked: number;
  skipped: number;
}

export interface PageResult<T> {
  items: T[];
  meta: PageMeta;
}

export interface DataSyncRuntime {
  now: () => Date;
  sleep: (ms: number) => Promise<void>;
  createClient?: (accessToken: string) => SallaCommerceClient;
}

export const defaultDataSyncRuntime: DataSyncRuntime = {
  now: () => new Date(),
  sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
};

export interface PagedSyncSpec<T> {
  resource: SyncResource;
  perPage: number;
  /** Stop before crossing the provider's documented sequential-read window. */
  sequentialWindowMs?: number;
  /** Audit action prefix, e.g. `salla.orders`. */
  auditPrefix: string;
  fetchPage: (client: SallaCommerceClient, page: number) => Promise<PageResult<T>>;
  /** Stable provider identity used for the repeated-page guard. */
  externalIdOf: (item: T) => string;
  persistPage: (tx: DbExecutor, items: readonly T[], seenAt: Date) => Promise<PageCounters>;
}

export interface SyncOutcome {
  resource: SyncResource;
  runId: string;
  status: "succeeded" | "failed";
  pages: number;
  items: number;
  created: number;
  updated: number;
  linked: number;
  skipped: number;
}

export interface DataSyncLock {
  storeId: string;
  resource: SyncResource;
  lockId: string;
}

/** Acquires one database lease per (store, resource). */
export async function acquireDataSyncLock(
  db: Database,
  context: TenantContext,
  input: { storeId: string; resource: SyncResource; ttlSeconds: number; runId?: string | null },
): Promise<DataSyncLock> {
  const lock: DataSyncLock = {
    storeId: input.storeId,
    resource: input.resource,
    lockId: randomUUID(),
  };

  const acquired = await withTenantTransaction(
    db,
    { userId: context.userId, organizationId: context.organizationId },
    (tx) =>
      acquireSyncLock(tx, {
        organizationId: context.organizationId,
        storeId: input.storeId,
        resource: input.resource,
        lockId: lock.lockId,
        ttlSeconds: input.ttlSeconds,
        runId: input.runId ?? null,
      }),
  );

  if (!acquired) {
    throw new AppError({
      code: "CONFLICT",
      message: "A sync is already running for this store. Try again shortly.",
      retryable: true,
      details: { reason: "sync_in_progress", resource: input.resource },
    });
  }

  return lock;
}

export async function releaseDataSyncLock(
  db: Database,
  context: TenantContext,
  lock: DataSyncLock,
): Promise<void> {
  await withTenantTransaction(
    db,
    { userId: context.userId, organizationId: context.organizationId },
    (tx) => releaseSyncLock(tx, lock),
  );
}

export async function runPagedSync<T>(
  input: {
    db: Database;
    context: TenantContext;
    storeId: string;
    connection: StoreConnection;
    lock: DataSyncLock;
    meta: RequestMeta;
    runtime: DataSyncRuntime;
    ttlSeconds: number;
  },
  spec: PagedSyncSpec<T>,
): Promise<SyncOutcome> {
  const { db, context, storeId, connection, meta } = input;
  const correlationId = randomUUID();

  const run = await withTenantTransaction(
    db,
    { userId: context.userId, organizationId: context.organizationId },
    (tx) =>
      insertSyncRun(tx, {
        organizationId: context.organizationId,
        storeId,
        resource: spec.resource,
        correlationId,
        initiatedByUserId: context.userId,
      }),
  );

  const startedAt = Date.now();
  const auditBase = {
    organizationId: context.organizationId,
    actorUserId: context.userId,
    entityType: "store" as const,
    entityId: storeId,
    ipHash: meta.ipHash,
    userAgent: meta.userAgent,
    requestId: meta.requestId,
  };
  const auditAction = (suffix: "started" | "completed" | "failed"): AuditAction =>
    `${spec.auditPrefix}.sync_${suffix}` as AuditAction;

  await withTenantTransaction(
    db,
    { userId: context.userId, organizationId: context.organizationId },
    (tx) =>
      recordAudit(tx, {
        ...auditBase,
        action: auditAction("started"),
        metadata: {
          provider: "salla",
          resource: spec.resource,
          syncRunId: run.id,
          correlationId,
        },
      }),
  );

  try {
    const outcome = await fetchAllPages(
      { ...input, correlationId, runId: run.id, startedAt, auditAction },
      spec,
    );

    await withTenantTransaction(
      db,
      { userId: context.userId, organizationId: context.organizationId },
      async (tx) => {
        await finishSyncRun(tx, run.id, { status: "succeeded" });
        await recordAudit(tx, {
          ...auditBase,
          action: auditAction("completed"),
          metadata: {
            provider: "salla",
            resource: spec.resource,
            syncRunId: run.id,
            correlationId,
            pages: outcome.pages,
            items: outcome.items,
            created: outcome.created,
            updated: outcome.updated,
            linked: outcome.linked,
            skipped: outcome.skipped,
          },
        });
      },
    );

    metrics.increment("sync.runs", { resource: spec.resource, status: "succeeded" });
    metrics.observe("sync.duration_ms", Date.now() - startedAt, {
      resource: spec.resource,
      status: "succeeded",
    });

    logger.info(
      {
        event: "data.sync.completed",
        correlationId,
        organizationId: context.organizationId,
        storeId,
        connectionId: connection.id,
        syncRunId: run.id,
        resource: spec.resource,
        pages: outcome.pages,
        items: outcome.items,
        durationMs: Date.now() - startedAt,
      },
      "data sync completed",
    );

    return outcome;
  } catch (error) {
    const code = providerFailureCode(error);

    await withTenantTransaction(
      db,
      { userId: context.userId, organizationId: context.organizationId },
      async (tx) => {
        await finishSyncRun(tx, run.id, { status: "failed", errorCode: code });
        await recordAudit(tx, {
          ...auditBase,
          action: auditAction("failed"),
          metadata: {
            provider: "salla",
            resource: spec.resource,
            syncRunId: run.id,
            correlationId,
            errorCode: code,
          },
        });
      },
    );

    metrics.increment("sync.runs", { resource: spec.resource, status: "failed" });
    metrics.increment("sync.failures", { resource: spec.resource });
    metrics.observe("sync.duration_ms", Date.now() - startedAt, {
      resource: spec.resource,
      status: "failed",
    });

    logger.warn(
      {
        event: "data.sync.failed",
        correlationId,
        organizationId: context.organizationId,
        storeId,
        connectionId: connection.id,
        syncRunId: run.id,
        resource: spec.resource,
        errorCode: code,
        durationMs: Date.now() - startedAt,
      },
      "data sync failed",
    );

    throw normalizeProviderError(error);
  }
}

async function fetchAllPages<T>(
  input: {
    db: Database;
    context: TenantContext;
    storeId: string;
    connection: StoreConnection;
    lock: DataSyncLock;
    runtime: DataSyncRuntime;
    ttlSeconds: number;
    correlationId: string;
    runId: string;
    startedAt: number;
    auditAction: (suffix: "started" | "completed" | "failed") => AuditAction;
  },
  spec: PagedSyncSpec<T>,
): Promise<SyncOutcome> {
  const { db, context, storeId, connection, lock, runtime, ttlSeconds, runId, correlationId } =
    input;
  const windowStart = Date.now();
  const seen = new Set<string>();

  let page = 1;
  let pages = 0;
  let items = 0;
  let created = 0;
  let updated = 0;
  let linked = 0;
  let skipped = 0;
  let authRetried = false;

  const first = await getAccessToken(db, {
    organizationId: context.organizationId,
    connectionId: connection.id,
  });

  const clientFor = (accessToken: string) =>
    runtime.createClient
      ? runtime.createClient(accessToken)
      : createSallaCommerceClient({ accessToken });

  let client = clientFor(first.accessToken);

  for (;;) {
    if (spec.sequentialWindowMs && Date.now() - windowStart > spec.sequentialWindowMs) {
      // Salla documents that a sequential read must finish inside 15 minutes.
      // Stopping is correct: continuing would read a cache that may have moved.
      throw sallaInvalidResponse("pagination.sequential_window_exceeded");
    }

    const result = await fetchPageWithRetry({
      client,
      runtime,
      page,
      perPage: spec.perPage,
      resource: spec.resource,
      fetchPage: spec.fetchPage,
      onAuthError: async () => {
        if (authRetried) {
          await markDataReauth(db, context, connection.id);
          return null;
        }
        authRetried = true;
        const refreshed = await getAccessToken(
          db,
          { organizationId: context.organizationId, connectionId: connection.id },
          { forceRefresh: true },
        );
        client = clientFor(refreshed.accessToken);
        return client;
      },
    });

    const externalIds = result.items.map((item) => spec.externalIdOf(item));
    const decision = decideNextPage({
      requestedPage: page,
      meta: result.meta,
      receivedIds: externalIds,
      seenSignatures: seen,
      pagesProcessed: pages,
    });

    if (decision.failure) {
      throw sallaInvalidResponse(`pagination.${decision.failure}`);
    }

    if (externalIds.length > 0) seen.add(pageSignature(externalIds));

    const seenAt = runtime.now();
    const counters = await withTenantTransaction(
      db,
      { userId: context.userId, organizationId: context.organizationId },
      async (tx) => {
        const written = await spec.persistPage(tx, result.items, seenAt);
        await incrementSyncRun(tx, runId, {
          pages: 1,
          items: result.items.length,
          created: written.created,
          updated: written.updated,
          linked: written.linked,
          skipped: written.skipped,
        });
        return written;
      },
    );

    pages += 1;
    items += result.items.length;
    created += counters.created;
    updated += counters.updated;
    linked += counters.linked;
    skipped += counters.skipped;

    metrics.increment("sync.pages", { resource: spec.resource });
    metrics.increment("sync.items", { resource: spec.resource }, result.items.length);

    logger.info(
      {
        event: "data.sync.page",
        correlationId,
        organizationId: context.organizationId,
        storeId,
        connectionId: connection.id,
        syncRunId: runId,
        resource: spec.resource,
        page,
        items: result.items.length,
        durationMs: Date.now() - input.startedAt,
      },
      "data sync page persisted",
    );

    const renewed = await withTenantTransaction(
      db,
      { userId: context.userId, organizationId: context.organizationId },
      (tx) => renewSyncLock(tx, { ...lock, ttlSeconds }),
    );

    if (!renewed) {
      throw new AppError({
        code: "CONFLICT",
        message: "The sync lease was lost before the run finished.",
        retryable: true,
        details: { reason: "lease_lost" },
      });
    }

    if (decision.nextPage === null) break;
    page = decision.nextPage;
  }

  return {
    resource: spec.resource,
    runId,
    status: "succeeded",
    pages,
    items,
    created,
    updated,
    linked,
    skipped,
  };
}

async function fetchPageWithRetry<T>(input: {
  client: SallaCommerceClient;
  runtime: DataSyncRuntime;
  page: number;
  perPage: number;
  resource: SyncResource;
  fetchPage: PagedSyncSpec<T>["fetchPage"];
  onAuthError: () => Promise<SallaCommerceClient | null>;
}): Promise<PageResult<T>> {
  let attempt = 0;
  let client = input.client;

  for (;;) {
    try {
      const page = await input.fetchPage(client, input.page);
      metrics.increment("salla.requests", { endpoint: input.resource });
      return page;
    } catch (error) {
      const classified = classifyProviderFailure(error);

      if (classified?.kind === "rate_limited") {
        metrics.increment("salla.rate_limits", { endpoint: input.resource });
      }

      if (classified?.kind === "auth") {
        const refreshed = await input.onAuthError();
        if (!refreshed) throw sallaInvalidGrant();
        client = refreshed;
        continue;
      }

      if (
        classified &&
        shouldRetry({ kind: classified.kind, attempt, maxAttempts: DEFAULT_MAX_ATTEMPTS })
      ) {
        if (!fitsRetryBudget(classified.retryAfterSeconds)) {
          // The provider asked for longer than this run may wait; retrying
          // earlier would violate Retry-After.
          throw error;
        }

        await input.runtime.sleep(
          retryDelayMs({ attempt, retryAfterSeconds: classified.retryAfterSeconds }),
        );
        attempt += 1;
        continue;
      }

      throw error;
    }
  }
}

async function markDataReauth(
  db: Database,
  context: TenantContext,
  connectionId: string,
): Promise<void> {
  await withTenantTransaction(
    db,
    { userId: context.userId, organizationId: context.organizationId },
    (tx) => markReauthRequired(tx, connectionId, "data_unauthorized"),
  );
}
