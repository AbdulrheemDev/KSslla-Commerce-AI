import type { Database } from "@/db/client";
import type { StoreConnection } from "@/db/schema";
import { withTenantTransaction } from "@/db/tenant";
import { AppError } from "@/lib/errors";
import {
  SYNC_RESOURCES,
  type SyncResource,
  type SyncResourceState,
} from "@/modules/catalog/domain/types";
import { countCategories } from "@/modules/catalog/infrastructure/category-repository";
import { countProducts } from "@/modules/catalog/infrastructure/product-repository";
import { syncCustomers } from "@/modules/customers/application/customer-sync-service";
import { countCustomers } from "@/modules/customers/infrastructure/customer-repository";
import { assertPermission } from "@/modules/identity/application/authorization";
import type { RequestMeta, TenantContext } from "@/modules/identity/application/types";
import { syncInventory } from "@/modules/inventory/application/inventory-sync-service";
import { inventorySummary } from "@/modules/inventory/infrastructure/inventory-repository";
import { syncOrders } from "@/modules/orders/application/order-sync-service";
import { countOrderItems, orderStats } from "@/modules/orders/infrastructure/order-repository";
import { requireStoreAccess } from "@/modules/stores/application/store-service";
import {
  acquireDataSyncLock,
  defaultDataSyncRuntime,
  releaseDataSyncLock,
  type DataSyncLock,
  type DataSyncRuntime,
  type SyncOutcome,
} from "@/modules/sync/application/paged-sync";
import { resolveResourceState } from "@/modules/sync/application/sync-state";
import {
  findConnectionByStore,
  markReauthRequired,
} from "@/modules/integrations/salla/infrastructure/connection-repository";
import {
  SALLA_CUSTOMER_SCOPES,
  SALLA_INVENTORY_SCOPES,
  SALLA_ORDER_SCOPES,
} from "@/modules/integrations/salla/domain/scopes";

/**
 * Orchestrator for the Phase 05 read syncs.
 *
 * Order is fixed: **customers → orders → inventory**. Orders link to customers,
 * and inventory links to products, so a resource never runs before the data it
 * depends on. `all` is the same three resources in the same order, not a
 * parallel fan-out: every resource shares the store's provider rate limit.
 *
 * Concurrency is guarded by one database lease per (store, resource). `all`
 * takes all three leases in a fixed order, so it cannot interleave with a
 * single-resource request, and a lock failure releases what it already holds
 * instead of leaving the store wedged. Nothing here keeps state in memory.
 */

export const DATA_SYNC_RESOURCES = ["customers", "orders", "inventory"] as const;
export type DataSyncResource = (typeof DATA_SYNC_RESOURCES)[number];
export type DataSyncRequest = DataSyncResource | "all";

export const DATA_SYNC_LOCK_TTL_SECONDS = 120;

const SCOPES_BY_RESOURCE: Record<DataSyncResource, readonly string[]> = {
  customers: SALLA_CUSTOMER_SCOPES,
  orders: SALLA_ORDER_SCOPES,
  inventory: SALLA_INVENTORY_SCOPES,
};

function requestedResources(request: DataSyncRequest): DataSyncResource[] {
  return request === "all" ? [...DATA_SYNC_RESOURCES] : [request];
}

async function requireUsableConnection(
  db: Database,
  context: TenantContext,
  storeId: string,
  resources: readonly DataSyncResource[],
): Promise<StoreConnection> {
  const connection = await withTenantTransaction(
    db,
    { userId: context.userId, organizationId: context.organizationId },
    (tx) => findConnectionByStore(tx, storeId),
  );

  if (!connection || (connection.status !== "connected" && connection.status !== "refreshing")) {
    throw new AppError({
      code: "INTEGRATION_NOT_CONNECTED",
      message: "Connect this store to Salla before syncing data.",
      details: { connectionStatus: connection?.status ?? "not_connected" },
    });
  }

  const required = [...new Set(resources.flatMap((resource) => SCOPES_BY_RESOURCE[resource]))];
  const missing = required.filter((scope) => !connection.scopes.includes(scope));

  if (missing.length > 0) {
    // Documented: a missing scope is indistinguishable from an expired token on
    // the API side, so the fix is an explicit re-link — the existing path.
    throw new AppError({
      code: "INTEGRATION_AUTH_REQUIRED",
      message: "Reconnect this store to grant access to orders, customers, and inventory.",
      details: { reason: "missing_scope", missingScopes: missing },
    });
  }

  return connection;
}

export async function syncStoreData(
  db: Database,
  context: TenantContext,
  input: { storeId: string; resource: DataSyncRequest; fromDate?: string; toDate?: string },
  meta: RequestMeta,
  runtime: Partial<DataSyncRuntime> = {},
): Promise<{ runs: SyncOutcome[] }> {
  assertPermission(context, "store:sync");
  await requireStoreAccess(db, context, input.storeId);

  const resources = requestedResources(input.resource);
  const connection = await requireUsableConnection(db, context, input.storeId, resources);
  const resolved: DataSyncRuntime = { ...defaultDataSyncRuntime, ...runtime };

  const locks: DataSyncLock[] = [];

  try {
    for (const resource of resources) {
      locks.push(
        await acquireDataSyncLock(db, context, {
          storeId: input.storeId,
          resource,
          ttlSeconds: DATA_SYNC_LOCK_TTL_SECONDS,
        }),
      );
    }

    const runs: SyncOutcome[] = [];

    for (const [index, resource] of resources.entries()) {
      const base = {
        db,
        context,
        storeId: input.storeId,
        connection,
        lock: locks[index]!,
        meta,
        runtime: resolved,
        ttlSeconds: DATA_SYNC_LOCK_TTL_SECONDS,
      };

      if (resource === "customers") runs.push(await syncCustomers(base));
      else if (resource === "orders")
        runs.push(await syncOrders({ ...base, fromDate: input.fromDate, toDate: input.toDate }));
      else runs.push(await syncInventory(base));
    }

    return { runs };
  } catch (error) {
    // A rejected token is a human problem: mark the connection so the UI offers
    // "reconnect" instead of retrying a token that will never work.
    if (error instanceof AppError && error.code === "INTEGRATION_AUTH_REQUIRED") {
      await withTenantTransaction(
        db,
        { userId: context.userId, organizationId: context.organizationId },
        (tx) => markReauthRequired(tx, connection.id, "data_sync_unauthorized"),
      ).catch(() => undefined);
    }
    throw error;
  } finally {
    for (const lock of locks.reverse()) {
      await releaseDataSyncLock(db, context, lock).catch(() => undefined);
    }
  }
}

export interface StoreDataOverview {
  counts: {
    products: number;
    categories: number;
    customers: number;
    orders: number;
    inventory: number;
    orderItems: number;
  };
  orders: { lastOrderAt: string | null; drafts: number; pendingPayment: number };
  inventory: {
    totalQuantity: number;
    unlimited: number;
    outOfStock: number;
    lastSyncedAt: string | null;
  };
  sync: Record<SyncResource, SyncResourceState>;
}

/** Read-side overview: real counts, real sync state, nothing inferred. */
export async function getStoreDataOverview(
  db: Database,
  context: TenantContext,
  storeId: string,
): Promise<StoreDataOverview> {
  assertPermission(context, "store:read");
  await requireStoreAccess(db, context, storeId);

  const [products, categories, customers, orders, inventory] = await withTenantTransaction(
    db,
    { userId: context.userId, organizationId: context.organizationId },
    async (tx) =>
      Promise.all([
        countProducts(tx, storeId),
        countCategories(tx, storeId),
        countCustomers(tx, storeId),
        orderStats(tx, storeId),
        inventorySummary(tx, storeId),
      ]),
  );

  const sync = {} as Record<SyncResource, SyncResourceState>;
  for (const resource of SYNC_RESOURCES) {
    sync[resource] = await resolveResourceState(db, context, storeId, resource);
  }

  const orderItems = await withTenantTransaction(
    db,
    { userId: context.userId, organizationId: context.organizationId },
    (tx) => countOrderItems(tx, storeId),
  );

  return {
    counts: {
      products,
      categories,
      customers,
      orders: orders.total,
      inventory: inventory.products,
      orderItems,
    },
    orders: {
      lastOrderAt: orders.lastOrderAt ? orders.lastOrderAt.toISOString() : null,
      drafts: orders.drafts,
      pendingPayment: orders.pendingPayment,
    },
    inventory: {
      totalQuantity: inventory.totalQuantity,
      unlimited: inventory.unlimited,
      outOfStock: inventory.outOfStock,
      lastSyncedAt: inventory.lastSyncedAt ? inventory.lastSyncedAt.toISOString() : null,
    },
    sync,
  };
}
