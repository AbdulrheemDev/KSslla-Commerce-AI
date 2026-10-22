import { randomUUID } from "node:crypto";

import type { Database } from "@/db/client";
import type { StoreConnection } from "@/db/schema";
import { withTenantTransaction } from "@/db/tenant";
import { AppError, toAppError } from "@/lib/errors";
import { logger } from "@/lib/logger";
import { metrics } from "@/lib/metrics";
import { recordAudit } from "@/modules/audit/infrastructure/audit-repository";
import {
  DEFAULT_PAGE_SIZE,
  decideNextPage,
  pageSignature,
  type PageMeta,
} from "@/modules/catalog/domain/pagination";
import {
  DEFAULT_MAX_ATTEMPTS,
  fitsRetryBudget,
  retryDelayMs,
  shouldRetry,
} from "@/modules/catalog/domain/retry";
import { mapCategory, mapProduct } from "@/modules/catalog/domain/mappers";
import type {
  CatalogCategoryInput,
  CatalogProductInput,
  SyncResource,
} from "@/modules/catalog/domain/types";
import { upsertCategories } from "@/modules/catalog/infrastructure/category-repository";
import { upsertProducts } from "@/modules/catalog/infrastructure/product-repository";
import {
  acquireSyncLock,
  finishSyncRun,
  incrementSyncRun,
  insertSyncRun,
  releaseSyncLock,
  renewSyncLock,
} from "@/modules/catalog/infrastructure/sync-repository";
import { assertPermission } from "@/modules/identity/application/authorization";
import type { RequestMeta, TenantContext } from "@/modules/identity/application/types";
import { getAccessToken } from "@/modules/integrations/salla/application/token-manager";
import {
  sallaInvalidGrant,
  sallaInvalidResponse,
} from "@/modules/integrations/salla/domain/errors";
import { SALLA_CATALOG_SCOPES } from "@/modules/integrations/salla/domain/scopes";
import {
  createSallaCatalogClient,
  type SallaCatalogClient,
} from "@/modules/integrations/salla/infrastructure/catalog-client";
import {
  findConnectionByStore,
  markReauthRequired,
} from "@/modules/integrations/salla/infrastructure/connection-repository";
import { requireStoreAccess } from "@/modules/stores/application/store-service";
import {
  classifyProviderFailure as classify,
  providerFailureCode as failureCode,
} from "@/modules/sync/domain/failures";

/**
 * Catalogue sync use case.
 *
 * Ordering: categories before products, always. Products reference categories,
 * and a relation can only be written once both rows exist locally.
 *
 * Transactions: one per page. A page is an authoritative snapshot for the
 * objects it contains, so its rows, its links, and the run counters commit
 * together. Pages already committed stay committed if a later page fails; the
 * run is marked `failed`, and re-running is safe because every write is an
 * upsert keyed by the external id.
 *
 * Single flight: a database lease per (store, resource). Ten concurrent
 * requests produce one run and nine `SYNC_IN_PROGRESS` errors.
 *
 * Deletion: never. Salla documents no reliable enumeration of removed objects
 * through these list endpoints; `lastSeenAt` is recorded for a future phase.
 */

export const SYNC_LOCK_TTL_SECONDS = 120;
export const SYNC_PAGE_SIZE = DEFAULT_PAGE_SIZE;

/**
 * One catalogue lane per store: categories and products never run in parallel
 * for the same store, even when requested as separate calls. Future resources
 * (orders, customers) get their own lane.
 */
export const SYNC_LOCK_RESOURCE = "catalog";

interface SyncLockRef {
  storeId: string;
  resource: string;
  lockId: string;
}

export interface SyncRuntime {
  now: () => Date;
  sleep: (ms: number) => Promise<void>;
  createCatalogClient?: (accessToken: string) => SallaCatalogClient;
  pageSize?: number;
  /**
   * Actor recorded on the run and the audit entry.
   *
   * Manual syncs leave it undefined and the signed-in user is used. Background
   * work (webhook worker) passes `null`, because the system acted, not a person
   * — a synthetic user id would violate the `initiated_by_user_id` foreign key
   * and would misattribute the run.
   */
  actorUserId?: string | null;
  /** `manual` | `webhook` | `scheduler`; stored on `sync_runs.trigger`. */
  trigger?: string;
}

const defaultRuntime: SyncRuntime = {
  now: () => new Date(),
  sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
};

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

export interface SyncResult {
  runs: SyncOutcome[];
}

function missingScopes(connection: StoreConnection): string[] {
  return SALLA_CATALOG_SCOPES.filter((scope) => !connection.scopes.includes(scope));
}

function unusableConnection(connection: StoreConnection | undefined): AppError {
  return new AppError({
    code: "INTEGRATION_NOT_CONNECTED",
    message: "Connect this store to Salla before syncing catalogue data.",
    details: { connectionStatus: connection?.status ?? "not_connected" },
  });
}

export async function syncStore(
  db: Database,
  context: TenantContext,
  input: { storeId: string; resource: SyncResource | "all" },
  meta: RequestMeta,
  runtime: Partial<SyncRuntime> = {},
): Promise<SyncResult> {
  assertPermission(context, "store:sync");
  await requireStoreAccess(db, context, input.storeId);

  const resolved: SyncRuntime = { ...defaultRuntime, ...runtime };
  const resources: SyncResource[] =
    input.resource === "all" ? ["categories", "products"] : [input.resource];
  const connection = await requireUsableConnection(db, context, input.storeId);

  // The lease spans the whole request, so `all` cannot interleave with a
  // products-only or categories-only request from another tab.
  const lock: SyncLockRef = {
    storeId: input.storeId,
    resource: SYNC_LOCK_RESOURCE,
    lockId: randomUUID(),
  };

  const acquired = await withTenantTransaction(
    db,
    { userId: context.userId, organizationId: context.organizationId },
    (tx) =>
      acquireSyncLock(tx, {
        organizationId: context.organizationId,
        storeId: input.storeId,
        lockId: lock.lockId,
        resource: lock.resource,
        ttlSeconds: SYNC_LOCK_TTL_SECONDS,
      }),
  );

  if (!acquired) {
    throw new AppError({
      code: "CONFLICT",
      message: "A sync is already running for this store. Try again shortly.",
      retryable: true,
      details: { reason: "sync_in_progress" },
    });
  }

  try {
    const runs: SyncOutcome[] = [];
    for (const resource of resources) {
      runs.push(
        await runOneResource(
          db,
          context,
          { storeId: input.storeId, resource, connection, lock },
          meta,
          resolved,
        ),
      );
    }

    return { runs };
  } finally {
    await releaseLock(db, context, lock);
  }
}

async function requireUsableConnection(
  db: Database,
  context: TenantContext,
  storeId: string,
): Promise<StoreConnection> {
  const connection = await withTenantTransaction(
    db,
    { userId: context.userId, organizationId: context.organizationId },
    (tx) => findConnectionByStore(tx, storeId),
  );

  if (!connection || (connection.status !== "connected" && connection.status !== "refreshing")) {
    throw unusableConnection(connection);
  }

  const missing = missingScopes(connection);
  if (missing.length > 0) {
    throw new AppError({
      code: "INTEGRATION_AUTH_REQUIRED",
      message: "Reconnect this store to grant access to products and categories.",
      details: { reason: "missing_scope", missingScopes: missing },
    });
  }

  return connection;
}

async function runOneResource(
  db: Database,
  context: TenantContext,
  input: {
    storeId: string;
    resource: SyncResource;
    connection: StoreConnection;
    lock: SyncLockRef;
  },
  meta: RequestMeta,
  runtime: SyncRuntime,
): Promise<SyncOutcome> {
  const { storeId, resource, connection, lock } = input;
  const correlationId = randomUUID();

  const run = await withTenantTransaction(
    db,
    { userId: context.userId, organizationId: context.organizationId },
    (tx) =>
      insertSyncRun(tx, {
        organizationId: context.organizationId,
        storeId,
        resource,
        correlationId,
        initiatedByUserId: runtime.actorUserId === undefined ? context.userId : runtime.actorUserId,
        trigger: runtime.trigger,
      }),
  );

  const startedAt = Date.now();
  const auditBase = {
    organizationId: context.organizationId,
    actorUserId: runtime.actorUserId === undefined ? context.userId : runtime.actorUserId,
    entityType: "store" as const,
    entityId: storeId,
    ipHash: meta.ipHash,
    userAgent: meta.userAgent,
    requestId: meta.requestId,
  };

  await withTenantTransaction(
    db,
    { userId: context.userId, organizationId: context.organizationId },
    (tx) =>
      recordAudit(tx, {
        ...auditBase,
        action:
          resource === "products" ? "salla.products.sync_started" : "salla.categories.sync_started",
        metadata: { provider: "salla", resource, syncRunId: run.id, correlationId },
      }),
  );

  let outcome: SyncOutcome;

  try {
    outcome = await fetchAllPages(db, context, {
      storeId,
      resource,
      runId: run.id,
      correlationId,
      startedAt,
      connection,
      lock,
      runtime,
    });
  } catch (error) {
    const code = failureCode(error);

    await withTenantTransaction(
      db,
      { userId: context.userId, organizationId: context.organizationId },
      async (tx) => {
        await finishSyncRun(tx, run.id, { status: "failed", errorCode: code });
        await recordAudit(tx, {
          ...auditBase,
          action:
            resource === "products" ? "salla.products.sync_failed" : "salla.categories.sync_failed",
          metadata: {
            provider: "salla",
            resource,
            syncRunId: run.id,
            correlationId,
            errorCode: code,
          },
        });
      },
    );

    metrics.increment("sync.runs", { resource, status: "failed" });
    metrics.increment("sync.failures", { resource });
    metrics.observe("sync.duration_ms", Date.now() - startedAt, {
      resource,
      status: "failed",
    });

    logger.warn(
      {
        event: "catalog.sync.failed",
        correlationId,
        organizationId: context.organizationId,
        storeId,
        connectionId: connection.id,
        syncRunId: run.id,
        resource,
        errorCode: code,
        durationMs: Date.now() - startedAt,
      },
      "catalogue sync failed",
    );

    throw toAppError(error, "The catalogue sync failed.");
  }

  await withTenantTransaction(
    db,
    { userId: context.userId, organizationId: context.organizationId },
    async (tx) => {
      await finishSyncRun(tx, run.id, { status: "succeeded" });
      await recordAudit(tx, {
        ...auditBase,
        action:
          resource === "products"
            ? "salla.products.sync_completed"
            : "salla.categories.sync_completed",
        metadata: {
          provider: "salla",
          resource,
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

  metrics.increment("sync.runs", { resource, status: "succeeded" });
  metrics.observe("sync.duration_ms", Date.now() - startedAt, {
    resource,
    status: "succeeded",
  });

  logger.info(
    {
      event: "catalog.sync.completed",
      correlationId,
      organizationId: context.organizationId,
      storeId,
      connectionId: connection.id,
      syncRunId: run.id,
      resource,
      pages: outcome.pages,
      items: outcome.items,
      durationMs: Date.now() - startedAt,
    },
    "catalogue sync completed",
  );

  return outcome;
}

async function releaseLock(db: Database, context: TenantContext, lock: SyncLockRef): Promise<void> {
  await withTenantTransaction(
    db,
    { userId: context.userId, organizationId: context.organizationId },
    (tx) => releaseSyncLock(tx, lock),
  );
}

interface PageResult {
  items: CatalogProductInput[] | CatalogCategoryInput[];
  meta: PageMeta;
}

async function fetchAllPages(
  db: Database,
  context: TenantContext,
  input: {
    storeId: string;
    resource: SyncResource;
    runId: string;
    correlationId: string;
    startedAt: number;
    connection: StoreConnection;
    lock: SyncLockRef;
    runtime: SyncRuntime;
  },
): Promise<SyncOutcome> {
  const { storeId, resource, runId, correlationId, connection, lock, runtime } = input;
  const pageSize = runtime.pageSize ?? SYNC_PAGE_SIZE;
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
    runtime.createCatalogClient
      ? runtime.createCatalogClient(accessToken)
      : createSallaCatalogClient({ accessToken });

  let client = clientFor(first.accessToken);

  for (;;) {
    const result = await fetchPageWithRetry({
      client,
      resource,
      page,
      pageSize,
      runtime,
      onAuthError: async () => {
        if (authRetried) {
          await markCatalogReauth(db, context, connection.id);
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

    const externalIds = result.items.map((item) => item.externalId);
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

    const counters = await withTenantTransaction(
      db,
      { userId: context.userId, organizationId: context.organizationId },
      async (tx) => {
        if (resource === "categories") {
          const categories = result.items as CatalogCategoryInput[];
          const written = await upsertCategories(tx, {
            organizationId: context.organizationId,
            storeId,
            items: categories,
            seenAt: runtime.now(),
          });

          await incrementSyncRun(tx, runId, {
            pages: 1,
            items: categories.length,
            created: written.created,
            updated: written.updated,
          });

          return {
            count: categories.length,
            created: written.created,
            updated: written.updated,
            linked: 0,
            skipped: 0,
          };
        }

        const products = result.items as CatalogProductInput[];
        const written = await upsertProducts(tx, {
          organizationId: context.organizationId,
          storeId,
          items: products,
          seenAt: runtime.now(),
        });

        await incrementSyncRun(tx, runId, {
          pages: 1,
          items: products.length,
          created: written.created,
          updated: written.updated,
          linked: written.linked,
          skipped: written.skippedRelations,
        });

        return {
          count: products.length,
          created: written.created,
          updated: written.updated,
          linked: written.linked,
          skipped: written.skippedRelations,
        };
      },
    );

    pages += 1;
    items += counters.count;
    created += counters.created;
    updated += counters.updated;
    linked += counters.linked;
    skipped += counters.skipped;

    metrics.increment("sync.pages", { resource });
    metrics.increment("sync.items", { resource }, counters.count);

    logger.info(
      {
        event: "catalog.sync.page",
        correlationId,
        organizationId: context.organizationId,
        storeId,
        connectionId: connection.id,
        syncRunId: runId,
        resource,
        page,
        items: counters.count,
        durationMs: Date.now() - input.startedAt,
      },
      "catalogue sync page persisted",
    );

    const renewed = await withTenantTransaction(
      db,
      { userId: context.userId, organizationId: context.organizationId },
      (tx) => renewSyncLock(tx, { ...lock, ttlSeconds: SYNC_LOCK_TTL_SECONDS }),
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
    resource,
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

async function fetchPageWithRetry(input: {
  client: SallaCatalogClient;
  resource: SyncResource;
  page: number;
  pageSize: number;
  runtime: SyncRuntime;
  onAuthError: () => Promise<SallaCatalogClient | null>;
}): Promise<PageResult> {
  let attempt = 0;
  let client = input.client;

  for (;;) {
    try {
      if (input.resource === "categories") {
        const page = await client.listCategories({ page: input.page, perPage: input.pageSize });
        metrics.increment("salla.requests", { endpoint: "categories" });
        return { items: page.items.map(mapCategory), meta: page.meta };
      }

      const page = await client.listProducts({ page: input.page, perPage: input.pageSize });
      metrics.increment("salla.requests", { endpoint: "products" });
      return { items: page.items.map(mapProduct), meta: page.meta };
    } catch (error) {
      const classified = classify(error);

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

/** Marks the connection as requiring a human when a refreshed token is rejected. */
export async function markCatalogReauth(
  db: Database,
  context: TenantContext,
  connectionId: string,
): Promise<void> {
  await withTenantTransaction(
    db,
    { userId: context.userId, organizationId: context.organizationId },
    (tx) => markReauthRequired(tx, connectionId, "catalog_unauthorized"),
  );
}
