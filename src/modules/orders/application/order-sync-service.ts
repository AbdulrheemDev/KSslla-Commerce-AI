import type { Database } from "@/db/client";
import { logger } from "@/lib/logger";
import type { StoreConnection } from "@/db/schema";
import { withTenantTransaction } from "@/db/tenant";
import type { SallaOrderDto } from "@/modules/orders/domain/dto";
import { formatOrderWallClock, mapOrder } from "@/modules/orders/domain/mappers";
import {
  listOrders,
  orderStats,
  upsertOrders,
} from "@/modules/orders/infrastructure/order-repository";
import type { OrderPageResult, PersistedOrder } from "@/modules/orders/domain/types";
import type { RequestMeta, TenantContext } from "@/modules/identity/application/types";
import { assertPermission } from "@/modules/identity/application/authorization";
import { requireStoreAccess } from "@/modules/stores/application/store-service";
import {
  runPagedSync,
  SEQUENTIAL_WINDOW_MS,
  type DataSyncLock,
  type DataSyncRuntime,
  type SyncOutcome,
} from "@/modules/sync/application/paged-sync";

/**
 * Order read sync (`GET /admin/v2/orders`, scope `orders.read`).
 *
 * The documented rules this service encodes (docs/salla-reference.md §12.1):
 * - pages are read **sequentially**, 1, 2, 3 …; an out-of-sequence request
 *   returns an empty body, so the runner never jumps and never fans out;
 * - `per_page=30`;
 * - `expanded=true` is never sent (unsupported, retired 1 Sep 2026);
 * - the whole pagination must finish inside the documented 15-minute window,
 *   so the runner stops instead of reading a cache that may have moved;
 * - `from_date` / `to_date` are supported by the client for narrower runs.
 *
 * Line items are stored with `no_product_reference` because the documented
 * list payload carries no product id, SKU, or line price (§12.2).
 */

export const ORDER_PAGE_SIZE = 30;

export async function syncOrders(input: {
  db: Database;
  context: TenantContext;
  storeId: string;
  connection: StoreConnection;
  lock: DataSyncLock;
  meta: RequestMeta;
  runtime: DataSyncRuntime;
  ttlSeconds: number;
  fromDate?: string;
  toDate?: string;
}): Promise<SyncOutcome> {
  const { fromDate, toDate } = input;

  return runPagedSync<SallaOrderDto>(input, {
    resource: "orders",
    perPage: ORDER_PAGE_SIZE,
    sequentialWindowMs: SEQUENTIAL_WINDOW_MS,
    auditPrefix: "salla.orders",
    externalIdOf: (item) => item.id,
    fetchPage: (client, page) =>
      client.listOrders({ page, perPage: ORDER_PAGE_SIZE, fromDate, toDate }),
    persistPage: async (tx, items, seenAt) => {
      const mapped = items.map(mapOrder);
      const written = await upsertOrders(tx, {
        organizationId: input.context.organizationId,
        storeId: input.storeId,
        items: mapped,
        seenAt,
      });

      // Partial failures are recorded, never fatal: the run continues and the
      // line keeps an explicit reason instead of a guessed product.
      const unresolved = mapped.flatMap((order) =>
        order.items
          .filter((item) => item.linkStatus !== "linked")
          .map((item) => ({
            externalOrderId: order.externalOrderId,
            lineNumber: item.lineNumber,
            reason: item.linkStatus,
          })),
      );

      if (unresolved.length > 0) {
        logger.warn(
          {
            event: "data.sync.partial",
            resource: "order_items",
            organizationId: input.context.organizationId,
            storeId: input.storeId,
            skipped: unresolved.length,
            // Bounded sample of stable ids; no names, phones, or payloads.
            sample: unresolved.slice(0, 5),
            at: seenAt.toISOString(),
          },
          "order lines could not be linked to a local product",
        );
      }

      return {
        created: written.created,
        updated: written.updated,
        linked: written.linked,
        skipped: written.skipped,
      };
    },
  });
}

export async function listStoredOrders(
  db: Database,
  context: TenantContext,
  storeId: string,
  input: { page?: number; pageSize?: number } = {},
): Promise<OrderPageResult> {
  assertPermission(context, "store:read");
  await requireStoreAccess(db, context, storeId);

  const page = Number.isFinite(input.page) && (input.page ?? 0) >= 1 ? Math.floor(input.page!) : 1;
  const pageSize = Math.min(50, Math.max(1, input.pageSize ?? 20));

  const { rows, total } = await withTenantTransaction(
    db,
    { userId: context.userId, organizationId: context.organizationId },
    (tx) => listOrders(tx, { storeId, limit: pageSize, offset: (page - 1) * pageSize }),
  );

  const items: PersistedOrder[] = rows.map((row) => ({
    id: row.id,
    externalOrderId: row.externalOrderId,
    statusName: row.statusName,
    statusSlug: row.statusSlug,
    totalAmount: row.totalAmount,
    currency: row.currency,
    isPendingPayment: row.isPendingPayment,
    draft: row.draft,
    orderDate: formatOrderWallClock(row.orderDate),
    orderTimezone: row.orderTimezone,
    customerName: row.customerName,
    itemsCount: row.itemsCount,
    lastSeenAt: row.lastSeenAt.toISOString(),
  }));

  return {
    items,
    total,
    page,
    pageSize,
    totalPages: Math.max(1, Math.ceil(total / pageSize)),
  };
}

export async function orderStatsForStore(
  db: Database,
  context: TenantContext,
  storeId: string,
): Promise<{
  total: number;
  lastOrderAt: string | null;
  drafts: number;
  pendingPayment: number;
}> {
  assertPermission(context, "store:read");
  await requireStoreAccess(db, context, storeId);

  const stats = await withTenantTransaction(
    db,
    { userId: context.userId, organizationId: context.organizationId },
    (tx) => orderStats(tx, storeId),
  );

  return {
    total: stats.total,
    lastOrderAt: stats.lastOrderAt ? stats.lastOrderAt.toISOString() : null,
    drafts: stats.drafts,
    pendingPayment: stats.pendingPayment,
  };
}
