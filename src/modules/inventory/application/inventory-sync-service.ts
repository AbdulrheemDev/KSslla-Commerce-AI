import type { Database } from "@/db/client";
import { logger } from "@/lib/logger";
import type { StoreConnection } from "@/db/schema";
import { withTenantTransaction } from "@/db/tenant";
import type { SallaQuantityDto } from "@/modules/inventory/domain/dto";
import { mapQuantity, quantityKeyFor } from "@/modules/inventory/domain/mappers";
import {
  inventorySummary,
  listInventoryLevels,
  upsertInventoryLevels,
} from "@/modules/inventory/infrastructure/inventory-repository";
import type {
  InventoryPageResult,
  InventorySummary,
  PersistedInventoryLevel,
} from "@/modules/inventory/domain/types";
import type { RequestMeta, TenantContext } from "@/modules/identity/application/types";
import { assertPermission } from "@/modules/identity/application/authorization";
import { requireStoreAccess } from "@/modules/stores/application/store-service";
import {
  runPagedSync,
  type DataSyncLock,
  type DataSyncRuntime,
  type SyncOutcome,
} from "@/modules/sync/application/paged-sync";

/**
 * Inventory read sync (`GET /admin/v2/products/quantities`, scope
 * `products.read`).
 *
 * The endpoint **is** paginated (documented `pagination` block, 15 per page by
 * default, `per_page` documented as overridable on any list endpoint), so it is
 * paged exactly like the other resources. It is a state endpoint: one row per
 * variant, upserted in place. See ADR-043 for the storage policy.
 */

export const INVENTORY_PAGE_SIZE = 30;

export async function syncInventory(input: {
  db: Database;
  context: TenantContext;
  storeId: string;
  connection: StoreConnection;
  lock: DataSyncLock;
  meta: RequestMeta;
  runtime: DataSyncRuntime;
  ttlSeconds: number;
}): Promise<SyncOutcome> {
  return runPagedSync<SallaQuantityDto>(input, {
    resource: "inventory",
    perPage: INVENTORY_PAGE_SIZE,
    auditPrefix: "salla.inventory",
    externalIdOf: (item) => quantityKeyFor({ id: item.id, skuId: item.sku_id ?? null }),
    fetchPage: (client, page) =>
      client.listProductQuantities({ page, perPage: INVENTORY_PAGE_SIZE }),
    persistPage: async (tx, items, seenAt) => {
      const mapped = items.map(mapQuantity);
      const written = await upsertInventoryLevels(tx, {
        organizationId: input.context.organizationId,
        storeId: input.storeId,
        items: mapped,
        seenAt,
      });

      if (written.unlinked > 0) {
        logger.warn(
          {
            event: "data.sync.partial",
            resource: "inventory",
            organizationId: input.context.organizationId,
            storeId: input.storeId,
            unlinked: written.unlinked,
            sample: mapped
              .filter((item) => item.externalProductId)
              .slice(0, 5)
              .map((item) => ({
                externalProductId: item.externalProductId,
                quantityKey: item.quantityKey,
              })),
            at: seenAt.toISOString(),
          },
          "inventory rows have no local product yet",
        );
      }

      return {
        created: written.created,
        updated: written.updated,
        linked: written.linked,
        skipped: written.unlinked,
      };
    },
  });
}

export async function listStoredInventory(
  db: Database,
  context: TenantContext,
  storeId: string,
  input: { query?: string; page?: number; pageSize?: number } = {},
): Promise<InventoryPageResult> {
  assertPermission(context, "store:read");
  await requireStoreAccess(db, context, storeId);

  const page = Number.isFinite(input.page) && (input.page ?? 0) >= 1 ? Math.floor(input.page!) : 1;
  const pageSize = Math.min(50, Math.max(1, input.pageSize ?? 20));
  const query = (input.query ?? "").trim().slice(0, 120);

  const { rows, total } = await withTenantTransaction(
    db,
    { userId: context.userId, organizationId: context.organizationId },
    (tx) =>
      listInventoryLevels(tx, {
        storeId,
        query: query.length > 0 ? query : undefined,
        limit: pageSize,
        offset: (page - 1) * pageSize,
      }),
  );

  const items: PersistedInventoryLevel[] = rows.map((row) => ({
    id: row.id,
    quantityKey: row.quantityKey,
    externalProductId: row.externalProductId,
    externalSkuId: row.externalSkuId,
    productId: row.productId,
    productName: row.productName,
    sku: row.sku,
    variant: row.variant,
    quantity: row.quantity,
    soldQuantity: row.soldQuantity,
    unlimitedQuantity: row.unlimitedQuantity,
    priceAmount: row.priceAmount,
    lastSyncedAt: row.lastSyncedAt.toISOString(),
  }));

  return {
    items,
    total,
    page,
    pageSize,
    totalPages: Math.max(1, Math.ceil(total / pageSize)),
  };
}

export async function inventorySummaryForStore(
  db: Database,
  context: TenantContext,
  storeId: string,
): Promise<InventorySummary> {
  assertPermission(context, "store:read");
  await requireStoreAccess(db, context, storeId);

  const summary = await withTenantTransaction(
    db,
    { userId: context.userId, organizationId: context.organizationId },
    (tx) => inventorySummary(tx, storeId),
  );

  return {
    products: summary.products,
    totalQuantity: summary.totalQuantity,
    unlimited: summary.unlimited,
    outOfStock: summary.outOfStock,
    lastSyncedAt: summary.lastSyncedAt ? summary.lastSyncedAt.toISOString() : null,
  };
}
