import { and, count, eq, inArray, sql } from "drizzle-orm";

import type { DbExecutor } from "@/db/executor";
import { customers, orderItems, orders, products } from "@/db/schema";
import type { OrderInput, OrderItemInput } from "@/modules/orders/domain/types";
import { upsertCustomers } from "@/modules/customers/infrastructure/customer-repository";

/**
 * Order persistence.
 *
 * One order page is written in one transaction by the sync service. Within that
 * transaction:
 *
 * 1. embedded customers are upserted in `enrich` mode, so a missing customer is
 *    created and an existing one is never overwritten with an older snapshot;
 * 2. orders are upserted on `(store_id, external_order_id)`;
 * 3. the page's lines replace the stored lines for those orders, which makes a
 *    re-run idempotent even when the provider renumbers a line.
 *
 * Nothing is ever deleted from `orders` or `customers`: the documented read API
 * cannot enumerate removals (ADR-038).
 */

export interface OrderUpsertResult {
  created: number;
  updated: number;
  items: number;
  linked: number;
  skipped: number;
}

export async function upsertOrders(
  db: DbExecutor,
  input: {
    organizationId: string;
    storeId: string;
    items: readonly OrderInput[];
    seenAt: Date;
  },
): Promise<OrderUpsertResult> {
  if (input.items.length === 0) {
    return { created: 0, updated: 0, items: 0, linked: 0, skipped: 0 };
  }

  // A page can repeat an order only if the provider is broken; dedupe anyway so
  // one INSERT never hits the same conflict target twice.
  const unique = new Map<string, OrderInput>();
  for (const order of input.items) unique.set(order.externalOrderId, order);
  const page = [...unique.values()];

  const embedded = page
    .map((order) => order.customer)
    .filter((customer): customer is NonNullable<typeof customer> => customer !== null);

  const customerIds = embedded.length
    ? await upsertCustomers(db, {
        organizationId: input.organizationId,
        storeId: input.storeId,
        items: embedded,
        seenAt: input.seenAt,
        mode: "enrich",
      })
    : { created: 0, updated: 0, idByExternalId: new Map<string, string>() };

  const rows = await db
    .insert(orders)
    .values(
      page.map((order) => ({
        organizationId: input.organizationId,
        storeId: input.storeId,
        externalOrderId: order.externalOrderId,
        externalReferenceId: order.externalReferenceId,
        referenceId: order.referenceId,
        statusId: order.statusId,
        statusName: order.statusName,
        statusSlug: order.statusSlug,
        source: order.source,
        totalAmount: order.totalAmount,
        currency: order.currency,
        paymentMethod: order.paymentMethod,
        isPendingPayment: order.isPendingPayment,
        draft: order.draft,
        orderDate: order.orderDate,
        orderTimezone: order.orderTimezone,
        customerExternalId: order.customerExternalId,
        customerId: order.customerExternalId
          ? (customerIds.idByExternalId.get(order.customerExternalId) ?? null)
          : null,
        itemsCount: order.items.length,
        rawPayload: order.rawPayload,
        lastSeenAt: input.seenAt,
      })),
    )
    .onConflictDoUpdate({
      target: [orders.storeId, orders.externalOrderId],
      set: {
        externalReferenceId: sql`excluded.external_reference_id`,
        referenceId: sql`excluded.reference_id`,
        statusId: sql`excluded.status_id`,
        statusName: sql`excluded.status_name`,
        statusSlug: sql`excluded.status_slug`,
        source: sql`excluded.source`,
        totalAmount: sql`excluded.total_amount`,
        currency: sql`excluded.currency`,
        paymentMethod: sql`excluded.payment_method`,
        isPendingPayment: sql`excluded.is_pending_payment`,
        draft: sql`excluded.draft`,
        orderDate: sql`excluded.order_date`,
        orderTimezone: sql`excluded.order_timezone`,
        customerExternalId: sql`excluded.customer_external_id`,
        // Keep a previously resolved link when this payload carries no customer.
        customerId: sql`coalesce(excluded.customer_id, ${orders.customerId})`,
        itemsCount: sql`excluded.items_count`,
        // The allowlist is rebuilt every run, so the snapshot always matches
        // the payload that produced the current columns (ADR-043).
        rawPayload: sql`excluded.raw_payload`,
        lastSeenAt: sql`excluded.last_seen_at`,
        updatedAt: sql`now()`,
      },
    })
    .returning({
      id: orders.id,
      externalOrderId: orders.externalOrderId,
      created: sql<boolean>`(xmax = 0)`,
    });

  const orderIdByExternal = new Map(rows.map((row) => [row.externalOrderId, row.id]));
  const orderIds = rows.map((row) => row.id);

  // Replace lines for this page's orders: idempotent, and it removes a line the
  // merchant genuinely deleted in Salla without touching other orders.
  await db.delete(orderItems).where(inArray(orderItems.orderId, orderIds));

  const lines = page.flatMap((order) => {
    const orderId = orderIdByExternal.get(order.externalOrderId);
    if (!orderId) return [];
    return order.items.map((item) => ({ orderId, item }));
  });

  const externalProductIds = [
    ...new Set(
      lines
        .map(({ item }) => item.externalProductId)
        .filter((value): value is string => value !== null),
    ),
  ];

  const productIdsByExternal = new Map<string, string>();
  if (externalProductIds.length > 0) {
    const productRows = await db
      .select({ id: products.id, externalProductId: products.externalProductId })
      .from(products)
      .where(
        and(
          eq(products.storeId, input.storeId),
          inArray(products.externalProductId, externalProductIds),
        ),
      );
    for (const row of productRows) productIdsByExternal.set(row.externalProductId, row.id);
  }

  let linked = 0;
  let skipped = 0;

  const values = lines.map(({ orderId, item }) => {
    const resolved = resolveLink(item, productIdsByExternal);
    if (resolved.linkStatus === "linked") linked += 1;
    else skipped += 1;

    return {
      organizationId: input.organizationId,
      storeId: input.storeId,
      orderId,
      lineNumber: item.lineNumber,
      externalProductId: item.externalProductId,
      externalSkuId: item.externalSkuId,
      productId: resolved.productId,
      productName: item.productName,
      sku: item.sku,
      quantity: item.quantity,
      unitPrice: item.unitPrice,
      totalPrice: item.totalPrice,
      thumbnailUrl: item.thumbnailUrl,
      linkStatus: resolved.linkStatus,
    };
  });

  if (values.length > 0) await db.insert(orderItems).values(values);

  const created = rows.filter((row) => row.created).length;

  return {
    created,
    updated: rows.length - created,
    items: rows.length,
    linked,
    skipped,
  };
}

/**
 * Resolves a line to a local product.
 *
 * Today `externalProductId` is always null because the documented list payload
 * carries no product reference. The resolution path exists so a documented
 * source can be wired in without changing the table or the counters.
 */
function resolveLink(
  item: OrderItemInput,
  productIdsByExternal: ReadonlyMap<string, string>,
): { productId: string | null; linkStatus: OrderItemInput["linkStatus"] } {
  if (!item.externalProductId) {
    return { productId: null, linkStatus: "no_product_reference" };
  }

  const productId = productIdsByExternal.get(item.externalProductId) ?? null;
  return productId
    ? { productId, linkStatus: "linked" }
    : { productId: null, linkStatus: "product_not_found" };
}

export interface OrderListRow {
  id: string;
  externalOrderId: string;
  statusName: string | null;
  statusSlug: string | null;
  totalAmount: string | null;
  currency: string | null;
  orderDate: Date | null;
  orderTimezone: string | null;
  customerName: string | null;
  itemsCount: number;
  draft: boolean;
  isPendingPayment: boolean;
  lastSeenAt: Date;
}

export async function listOrders(
  db: DbExecutor,
  input: { storeId: string; limit: number; offset: number },
): Promise<{ rows: OrderListRow[]; total: number }> {
  const [rows, totals] = await Promise.all([
    db
      .select({
        id: orders.id,
        externalOrderId: orders.externalOrderId,
        statusName: orders.statusName,
        statusSlug: orders.statusSlug,
        totalAmount: orders.totalAmount,
        currency: orders.currency,
        orderDate: orders.orderDate,
        orderTimezone: orders.orderTimezone,
        customerName: sql<
          string | null
        >`nullif(trim(concat_ws(' ', ${customers.firstName}, ${customers.lastName})), '')`,
        itemsCount: orders.itemsCount,
        draft: orders.draft,
        isPendingPayment: orders.isPendingPayment,
        lastSeenAt: orders.lastSeenAt,
      })
      .from(orders)
      .leftJoin(customers, eq(customers.id, orders.customerId))
      .where(eq(orders.storeId, input.storeId))
      .orderBy(sql`${orders.orderDate} desc nulls last`, sql`${orders.externalOrderId} desc`)
      .limit(input.limit)
      .offset(input.offset),
    db.select({ value: count() }).from(orders).where(eq(orders.storeId, input.storeId)),
  ]);

  return { rows, total: Number(totals[0]?.value ?? 0) };
}

export async function orderStats(
  db: DbExecutor,
  storeId: string,
): Promise<{ total: number; lastOrderAt: Date | null; drafts: number; pendingPayment: number }> {
  const [row] = await db
    .select({
      total: count(),
      lastOrderAt: sql<Date | null>`max(${orders.orderDate})`,
      drafts: sql<number>`count(*) filter (where ${orders.draft} = true)`,
      pendingPayment: sql<number>`count(*) filter (where ${orders.isPendingPayment} = true)`,
    })
    .from(orders)
    .where(eq(orders.storeId, storeId));

  return {
    total: Number(row?.total ?? 0),
    lastOrderAt: row?.lastOrderAt ? new Date(row.lastOrderAt) : null,
    drafts: Number(row?.drafts ?? 0),
    pendingPayment: Number(row?.pendingPayment ?? 0),
  };
}

export async function countOrderItems(db: DbExecutor, storeId: string): Promise<number> {
  const [row] = await db
    .select({ value: count() })
    .from(orderItems)
    .where(eq(orderItems.storeId, storeId));
  return Number(row?.value ?? 0);
}

/** Test/verification helper: how many lines of a store report a given link state. */
export async function countOrderItemsByLinkStatus(
  db: DbExecutor,
  storeId: string,
  linkStatus: string,
): Promise<number> {
  const [row] = await db
    .select({ value: count() })
    .from(orderItems)
    .where(and(eq(orderItems.storeId, storeId), eq(orderItems.linkStatus, linkStatus)));
  return Number(row?.value ?? 0);
}
