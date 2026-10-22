import { index, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";

import { connectionProviderEnum } from "@/db/schema/enums";
import { organizations } from "@/db/schema/organizations";
import { stores } from "@/db/schema/stores";
import { users } from "@/db/schema/users";

/**
 * Server-side OAuth state.
 *
 * Only the HMAC of the state value is stored, so a database leak cannot be
 * turned into a usable callback URL. A state is bound to the exact user,
 * organization, store, and provider that started the flow, and is consumed
 * atomically so it cannot be replayed.
 */
export const oauthStates = pgTable(
  "oauth_states",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    stateHash: text("state_hash").notNull(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    storeId: uuid("store_id")
      .notNull()
      .references(() => stores.id, { onDelete: "cascade" }),
    provider: connectionProviderEnum("provider").notNull().default("salla"),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    usedAt: timestamp("used_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("oauth_states_hash_unique").on(table.stateHash),
    index("oauth_states_store_idx").on(table.storeId, table.provider),
    index("oauth_states_expiry_idx").on(table.expiresAt),
  ],
);

export type OAuthState = typeof oauthStates.$inferSelect;
export type NewOAuthState = typeof oauthStates.$inferInsert;
