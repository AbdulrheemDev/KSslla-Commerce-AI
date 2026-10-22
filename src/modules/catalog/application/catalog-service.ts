import type { Database } from "@/db/client";
import type { SyncRun } from "@/db/schema";
import { withTenantTransaction } from "@/db/tenant";
import { AppError } from "@/lib/errors";
import { assertPermission } from "@/modules/identity/application/authorization";
import type { TenantContext } from "@/modules/identity/application/types";
import { requireStoreAccess } from "@/modules/stores/application/store-service";
import type {
  CommerceOverview,
  PersistedCategory,
  PersistedProduct,
  ProductPage,
  SyncResource,
  SyncResourceState,
  SyncRunSummary,
} from "@/modules/catalog/domain/types";
import {
  countCategories,
  listCategories,
} from "@/modules/catalog/infrastructure/category-repository";
import {
  countProducts,
  findProductById,
  listProducts,
  type ProductListRow,
} from "@/modules/catalog/infrastructure/product-repository";
import {
  findLatestRun,
  findLatestRunWithStatus,
  findLatestSuccessfulRun,
  findRunningLock,
} from "@/modules/catalog/infrastructure/sync-repository";

/**
 * Read-side catalogue use cases.
 *
 * Every function re-resolves the store from the session's organization. The
 * store id in the URL is a request, never proof, and a foreign id is reported
 * as not found.
 */

const MAX_PAGE_SIZE = 50;

function toRunSummary(run: SyncRun): SyncRunSummary {
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

async function resolveResourceState(
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

export async function getCommerceOverview(
  db: Database,
  context: TenantContext,
  storeId: string,
): Promise<CommerceOverview> {
  assertPermission(context, "store:read");
  await requireStoreAccess(db, context, storeId);

  const [products, categories] = await withTenantTransaction(
    db,
    { userId: context.userId, organizationId: context.organizationId },
    async (tx) => Promise.all([countProducts(tx, storeId), countCategories(tx, storeId)]),
  );

  const lastSuccessful = await withTenantTransaction(
    db,
    { userId: context.userId, organizationId: context.organizationId },
    (tx) => findLatestSuccessfulRun(tx, storeId),
  );

  const [productState, categoryState] = await Promise.all([
    resolveResourceState(db, context, storeId, "products"),
    resolveResourceState(db, context, storeId, "categories"),
  ]);

  return {
    products,
    categories,
    lastSyncedAt: lastSuccessful?.finishedAt?.toISOString() ?? null,
    sync: { products: productState, categories: categoryState },
  };
}

function toPersistedProduct(row: ProductListRow): PersistedProduct {
  return {
    id: row.id,
    externalProductId: row.externalProductId,
    name: row.name,
    sku: row.sku,
    productType: row.productType,
    status: row.status,
    priceAmount: row.priceAmount,
    currency: row.currency,
    regularPriceAmount: row.regularPriceAmount,
    salePriceAmount: row.salePriceAmount,
    quantity: row.quantity,
    isAvailable: row.isAvailable,
    url: row.url,
    imageUrl: row.imageUrl,
    description: row.description,
    brandName: row.brandName,
    categories: row.categories,
    sourceUpdatedAt: row.sourceUpdatedAt?.toISOString() ?? null,
    lastSeenAt: row.lastSeenAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

function clampPage(page: number): number {
  return Number.isFinite(page) && page >= 1 ? Math.floor(page) : 1;
}

export async function listStoredProducts(
  db: Database,
  context: TenantContext,
  storeId: string,
  input: { query?: string; page?: number; pageSize?: number } = {},
): Promise<ProductPage> {
  assertPermission(context, "store:read");
  await requireStoreAccess(db, context, storeId);

  const page = clampPage(input.page ?? 1);
  const pageSize = Math.min(MAX_PAGE_SIZE, Math.max(1, input.pageSize ?? 20));
  const query = (input.query ?? "").trim().slice(0, 120);

  const { rows, total } = await withTenantTransaction(
    db,
    { userId: context.userId, organizationId: context.organizationId },
    (tx) =>
      listProducts(tx, {
        storeId,
        query: query.length > 0 ? query : undefined,
        limit: pageSize,
        offset: (page - 1) * pageSize,
      }),
  );

  const items: PersistedProduct[] = rows.map(toPersistedProduct);

  return {
    items,
    total,
    page,
    pageSize,
    totalPages: Math.max(1, Math.ceil(total / pageSize)),
  };
}

export async function listStoredCategories(
  db: Database,
  context: TenantContext,
  storeId: string,
  input: { page?: number; pageSize?: number } = {},
): Promise<{ items: PersistedCategory[]; total: number; page: number; totalPages: number }> {
  assertPermission(context, "store:read");
  await requireStoreAccess(db, context, storeId);

  const page = clampPage(input.page ?? 1);
  const pageSize = Math.min(MAX_PAGE_SIZE, Math.max(1, input.pageSize ?? 50));
  const { rows, total } = await withTenantTransaction(
    db,
    { userId: context.userId, organizationId: context.organizationId },
    (tx) => listCategories(tx, { storeId, limit: pageSize, offset: (page - 1) * pageSize }),
  );

  return {
    items: rows.map((row) => ({
      id: row.id,
      externalCategoryId: row.externalCategoryId,
      name: row.name,
      parentExternalId: row.parentExternalId,
      parentCategoryId: null,
      parentName: row.parentName,
      status: row.status,
      sortOrder: row.sortOrder,
      productCount: Number(row.productCount),
      sourceUpdatedAt: row.sourceUpdatedAt?.toISOString() ?? null,
      lastSeenAt: row.lastSeenAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    })),
    total,
    page,
    totalPages: Math.max(1, Math.ceil(total / pageSize)),
  };
}

export async function getStoredProduct(
  db: Database,
  context: TenantContext,
  storeId: string,
  productId: string,
): Promise<PersistedProduct> {
  assertPermission(context, "store:read");
  await requireStoreAccess(db, context, storeId);

  const row = await withTenantTransaction(
    db,
    { userId: context.userId, organizationId: context.organizationId },
    (tx) => findProductById(tx, storeId, productId),
  );

  if (!row) {
    throw new AppError({ code: "NOT_FOUND", message: "Product not found." });
  }

  return toPersistedProduct(row);
}
