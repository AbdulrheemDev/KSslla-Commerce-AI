import {
  index,
  integer,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  type AnyPgColumn,
} from "drizzle-orm/pg-core";

import { organizations } from "@/db/schema/organizations";
import { stores } from "@/db/schema/stores";
import { users } from "@/db/schema/users";

/**
 * Sync execution records.
 *
 * `sync_runs` is the single source of truth for "has this store ever been
 * synced", "when did it last succeed", and "why did it fail". There is no
 * separate state table: duplicating state invites it to drift from the run it
 * describes.
 *
 * `sync_locks` is a lease, not a forever lock. A crashed worker stops renewing
 * it and the next request may take it over once `expiresAt` has passed;
 * `lockId` makes release safe (only the owner releases).
 */

export const syncRuns = pgTable(
  "sync_runs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    storeId: uuid("store_id")
      .notNull()
      .references(() => stores.id, { onDelete: "cascade" }),
    resource: text("resource").notNull(),
    status: text("status").notNull(),
    correlationId: uuid("correlation_id").notNull(),
    trigger: text("trigger").notNull().default("manual"),
    initiatedByUserId: uuid("initiated_by_user_id").references(() => users.id, {
      onDelete: "set null",
    }),
    pagesProcessed: integer("pages_processed").notNull().default(0),
    itemsProcessed: integer("items_processed").notNull().default(0),
    itemsCreated: integer("items_created").notNull().default(0),
    itemsUpdated: integer("items_updated").notNull().default(0),
    relationsLinked: integer("relations_linked").notNull().default(0),
    itemsSkipped: integer("items_skipped").notNull().default(0),
    errorCode: text("error_code"),
    startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
  },
  (table) => [
    index("sync_runs_store_resource_started_idx").on(
      table.storeId,
      table.resource,
      table.startedAt,
    ),
    index("sync_runs_org_idx").on(table.organizationId),
    index("sync_runs_correlation_idx").on(table.correlationId),
  ],
);

export const syncLocks = pgTable(
  "sync_locks",
  {
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    storeId: uuid("store_id")
      .notNull()
      .references(() => stores.id, { onDelete: "cascade" }),
    resource: text("resource").notNull(),
    lockId: uuid("lock_id").notNull(),
    acquiredAt: timestamp("acquired_at", { withTimezone: true }).notNull().defaultNow(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    /** Kept so a lease can be inspected without touching the lock row semantics. */
    ownerRunId: uuid("owner_run_id").references((): AnyPgColumn => syncRuns.id, {
      onDelete: "set null",
    }),
  },
  (table) => [
    uniqueIndex("sync_locks_store_resource_unique").on(table.storeId, table.resource),
    index("sync_locks_expiry_idx").on(table.expiresAt),
  ],
);

export type SyncRun = typeof syncRuns.$inferSelect;
export type NewSyncRun = typeof syncRuns.$inferInsert;
export type SyncLock = typeof syncLocks.$inferSelect;
