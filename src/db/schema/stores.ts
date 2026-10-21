import { check, index, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

import { storePlatformEnum, storeStatusEnum } from "@/db/schema/enums";
import { organizations } from "@/db/schema/organizations";

/**
 * Internal store record, independent from any provider connection.
 *
 * Phase 02 stores are always `not_connected`; there is no Salla store id, token,
 * OAuth flow, or API call. `external_store_id` exists solely to prepare the
 * Phase 03 connection model and is never populated by this phase.
 */
export const stores = pgTable(
  "stores",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    slug: text("slug").notNull(),
    platform: storePlatformEnum("platform").notNull().default("salla"),
    status: storeStatusEnum("status").notNull().default("not_connected"),
    externalStoreId: text("external_store_id"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("stores_org_slug_unique").on(table.organizationId, table.slug),
    uniqueIndex("stores_platform_external_unique")
      .on(table.platform, table.externalStoreId)
      .where(sql`${table.externalStoreId} is not null`),
    check("stores_slug_format_check", sql`${table.slug} ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$'`),
    index("stores_org_status_idx").on(table.organizationId, table.status),
  ],
);

export type Store = typeof stores.$inferSelect;
export type NewStore = typeof stores.$inferInsert;
