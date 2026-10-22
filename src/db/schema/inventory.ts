import {
  boolean,
  index,
  integer,
  numeric,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

import { organizations } from "@/db/schema/organizations";
import { stores } from "@/db/schema/stores";
import { products } from "@/db/schema/catalog";

/**
 * Current inventory state, one row per provider quantity entry.
 *
 * `GET /products/quantities` is a *state* endpoint: it answers "how many are
 * left right now", not "what happened". A product with variants appears once
 * per variant (`sku_id`), and a product without variants appears once with
 * `sku_id: null`. The provider does not return a stable line id, so the row key
 * is derived from the documented fields:
 *
 *   quantityKey = sku_id ? "sku:<sku_id>" : "product:<id>"
 *
 * Storage policy (ADR-043): this table is a **current-state mirror**, not a
 * history. A sync upserts at most one row per provider entry and never inserts
 * a row per sync run, so storage is bounded by catalogue size (the documented
 * example is 84 entries for a whole store) rather than by catalogue size × sync
 * frequency. "As of when" is answered by `lastSyncedAt` on the row plus the
 * `sync_runs` record for the run that wrote it. No snapshot history is kept in
 * this phase because nothing consumes history yet and per-run snapshots would
 * grow without bound (ADR-043).
 */

export const inventoryLevels = pgTable(
  "inventory_levels",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    storeId: uuid("store_id")
      .notNull()
      .references(() => stores.id, { onDelete: "cascade" }),

    quantityKey: text("quantity_key").notNull(),
    externalProductId: text("external_product_id").notNull(),
    externalSkuId: text("external_sku_id"),
    /** Local product link; null when the product is not in the local mirror. */
    productId: uuid("product_id").references(() => products.id, { onDelete: "set null" }),

    productName: text("product_name").notNull(),
    sku: text("sku"),
    variant: text("variant"),
    imageUrl: text("image_url"),

    quantity: integer("quantity").notNull(),
    soldQuantity: integer("sold_quantity").notNull(),
    unlimitedQuantity: boolean("unlimited_quantity").notNull().default(false),
    priceAmount: numeric("price_amount", { precision: 14, scale: 2 }),
    priceCurrency: text("price_currency"),

    lastSyncedAt: timestamp("last_synced_at", { withTimezone: true }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("inventory_levels_store_key_unique").on(table.storeId, table.quantityKey),
    index("inventory_levels_store_product_idx").on(table.storeId, table.externalProductId),
    index("inventory_levels_org_store_idx").on(table.organizationId, table.storeId),
  ],
);
