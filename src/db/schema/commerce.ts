import {
  boolean,
  index,
  integer,
  jsonb,
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
 * Orders, order lines, and customers.
 *
 * Field selection follows the documented List Orders / List Customers payloads
 * (docs/salla-reference.md §12). Two documented limitations shape the model:
 *
 * 1. `List Orders` items carry only `name`, `quantity`, and `thumbnail`. Since
 *    1 September 2026 the expanded Order Details response is unavailable, so
 *    product ids, SKUs, and line prices are **not** obtainable through the
 *    documented read API. Those columns exist, stay null, and are populated
 *    only if Salla documents a source (see §13.1).
 * 2. `List Customers` does not return `country_code`, `currency`, `lang`,
 *    `type`, `created_at`, or `birthday`; the order-embedded customer object
 *    does. Columns are nullable for that reason.
 *
 * PII minimisation (ADR-042/043): only fields the product needs are promoted to
 * columns. Customers keep no provider payload at all. Orders keep an
 * **allowlisted** snapshot (`rawPayload`) that excludes the embedded customer
 * object, `urls`, `notes`, `bank`, and `payment_actions`; nothing selects it
 * back, returns it, or logs it.
 */

export const customers = pgTable(
  "customers",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    storeId: uuid("store_id")
      .notNull()
      .references(() => stores.id, { onDelete: "cascade" }),
    externalCustomerId: text("external_customer_id").notNull(),

    firstName: text("first_name"),
    lastName: text("last_name"),
    email: text("email"),
    mobile: text("mobile"),
    mobileCode: text("mobile_code"),
    gender: text("gender"),
    /** Date only: the documented value is a date with no timezone meaning. */
    birthday: timestamp("birthday", { withTimezone: false }),
    city: text("city"),
    country: text("country"),
    countryCode: text("country_code"),
    currency: text("currency"),
    language: text("language"),
    customerType: text("customer_type"),

    /** Provider-side timestamps; metadata about the record, not a business fact. */
    sourceCreatedAt: timestamp("source_created_at", { withTimezone: true }),
    sourceUpdatedAt: timestamp("source_updated_at", { withTimezone: true }),
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("customers_store_external_unique").on(table.storeId, table.externalCustomerId),
    index("customers_org_store_idx").on(table.organizationId, table.storeId),
    index("customers_store_updated_idx").on(table.storeId, table.updatedAt),
  ],
);

export const orders = pgTable(
  "orders",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    storeId: uuid("store_id")
      .notNull()
      .references(() => stores.id, { onDelete: "cascade" }),
    externalOrderId: text("external_order_id").notNull(),
    externalReferenceId: text("external_reference_id"),
    referenceId: text("reference_id"),

    statusId: text("status_id"),
    statusName: text("status_name"),
    statusSlug: text("status_slug"),

    source: text("source"),
    totalAmount: numeric("total_amount", { precision: 14, scale: 2 }),
    currency: text("currency"),
    paymentMethod: text("payment_method"),
    isPendingPayment: boolean("is_pending_payment").notNull().default(false),
    draft: boolean("draft").notNull().default(false),

    orderDate: timestamp("order_date", { withTimezone: true }),
    /** Documented `date.timezone`, e.g. "Asia/Riyadh". Never guessed. */
    orderTimezone: text("order_timezone"),

    /**
     * Local link. `customerExternalId` is kept even when the link is missing so
     * a later customer sync can repair it without re-reading the provider.
     */
    customerId: uuid("customer_id").references(() => customers.id, { onDelete: "set null" }),
    customerExternalId: text("customer_external_id"),

    itemsCount: integer("items_count").notNull().default(0),

    /**
     * Allowlisted provider snapshot (ADR-043).
     *
     * Not the response body: only the documented keys this phase reads, with
     * `customer`, `urls`, `notes`, `bank`, `payment_actions`, `source_details`,
     * `features`, and `payment_methods` removed. No read query selects this
     * column, no endpoint returns it, and it is never logged.
     */
    rawPayload: jsonb("raw_payload").$type<Record<string, unknown>>(),

    lastSeenAt: timestamp("last_seen_at", { withTimezone: true }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("orders_store_external_unique").on(table.storeId, table.externalOrderId),
    index("orders_store_date_idx").on(table.storeId, table.orderDate),
    index("orders_store_status_idx").on(table.storeId, table.statusSlug),
    index("orders_customer_idx").on(table.customerId),
    index("orders_org_store_idx").on(table.organizationId, table.storeId),
  ],
);

/**
 * Order lines.
 *
 * Identity is `(order_id, line_number)`: the documented list response carries
 * no line id, so position within the order is the only stable key. A page is
 * written in one transaction and the order's lines are replaced wholesale,
 * which keeps re-runs idempotent.
 *
 * `linkStatus` states honestly whether the line can be tied to a local product:
 * - `linked`                      — resolved to a local `products` row;
 * - `product_not_found`          — provider gave a product id absent locally;
 * - `no_product_reference`       — provider gave no product id at all
 *                                   (the documented List Orders shape).
 */
export const orderItems = pgTable(
  "order_items",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    storeId: uuid("store_id")
      .notNull()
      .references(() => stores.id, { onDelete: "cascade" }),
    orderId: uuid("order_id")
      .notNull()
      .references(() => orders.id, { onDelete: "cascade" }),
    lineNumber: integer("line_number").notNull(),

    externalProductId: text("external_product_id"),
    externalSkuId: text("external_sku_id"),
    productId: uuid("product_id").references(() => products.id, { onDelete: "set null" }),

    productName: text("product_name").notNull(),
    sku: text("sku"),
    quantity: integer("quantity").notNull(),
    unitPrice: numeric("unit_price", { precision: 14, scale: 2 }),
    totalPrice: numeric("total_price", { precision: 14, scale: 2 }),
    thumbnailUrl: text("thumbnail_url"),
    linkStatus: text("link_status").notNull(),

    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("order_items_order_line_unique").on(table.orderId, table.lineNumber),
    index("order_items_store_product_idx").on(table.storeId, table.externalProductId),
    index("order_items_org_idx").on(table.organizationId, table.storeId),
  ],
);
