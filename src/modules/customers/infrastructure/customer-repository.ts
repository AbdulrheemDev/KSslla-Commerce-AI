import { and, count, desc, eq, inArray, or, sql } from "drizzle-orm";

import type { DbExecutor } from "@/db/executor";
import { customers } from "@/db/schema";
import type { CustomerInput } from "@/modules/customers/domain/types";

/**
 * Customer persistence.
 *
 * Upsert on `(store_id, external_customer_id)` — never on e-mail, because the
 * documented payload allows several customers without one. Two write modes:
 *
 * - `authoritative` (List Customers): every documented field is refreshed;
 *   a field the list does not carry (`created_at`, `currency`, `lang`, `type`)
 *   is left untouched via `COALESCE`, so order-enriched values survive.
 * - `enrich` (the customer embedded in an order): only fills gaps. The
 *   embedded copy is a snapshot from order time and must not overwrite a
 *   newer value that the customer sync already stored.
 */

export type CustomerWriteMode = "authoritative" | "enrich";

export interface CustomerUpsertResult {
  created: number;
  updated: number;
  /** Local id per external id, so the caller can link without a second query. */
  idByExternalId: Map<string, string>;
}

function valuesFor(input: {
  organizationId: string;
  storeId: string;
  item: CustomerInput;
  seenAt: Date;
}) {
  const { item } = input;
  return {
    organizationId: input.organizationId,
    storeId: input.storeId,
    externalCustomerId: item.externalCustomerId,
    firstName: item.firstName,
    lastName: item.lastName,
    email: item.email,
    mobile: item.mobile,
    mobileCode: item.mobileCode,
    gender: item.gender,
    birthday: item.birthday ? new Date(`${item.birthday}T00:00:00.000Z`) : null,
    city: item.city,
    country: item.country,
    countryCode: item.countryCode,
    currency: item.currency,
    language: item.language,
    customerType: item.customerType,
    sourceCreatedAt: item.sourceCreatedAt,
    sourceUpdatedAt: item.sourceUpdatedAt,
    lastSeenAt: input.seenAt,
  };
}

export async function upsertCustomers(
  db: DbExecutor,
  input: {
    organizationId: string;
    storeId: string;
    items: readonly CustomerInput[];
    seenAt: Date;
    mode?: CustomerWriteMode;
  },
): Promise<CustomerUpsertResult> {
  const idByExternalId = new Map<string, string>();
  if (input.items.length === 0) return { created: 0, updated: 0, idByExternalId };

  // Deduplicate inside the page: an order page can contain the same customer
  // twice, and a single INSERT cannot touch the same conflict target twice.
  const unique = new Map<string, CustomerInput>();
  for (const item of input.items) unique.set(item.externalCustomerId, item);

  const rows = await db
    .insert(customers)
    .values(
      [...unique.values()].map((item) =>
        valuesFor({
          organizationId: input.organizationId,
          storeId: input.storeId,
          item,
          seenAt: input.seenAt,
        }),
      ),
    )
    .onConflictDoUpdate({
      target: [customers.storeId, customers.externalCustomerId],
      set:
        input.mode === "enrich"
          ? {
              firstName: sql`coalesce(${customers.firstName}, excluded.first_name)`,
              lastName: sql`coalesce(${customers.lastName}, excluded.last_name)`,
              email: sql`coalesce(${customers.email}, excluded.email)`,
              mobile: sql`coalesce(${customers.mobile}, excluded.mobile)`,
              mobileCode: sql`coalesce(${customers.mobileCode}, excluded.mobile_code)`,
              gender: sql`coalesce(${customers.gender}, excluded.gender)`,
              birthday: sql`coalesce(${customers.birthday}, excluded.birthday)`,
              city: sql`coalesce(${customers.city}, excluded.city)`,
              country: sql`coalesce(${customers.country}, excluded.country)`,
              countryCode: sql`coalesce(${customers.countryCode}, excluded.country_code)`,
              currency: sql`coalesce(${customers.currency}, excluded.currency)`,
              language: sql`coalesce(${customers.language}, excluded.language)`,
              customerType: sql`coalesce(${customers.customerType}, excluded.customer_type)`,
              sourceCreatedAt: sql`coalesce(${customers.sourceCreatedAt}, excluded.source_created_at)`,
              sourceUpdatedAt: sql`coalesce(excluded.source_updated_at, ${customers.sourceUpdatedAt})`,
              lastSeenAt: sql`excluded.last_seen_at`,
              updatedAt: sql`now()`,
            }
          : {
              firstName: sql`coalesce(excluded.first_name, ${customers.firstName})`,
              lastName: sql`coalesce(excluded.last_name, ${customers.lastName})`,
              email: sql`coalesce(excluded.email, ${customers.email})`,
              mobile: sql`coalesce(excluded.mobile, ${customers.mobile})`,
              mobileCode: sql`coalesce(excluded.mobile_code, ${customers.mobileCode})`,
              gender: sql`coalesce(excluded.gender, ${customers.gender})`,
              birthday: sql`coalesce(excluded.birthday, ${customers.birthday})`,
              city: sql`coalesce(excluded.city, ${customers.city})`,
              country: sql`coalesce(excluded.country, ${customers.country})`,
              countryCode: sql`coalesce(excluded.country_code, ${customers.countryCode})`,
              currency: sql`coalesce(excluded.currency, ${customers.currency})`,
              language: sql`coalesce(excluded.language, ${customers.language})`,
              customerType: sql`coalesce(excluded.customer_type, ${customers.customerType})`,
              sourceCreatedAt: sql`coalesce(${customers.sourceCreatedAt}, excluded.source_created_at)`,
              sourceUpdatedAt: sql`coalesce(excluded.source_updated_at, ${customers.sourceUpdatedAt})`,
              lastSeenAt: sql`excluded.last_seen_at`,
              updatedAt: sql`now()`,
            },
    })
    .returning({
      id: customers.id,
      externalCustomerId: customers.externalCustomerId,
      created: sql<boolean>`(xmax = 0)`,
    });

  for (const row of rows) idByExternalId.set(row.externalCustomerId, row.id);

  const created = rows.filter((row) => row.created).length;
  return { created, updated: rows.length - created, idByExternalId };
}

export async function countCustomers(db: DbExecutor, storeId: string): Promise<number> {
  const [row] = await db
    .select({ value: count() })
    .from(customers)
    .where(eq(customers.storeId, storeId));
  return Number(row?.value ?? 0);
}

export interface CustomerListRow {
  id: string;
  externalCustomerId: string;
  firstName: string | null;
  lastName: string | null;
  email: string | null;
  mobile: string | null;
  mobileCode: string | null;
  gender: string | null;
  birthday: Date | null;
  city: string | null;
  country: string | null;
  countryCode: string | null;
  currency: string | null;
  language: string | null;
  customerType: string | null;
  sourceCreatedAt: Date | null;
  lastSeenAt: Date;
  updatedAt: Date;
  orderCount: number | null;
}

export async function listCustomers(
  db: DbExecutor,
  input: { storeId: string; query?: string; limit: number; offset: number },
): Promise<{ rows: CustomerListRow[]; total: number }> {
  const search = input.query?.trim();

  const where = search
    ? and(
        eq(customers.storeId, input.storeId),
        or(
          sql`${customers.firstName} ilike ${`%${search}%`}`,
          sql`${customers.lastName} ilike ${`%${search}%`}`,
          sql`${customers.email} ilike ${`%${search}%`}`,
          sql`${customers.mobile} ilike ${`%${search}%`}`,
        ),
      )
    : eq(customers.storeId, input.storeId);

  const [rows, totals] = await Promise.all([
    db
      .select({
        id: customers.id,
        externalCustomerId: customers.externalCustomerId,
        firstName: customers.firstName,
        lastName: customers.lastName,
        email: customers.email,
        mobile: customers.mobile,
        mobileCode: customers.mobileCode,
        gender: customers.gender,
        birthday: customers.birthday,
        city: customers.city,
        country: customers.country,
        countryCode: customers.countryCode,
        currency: customers.currency,
        language: customers.language,
        customerType: customers.customerType,
        sourceCreatedAt: customers.sourceCreatedAt,
        lastSeenAt: customers.lastSeenAt,
        updatedAt: customers.updatedAt,
        // Genuinely computable locally: the orders this store has synced.
        orderCount: sql<number>`(select count(*) from orders o where o.customer_id = ${customers.id})`,
      })
      .from(customers)
      .where(where)
      .orderBy(desc(customers.updatedAt), desc(customers.id))
      .limit(input.limit)
      .offset(input.offset),
    db.select({ value: count() }).from(customers).where(where),
  ]);

  return { rows, total: Number(totals[0]?.value ?? 0) };
}

/** Used by tests and the sync service to verify a batch landed exactly once. */
export async function findCustomerIdsByExternalIds(
  db: DbExecutor,
  storeId: string,
  externalIds: readonly string[],
): Promise<Array<{ id: string; externalCustomerId: string }>> {
  if (externalIds.length === 0) return [];
  return db
    .select({ id: customers.id, externalCustomerId: customers.externalCustomerId })
    .from(customers)
    .where(
      and(eq(customers.storeId, storeId), inArray(customers.externalCustomerId, [...externalIds])),
    );
}
