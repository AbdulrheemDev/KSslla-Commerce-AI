import { index, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";

import { organizations } from "@/db/schema/organizations";
import { users } from "@/db/schema/users";

/**
 * Server-side opaque sessions.
 *
 * Only the HMAC-SHA256 hash of the session token is stored. The raw token lives
 * exclusively in the client's Secure/HttpOnly cookie.
 */
export const sessions = pgTable(
  "sessions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    sessionTokenHash: text("session_token_hash").notNull(),
    activeOrganizationId: uuid("active_organization_id").references(() => organizations.id, {
      onDelete: "set null",
    }),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    absoluteExpiresAt: timestamp("absolute_expires_at", { withTimezone: true }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true }).notNull().defaultNow(),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    ipHash: text("ip_hash"),
    userAgent: text("user_agent"),
  },
  (table) => [
    uniqueIndex("sessions_token_hash_unique").on(table.sessionTokenHash),
    index("sessions_user_id_idx").on(table.userId),
    index("sessions_expires_at_idx").on(table.expiresAt),
  ],
);

export type Session = typeof sessions.$inferSelect;
export type NewSession = typeof sessions.$inferInsert;
