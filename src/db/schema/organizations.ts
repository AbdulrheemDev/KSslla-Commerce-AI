import { check, index, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

import { organizationStatusEnum } from "@/db/schema/enums";
import { users } from "@/db/schema/users";

/** A tenant boundary. Every store and membership belongs to exactly one organization. */
export const organizations = pgTable(
  "organizations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    name: text("name").notNull(),
    slug: text("slug").notNull(),
    status: organizationStatusEnum("status").notNull().default("active"),
    createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("organizations_slug_unique").on(table.slug),
    check("organizations_slug_format_check", sql`${table.slug} ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$'`),
    index("organizations_status_idx").on(table.status),
  ],
);

export type Organization = typeof organizations.$inferSelect;
export type NewOrganization = typeof organizations.$inferInsert;
