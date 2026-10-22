/**
 * Salla event catalogue → local action.
 *
 * Every name below is taken from the official list
 * (docs/salla-reference.md §14.4). Nothing is invented, and a name that is not
 * in this table is **not** an error: Salla adds events, so an unknown name is
 * persisted and marked `ignored` (ADR-049).
 */

export type WebhookSyncResource = "products" | "categories" | "orders" | "customers" | "inventory";

export type WebhookAction =
  | { kind: "sync"; resource: WebhookSyncResource; also?: WebhookSyncResource[] }
  | { kind: "revoke_connection"; reason: "app_uninstalled" }
  | { kind: "record_authorization" }
  | { kind: "record_app_update" }
  | { kind: "ignore"; reason: string };

/** Order events documented on the Salla webhook events page. */
const ORDER_EVENTS = new Set([
  "order.created",
  "order.updated",
  "order.status.updated",
  "order.cancelled",
  "order.refunded",
  "order.deleted",
  "order.products.updated",
  "order.payment.updated",
  "order.coupon.updated",
  "order.total.price.updated",
  "order.shipment.creating",
  "order.shipment.created",
  "order.shipment.cancelled",
  "order.shipment.return.creating",
  "order.shipment.return.created",
  "order.shipment.return.cancelled",
  "order.shipping.address.updated",
]);

/** Product events; `product.updated` and `product.available` are deprecated but still delivered. */
const PRODUCT_EVENTS = new Set([
  "product.created",
  "product.updated",
  "product.deleted",
  "product.available",
  "product.quantity.low",
  "product.price.updated",
  "product.status.updated",
  "product.image.updated",
  "product.category.updated",
  "product.brand.updated",
  "product.tags.updated",
]);

const CATEGORY_EVENTS = new Set(["category.created", "category.updated"]);

/**
 * Customer events that change stored state. `customer.login` and
 * `customer.otp.request` are security signals about a shopper session; they are
 * documented, but they are not a reason to rewrite a customer row.
 */
const CUSTOMER_SYNC_EVENTS = new Set(["customer.created", "customer.updated"]);
const CUSTOMER_NOOP_EVENTS = new Set(["customer.login", "customer.otp.request"]);

const APP_EVENTS = new Set([
  "app.store.authorize",
  "app.installed",
  "app.updated",
  "app.uninstalled",
  "app.trial.started",
  "app.trial.expired",
  "app.trial.canceled",
  "app.subscription.started",
  "app.subscription.expired",
  "app.subscription.canceled",
  "app.subscription.renewed",
  "app.feedback.created",
  "app.settings.updated",
]);

export function classifyEvent(eventName: string): WebhookAction {
  if (ORDER_EVENTS.has(eventName)) return { kind: "sync", resource: "orders" };

  // A low-stock notice is a quantity change: the product row carries `quantity`
  // and the inventory table carries the per-quantity state, and both are read
  // from the API rather than from the payload.
  if (eventName === "product.quantity.low") {
    return { kind: "sync", resource: "products", also: ["inventory"] };
  }

  if (PRODUCT_EVENTS.has(eventName)) return { kind: "sync", resource: "products" };
  if (CATEGORY_EVENTS.has(eventName)) return { kind: "sync", resource: "categories" };
  if (CUSTOMER_SYNC_EVENTS.has(eventName)) return { kind: "sync", resource: "customers" };
  if (CUSTOMER_NOOP_EVENTS.has(eventName))
    return { kind: "ignore", reason: "customer_session_signal" };

  if (eventName === "app.store.authorize") return { kind: "record_authorization" };
  if (eventName === "app.updated") return { kind: "record_app_update" };
  if (eventName === "app.uninstalled")
    return { kind: "revoke_connection", reason: "app_uninstalled" };

  if (APP_EVENTS.has(eventName)) return { kind: "ignore", reason: "lifecycle_not_actionable" };

  // Documented store families this phase does not consume (shipping, brands,
  // carts, invoices, special offers, reviews, store branches) plus anything
  // Salla adds later. Stored, acknowledged, never silently dropped.
  return { kind: "ignore", reason: "unsupported_event" };
}

export function isKnownEvent(eventName: string): boolean {
  return (
    ORDER_EVENTS.has(eventName) ||
    PRODUCT_EVENTS.has(eventName) ||
    CATEGORY_EVENTS.has(eventName) ||
    CUSTOMER_SYNC_EVENTS.has(eventName) ||
    CUSTOMER_NOOP_EVENTS.has(eventName) ||
    APP_EVENTS.has(eventName)
  );
}

/** Every resource a webhook can ask the sync engine to refresh. */
export const WEBHOOK_SYNC_RESOURCES: readonly WebhookSyncResource[] = [
  "products",
  "categories",
  "orders",
  "customers",
  "inventory",
];
