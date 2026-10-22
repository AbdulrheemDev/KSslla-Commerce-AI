/**
 * Salla event registry → local action.
 *
 * Every name below is copied from the official lists
 * (docs/salla-reference.md §14.4, verified 2026-10-22). The registry exists so
 * the answer to "what do we do with this event?" is a table lookup rather than
 * a judgement call scattered through handlers, and so a deprecated event can be
 * accepted without being presented as current (ADR-052).
 *
 * Four classifications, and nothing else:
 *
 * - `current`      — documented and handled or deliberately ignored by us;
 * - `deprecated`   — documented as deprecated by Salla; still handled for
 *                    compatibility, never treated as current;
 * - `documented_not_consumed` — a real documented event family this phase does
 *                    not act on (shipping, brands, carts, invoices, …);
 * - `unknown`      — not in any published list. Stored, acknowledged, ignored.
 *
 * An unknown name is **not** an error: Salla adds events without asking us, and
 * a 4xx would make it redeliver something we could never accept.
 */

export type WebhookSyncResource = "products" | "categories" | "orders" | "customers" | "inventory";

export type IgnoreReason =
  | "customer_session_signal"
  | "lifecycle_not_actionable"
  | "documented_not_consumed"
  | "unknown_event";

export type WebhookAction =
  | { kind: "sync"; resource: WebhookSyncResource; also?: WebhookSyncResource[] }
  | { kind: "revoke_connection"; reason: "app_uninstalled" }
  | { kind: "record_authorization" }
  | { kind: "record_app_update" }
  | { kind: "ignore"; reason: IgnoreReason };

export type EventLifecycle = "current" | "deprecated";

export type EventClassification = EventLifecycle | "documented_not_consumed" | "unknown";

export interface EventDefinition {
  name: string;
  family: "order" | "product" | "category" | "customer" | "app";
  lifecycle: EventLifecycle;
  /** Present only for `deprecated` entries: the exact wording of the source. */
  deprecationNote?: string;
  action: WebhookAction;
}

/** Order events — Salla's "Order" table, 17 rows. */
const ORDER_EVENTS: EventDefinition[] = [
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
].map((name) => ({
  name,
  family: "order" as const,
  lifecycle: "current" as const,
  action: { kind: "sync", resource: "orders" } as WebhookAction,
}));

/**
 * Product events — Salla's "Product" table, 11 rows.
 *
 * `product.updated` and `product.available` are struck through in the official
 * table ("~~…~~"), i.e. deprecated. They stay routed because a webhook
 * registered before the deprecation may still deliver them; the row is flagged
 * so the audit trail and the UI never present them as current.
 */
const PRODUCT_EVENTS: EventDefinition[] = [
  { name: "product.created", lifecycle: "current" },
  { name: "product.deleted", lifecycle: "current" },
  {
    name: "product.quantity.low",
    lifecycle: "current",
    also: ["inventory"] as WebhookSyncResource[],
  },
  { name: "product.price.updated", lifecycle: "current" },
  { name: "product.status.updated", lifecycle: "current" },
  { name: "product.image.updated", lifecycle: "current" },
  { name: "product.category.updated", lifecycle: "current" },
  { name: "product.brand.updated", lifecycle: "current" },
  { name: "product.tags.updated", lifecycle: "current" },
  {
    name: "product.updated",
    lifecycle: "deprecated",
    deprecationNote: "Struck through in Salla's Product event table.",
  },
  {
    name: "product.available",
    lifecycle: "deprecated",
    deprecationNote: "Struck through in Salla's Product event table.",
  },
].map((entry) => ({
  name: entry.name,
  family: "product" as const,
  lifecycle: entry.lifecycle as EventLifecycle,
  ...(entry.deprecationNote ? { deprecationNote: entry.deprecationNote } : {}),
  action: {
    kind: "sync",
    resource: "products",
    ...(entry.also ? { also: entry.also } : {}),
  } as WebhookAction,
}));

const CATEGORY_EVENTS: EventDefinition[] = ["category.created", "category.updated"].map((name) => ({
  name,
  family: "category" as const,
  lifecycle: "current" as const,
  action: { kind: "sync", resource: "categories" } as WebhookAction,
}));

/**
 * Customer events.
 *
 * `customer.created`/`customer.updated` change stored state. `customer.login`
 * and `customer.otp.request` are documented security signals about a shopper
 * session — they are recognised, but they are not a reason to rewrite a row.
 */
const CUSTOMER_EVENTS: EventDefinition[] = [
  { name: "customer.created", action: { kind: "sync", resource: "customers" } },
  { name: "customer.updated", action: { kind: "sync", resource: "customers" } },
  { name: "customer.login", action: { kind: "ignore", reason: "customer_session_signal" } },
  {
    name: "customer.otp.request",
    action: { kind: "ignore", reason: "customer_session_signal" },
  },
].map((entry) => ({
  name: entry.name,
  family: "customer" as const,
  lifecycle: "current" as const,
  action: entry.action as WebhookAction,
}));

/**
 * App (partner) events — the 13 rows of the official App Events page.
 *
 * Only three are actionable: an authorization is recorded (never applied), an
 * app update is recorded (never overwrites state), and an uninstall revokes the
 * connection while keeping merchant data. The rest are lifecycle noise for this
 * phase and are ignored on purpose.
 */
const APP_EVENTS: EventDefinition[] = [
  ["app.store.authorize", { kind: "record_authorization" }],
  ["app.updated", { kind: "record_app_update" }],
  ["app.uninstalled", { kind: "revoke_connection", reason: "app_uninstalled" }],
  ["app.installed", { kind: "ignore", reason: "lifecycle_not_actionable" }],
  ["app.trial.started", { kind: "ignore", reason: "lifecycle_not_actionable" }],
  ["app.trial.expired", { kind: "ignore", reason: "lifecycle_not_actionable" }],
  ["app.trial.canceled", { kind: "ignore", reason: "lifecycle_not_actionable" }],
  ["app.subscription.started", { kind: "ignore", reason: "lifecycle_not_actionable" }],
  ["app.subscription.expired", { kind: "ignore", reason: "lifecycle_not_actionable" }],
  ["app.subscription.canceled", { kind: "ignore", reason: "lifecycle_not_actionable" }],
  ["app.subscription.renewed", { kind: "ignore", reason: "lifecycle_not_actionable" }],
  ["app.feedback.created", { kind: "ignore", reason: "lifecycle_not_actionable" }],
  ["app.settings.updated", { kind: "ignore", reason: "lifecycle_not_actionable" }],
].map(([name, action]) => ({
  name: name as string,
  family: "app" as const,
  lifecycle: "current" as const,
  action: action as WebhookAction,
}));

/**
 * Documented store-event families this phase does not consume.
 *
 * Names come from the same official page (Shipping Companies, Shipments, Brand,
 * Store, Cart, Invoice, Special Offer, Miscellaneous). They are recognised as
 * real events — so they are recorded as `documented_not_consumed`, not as
 * unknown — but nothing reacts to them: this phase has no brand, branch, cart,
 * invoice, offer, or review domain to update.
 */
const DOCUMENTED_UNCONSUMED: readonly string[] = [
  "shipping.zone.created",
  "shipping.zone.updated",
  "shipping.company.created",
  "shipping.company.updated",
  "shipping.company.deleted",
  "shipment.creating",
  "shipment.created",
  "shipment.cancelled",
  "shipment.updated",
  "brand.created",
  "brand.updated",
  "brand.deleted",
  "store.branch.created",
  "store.branch.updated",
  "store.branch.setDefault",
  "store.branch.activated",
  "store.branch.deleted",
  "storetax.created",
  "abandoned.cart",
  "coupon.applied",
  "invoice.created",
  "specialoffer.created",
  "specialoffer.updated",
  "review.added",
];

const REGISTRY: ReadonlyMap<string, EventDefinition> = new Map(
  [...ORDER_EVENTS, ...PRODUCT_EVENTS, ...CATEGORY_EVENTS, ...CUSTOMER_EVENTS, ...APP_EVENTS].map(
    (definition) => [definition.name, definition],
  ),
);

const UNCONSUMED: ReadonlySet<string> = new Set(DOCUMENTED_UNCONSUMED);

/** Full registry, for documentation, tests, and any future admin surface. */
export function eventRegistry(): readonly EventDefinition[] {
  return [...REGISTRY.values()];
}

/** Event names this phase recognises, with their lifecycle. */
export function registeredEventNames(): readonly string[] {
  return [...REGISTRY.keys()];
}

/** How a name is classified, independent of what we do with it. */
export function classifyLifecycle(eventName: string): EventClassification {
  const entry = REGISTRY.get(eventName);
  if (entry) return entry.lifecycle;
  if (UNCONSUMED.has(eventName)) return "documented_not_consumed";
  return "unknown";
}

/** The definition for a documented store/app event, or `undefined` if unknown. */
export function findEventDefinition(eventName: string): EventDefinition | undefined {
  return REGISTRY.get(eventName);
}

/** True only for names that are documented **and** not deprecated. */
export function isCurrentEvent(eventName: string): boolean {
  return REGISTRY.get(eventName)?.lifecycle === "current";
}

/** Any documented name, deprecated included. */
export function isKnownEvent(eventName: string): boolean {
  return REGISTRY.has(eventName) || UNCONSUMED.has(eventName);
}

/** Decides what to do with a delivery. Never throws, never returns `undefined`. */
export function classifyEvent(eventName: string): WebhookAction {
  const entry = REGISTRY.get(eventName);
  if (entry) return entry.action;

  if (UNCONSUMED.has(eventName)) {
    return { kind: "ignore", reason: "documented_not_consumed" };
  }

  // Documented families we have not enumerated, plus anything Salla adds later.
  return { kind: "ignore", reason: "unknown_event" };
}

/** Every resource a webhook can ask the sync engine to refresh. */
export const WEBHOOK_SYNC_RESOURCES: readonly WebhookSyncResource[] = [
  "products",
  "categories",
  "orders",
  "customers",
  "inventory",
];
