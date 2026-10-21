import { randomBytes } from "node:crypto";

import type { Database } from "@/db/client";
import { withTenantTransaction } from "@/db/tenant";
import { recordAudit } from "@/modules/audit/infrastructure/audit-repository";
import { slugifyOrganizationName } from "@/modules/identity/domain/identifiers";
import type { RequestMeta, TenantContext } from "@/modules/identity/application/types";
import { assertPermission } from "@/modules/identity/application/authorization";
import {
  findStoreBySlug,
  findStoreById,
  insertStore,
  listStoresForOrganization,
  type StoreRecord,
} from "@/modules/stores/infrastructure/store-repository";
import { AppError } from "@/lib/errors";

export interface StoreView {
  id: string;
  name: string;
  platform: "salla";
  status: "not_connected" | "connected" | "disconnected";
  createdAt: string;
}

function toView(store: StoreRecord): StoreView {
  return {
    id: store.id,
    name: store.name,
    platform: "salla",
    status: store.status,
    createdAt: store.createdAt.toISOString(),
  };
}

export async function listStores(db: Database, context: TenantContext): Promise<StoreView[]> {
  assertPermission(context, "store:read");

  const rows = await withTenantTransaction(
    db,
    { userId: context.userId, organizationId: context.organizationId },
    (tx) => listStoresForOrganization(tx, context.organizationId),
  );

  return rows.map(toView);
}

export async function createStore(
  db: Database,
  context: TenantContext,
  input: { name: string },
  meta: RequestMeta,
): Promise<StoreView> {
  assertPermission(context, "organization:update");

  const name = input.name.trim();
  if (!name || name.length > 120) {
    throw new AppError({
      code: "VALIDATION_FAILED",
      message: "Invalid store name.",
      details: { field: "name" },
    });
  }

  const store = await withTenantTransaction(
    db,
    { userId: context.userId, organizationId: context.organizationId },
    async (tx) => {
      let slug = slugifyOrganizationName(name);

      for (let attempt = 0; attempt < 5; attempt += 1) {
        const existing = await findStoreBySlug(tx, context.organizationId, slug);
        if (!existing) break;
        slug = `${slugifyOrganizationName(name)}-${randomBytes(2).toString("hex")}`;
      }

      const created = await insertStore(tx, {
        organizationId: context.organizationId,
        name,
        slug,
      });

      await recordAudit(tx, {
        organizationId: context.organizationId,
        actorUserId: context.userId,
        action: "store.created",
        entityType: "store",
        entityId: created.id,
        metadata: { platform: "salla", status: "not_connected" },
        ipHash: meta.ipHash,
        userAgent: meta.userAgent,
        requestId: meta.requestId,
      });

      return created;
    },
  );

  return toView(store);
}

/**
 * Loads a store that belongs to the active organization.
 *
 * The id comes from the client, so it is only ever treated as a request: the
 * tenant context supplies the organization, and a foreign id resolves to 404
 * rather than 403 (no cross-tenant existence signal).
 */
export async function requireStoreAccess(
  db: Database,
  context: TenantContext,
  storeId: string,
): Promise<StoreRecord> {
  assertPermission(context, "store:read");

  const store = await withTenantTransaction(
    db,
    { userId: context.userId, organizationId: context.organizationId },
    (tx) => findStoreById(tx, storeId),
  );

  if (!store || store.organizationId !== context.organizationId) {
    throw new AppError({
      code: "TENANT_ISOLATION_VIOLATION",
      message: "Store not found.",
    });
  }

  return store;
}
