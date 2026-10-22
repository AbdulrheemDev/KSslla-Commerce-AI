import { sql } from "drizzle-orm";
import { index, integer, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";

import { connectionProviderEnum, connectionStatusEnum } from "@/db/schema/enums";
import { organizations } from "@/db/schema/organizations";
import { stores } from "@/db/schema/stores";

/**
 * Provider connection for an internal store.
 *
 * Tokens are only ever stored encrypted (AES-256-GCM, see src/lib/crypto.ts)
 * and are bound to the tenant through the encryption AAD. The raw token never
 * reaches a log, an API response, or the browser.
 *
 * `refreshLock*` implements a cross-process single-flight lease so two workers
 * can never spend the same single-use Salla refresh token.
 */
export const storeConnections = pgTable(
  "store_connections",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    storeId: uuid("store_id")
      .notNull()
      .references(() => stores.id, { onDelete: "cascade" }),
    provider: connectionProviderEnum("provider").notNull().default("salla"),
    status: connectionStatusEnum("status").notNull().default("authorizing"),
    externalStoreId: text("external_store_id"),
    externalUserId: text("external_user_id"),
    externalStoreName: text("external_store_name"),
    scopes: text("scopes")
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    accessTokenCiphertext: text("access_token_ciphertext"),
    refreshTokenCiphertext: text("refresh_token_ciphertext"),
    accessTokenExpiresAt: timestamp("access_token_expires_at", { withTimezone: true }),
    refreshTokenExpiresAt: timestamp("refresh_token_expires_at", { withTimezone: true }),
    tokenVersion: integer("token_version").notNull().default(0),
    connectedAt: timestamp("connected_at", { withTimezone: true }),
    lastRefreshAt: timestamp("last_refresh_at", { withTimezone: true }),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    lastErrorCode: text("last_error_code"),
    refreshLockId: text("refresh_lock_id"),
    refreshLockExpiresAt: timestamp("refresh_lock_expires_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("store_connections_store_provider_unique").on(table.storeId, table.provider),
    uniqueIndex("store_connections_provider_external_unique")
      .on(table.provider, table.externalStoreId)
      .where(sql`${table.externalStoreId} is not null`),
    index("store_connections_org_status_idx").on(table.organizationId, table.status),
    index("store_connections_expiry_idx").on(table.accessTokenExpiresAt),
  ],
);

export type StoreConnection = typeof storeConnections.$inferSelect;
export type NewStoreConnection = typeof storeConnections.$inferInsert;
