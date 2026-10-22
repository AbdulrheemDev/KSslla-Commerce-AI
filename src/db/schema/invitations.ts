import { check, index, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

import { memberRoleEnum } from "@/db/schema/enums";
import { organizations } from "@/db/schema/organizations";
import { users } from "@/db/schema/users";

/**
 * Email invitations. Raw tokens are never stored; only an HMAC-SHA256 hash is
 * persisted, and the raw token is returned exactly once to the inviter.
 */
export const invitations = pgTable(
  "invitations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    email: text("email").notNull(),
    role: memberRoleEnum("role").notNull().default("viewer"),
    tokenHash: text("token_hash").notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    acceptedAt: timestamp("accepted_at", { withTimezone: true }),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("invitations_token_hash_unique").on(table.tokenHash),
    uniqueIndex("invitations_pending_unique")
      .on(table.organizationId, table.email)
      .where(sql`${table.acceptedAt} is null and ${table.revokedAt} is null`),
    check("invitations_email_normalized_check", sql`${table.email} = lower(btrim(${table.email}))`),
    index("invitations_org_created_idx").on(table.organizationId, table.createdAt),
  ],
);

export type Invitation = typeof invitations.$inferSelect;
export type NewInvitation = typeof invitations.$inferInsert;
