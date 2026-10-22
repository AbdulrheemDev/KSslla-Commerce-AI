import { sql } from "drizzle-orm";
import {
  type AnyPgColumn,
  boolean,
  index,
  integer,
  jsonb,
  numeric,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

import { organizations } from "@/db/schema/organizations";
import { stores } from "@/db/schema/stores";

/**
 * Local catalogue mirror.
 *
 * Field selection follows the documented List Products / List Categories
 * payloads (docs/salla-reference.md §2.2–2.3). Only fields this phase actually
 * reads are promoted to columns; the rest of the provider payload is not
 * stored wholesale. `metadata` is a deliberately small compatibility bag
 * (`urls`, `show_in`, Salla `metadata`, ...) and no domain rule depends on it.
 *
 * `lastSeenAt` records the last successful observation. It is **not** a delete
 * flag: Salla documents no reliable way to enumerate removals through the list
 * endpoints, so this phase never deletes a row automatically.
 */

export const categories = pgTable(
  "categories",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    storeId: uuid("store_id")
      .notNull()
      .references(() => stores.id, { onDelete: "cascade" }),
    externalCategoryId: text("external_category_id").notNull(),
    name: text("name").notNull(),
    parentExternalId: text("parent_external_id"),
    parentCategoryId: uuid("parent_category_id").references((): AnyPgColumn => categories.id, {
      onDelete: "set null",
    }),
    status: text("status").notNull(),
    sortOrder: integer("sort_order"),
    imageUrl: text("image_url"),
    sourceUpdatedAt: timestamp("source_updated_at", { withTimezone: true }),
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true }).notNull(),
    metadata: jsonb("metadata")
      .notNull()
      .default(sql`'{}'::jsonb`),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("categories_store_external_unique").on(table.storeId, table.externalCategoryId),
    index("categories_store_parent_idx").on(table.storeId, table.parentCategoryId),
    index("categories_org_store_idx").on(table.organizationId, table.storeId),
  ],
);

export const products = pgTable(
  "products",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    storeId: uuid("store_id")
      .notNull()
      .references(() => stores.id, { onDelete: "cascade" }),
    externalProductId: text("external_product_id").notNull(),
    name: text("name").notNull(),
    sku: text("sku"),
    productType: text("product_type"),
    status: text("status").notNull(),
    /** Money is stored as an exact decimal; provider strings are never coerced to floats. */
    priceAmount: numeric("price_amount", { precision: 14, scale: 2 }),
    currency: text("currency"),
    regularPriceAmount: numeric("regular_price_amount", { precision: 14, scale: 2 }),
    salePriceAmount: numeric("sale_price_amount", { precision: 14, scale: 2 }),
    quantity: integer("quantity"),
    isAvailable: boolean("is_available").notNull().default(false),
    url: text("url"),
    imageUrl: text("image_url"),
    description: text("description"),
    brandName: text("brand_name"),
    sourceUpdatedAt: timestamp("source_updated_at", { withTimezone: true }),
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true }).notNull(),
    metadata: jsonb("metadata")
      .notNull()
      .default(sql`'{}'::jsonb`),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("products_store_external_unique").on(table.storeId, table.externalProductId),
    index("products_store_status_idx").on(table.storeId, table.status),
    index("products_store_updated_idx").on(table.storeId, table.updatedAt),
    index("products_org_store_idx").on(table.organizationId, table.storeId),
  ],
);

/**
 * Product ↔ category links.
 *
 * Composite primary key: a pair can exist once. `organizationId` and `storeId`
 * are denormalised on purpose so row-level security can be evaluated without a
 * join (the same pattern as every other tenant table).
 */
export const productCategories = pgTable(
  "product_categories",
  {
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    storeId: uuid("store_id")
      .notNull()
      .references(() => stores.id, { onDelete: "cascade" }),
    productId: uuid("product_id")
      .notNull()
      .references(() => products.id, { onDelete: "cascade" }),
    categoryId: uuid("category_id")
      .notNull()
      .references(() => categories.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    primaryKey({ columns: [table.productId, table.categoryId] }),
    index("product_categories_store_category_idx").on(table.storeId, table.categoryId),
    index("product_categories_org_idx").on(table.organizationId),
  ],
);

export type Product = typeof products.$inferSelect;
export type NewProduct = typeof products.$inferInsert;
export type Category = typeof categories.$inferSelect;
export type NewCategory = typeof categories.$inferInsert;
export type ProductCategory = typeof productCategories.$inferSelect;
