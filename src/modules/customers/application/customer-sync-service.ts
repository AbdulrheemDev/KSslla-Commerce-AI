import type { Database } from "@/db/client";
import type { StoreConnection } from "@/db/schema";
import { withTenantTransaction } from "@/db/tenant";
import type { SallaCustomerDto } from "@/modules/customers/domain/dto";
import { mapCustomer } from "@/modules/customers/domain/mappers";
import {
  countCustomers,
  listCustomers,
  upsertCustomers,
} from "@/modules/customers/infrastructure/customer-repository";
import type { CustomerPage, PersistedCustomer } from "@/modules/customers/domain/types";
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
 * Customer read sync (`GET /admin/v2/customers`, scope `customers.read`).
 *
 * Customers come first in the orchestrator because orders link to them. The
 * order sync also creates a missing customer from the embedded order payload,
 * so neither direction can dead-end.
 *
 * Pagination is the provider's own (`pagination.currentPage` / `totalPages`,
 * 15 per page by default, `per_page` documented as overridable). Nothing from
 * the Orders page rules is reused blindly, except the shared stop conditions
 * that apply to every list endpoint.
 */

export const CUSTOMER_PAGE_SIZE = 30;

export async function syncCustomers(input: {
  db: Database;
  context: TenantContext;
  storeId: string;
  connection: StoreConnection;
  lock: DataSyncLock;
  meta: RequestMeta;
  runtime: DataSyncRuntime;
  ttlSeconds: number;
}): Promise<SyncOutcome> {
  return runPagedSync<SallaCustomerDto>(input, {
    resource: "customers",
    perPage: CUSTOMER_PAGE_SIZE,
    auditPrefix: "salla.customers",
    externalIdOf: (item) => item.id,
    fetchPage: (client, page) => client.listCustomers({ page, perPage: CUSTOMER_PAGE_SIZE }),
    persistPage: async (tx, items, seenAt) => {
      const written = await upsertCustomers(tx, {
        organizationId: input.context.organizationId,
        storeId: input.storeId,
        items: items.map(mapCustomer),
        seenAt,
        mode: "authoritative",
      });

      return { created: written.created, updated: written.updated, linked: 0, skipped: 0 };
    },
  });
}

export async function listStoredCustomers(
  db: Database,
  context: TenantContext,
  storeId: string,
  input: { query?: string; page?: number; pageSize?: number } = {},
): Promise<CustomerPage> {
  assertPermission(context, "store:read");
  await requireStoreAccess(db, context, storeId);

  const page = Number.isFinite(input.page) && (input.page ?? 0) >= 1 ? Math.floor(input.page!) : 1;
  const pageSize = Math.min(50, Math.max(1, input.pageSize ?? 20));
  const query = (input.query ?? "").trim().slice(0, 120);

  const { rows, total } = await withTenantTransaction(
    db,
    { userId: context.userId, organizationId: context.organizationId },
    (tx) =>
      listCustomers(tx, {
        storeId,
        query: query.length > 0 ? query : undefined,
        limit: pageSize,
        offset: (page - 1) * pageSize,
      }),
  );

  const items: PersistedCustomer[] = rows.map((row) => ({
    id: row.id,
    externalCustomerId: row.externalCustomerId,
    firstName: row.firstName,
    lastName: row.lastName,
    fullName:
      [row.firstName, row.lastName].filter((part) => part !== null && part !== "").join(" ") ||
      null,
    email: row.email,
    mobile: row.mobile,
    mobileCode: row.mobileCode,
    gender: row.gender,
    birthday: row.birthday ? row.birthday.toISOString().slice(0, 10) : null,
    city: row.city,
    country: row.country,
    countryCode: row.countryCode,
    currency: row.currency,
    language: row.language,
    customerType: row.customerType,
    sourceCreatedAt: row.sourceCreatedAt ? row.sourceCreatedAt.toISOString() : null,
    orderCount: row.orderCount === null ? null : Number(row.orderCount),
    lastSeenAt: row.lastSeenAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  }));

  return {
    items,
    total,
    page,
    pageSize,
    totalPages: Math.max(1, Math.ceil(total / pageSize)),
  };
}

export async function countStoredCustomers(
  db: Database,
  context: TenantContext,
  storeId: string,
): Promise<number> {
  return withTenantTransaction(
    db,
    { userId: context.userId, organizationId: context.organizationId },
    (tx) => countCustomers(tx, storeId),
  );
}
