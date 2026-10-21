import { index, pgTable, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";

import { memberRoleEnum, memberStatusEnum } from "@/db/schema/enums";
import { organizations } from "@/db/schema/organizations";
import { users } from "@/db/schema/users";

/**
 * Membership links a user to an organization with a role.
 *
 * `(organization_id, user_id)` is unique, so an account can never hold two
 * parallel memberships in the same organization. Removing a member keeps the row
 * with status `removed`; re-inviting reactivates it.
 */
export const organizationMembers = pgTable(
  "organization_members",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    role: memberRoleEnum("role").notNull().default("viewer"),
    status: memberStatusEnum("status").notNull().default("active"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("organization_members_org_user_unique").on(table.organizationId, table.userId),
    index("organization_members_user_status_idx").on(table.userId, table.status),
    index("organization_members_org_status_idx").on(table.organizationId, table.status),
  ],
);

export type OrganizationMember = typeof organizationMembers.$inferSelect;
export type NewOrganizationMember = typeof organizationMembers.$inferInsert;
