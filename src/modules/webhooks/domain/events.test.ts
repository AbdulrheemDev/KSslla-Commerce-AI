import { describe, expect, it } from "vitest";

import {
  classifyEvent,
  classifyLifecycle,
  eventRegistry,
  findEventDefinition,
  isCurrentEvent,
  isKnownEvent,
  registeredEventNames,
  WEBHOOK_SYNC_RESOURCES,
} from "@/modules/webhooks/domain/events";

/**
 * Event routing.
 *
 * Every name asserted here comes from the official event lists recorded in
 * docs/salla-reference.md §14.4. The point of the tests is twofold: the names we
 * claim to handle really are the documented ones, and anything else is ignored
 * rather than rejected (Salla adds events without asking us).
 */

describe("classifyEvent — order events", () => {
  it.each([
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
  ])("routes %s to a read-only order refresh", (eventName) => {
    expect(classifyEvent(eventName)).toEqual({ kind: "sync", resource: "orders" });
    expect(isKnownEvent(eventName)).toBe(true);
  });
});

describe("classifyEvent — product events", () => {
  it.each([
    "product.created",
    "product.deleted",
    "product.price.updated",
    "product.status.updated",
    "product.image.updated",
    "product.category.updated",
    "product.brand.updated",
    "product.tags.updated",
  ])("routes %s to a product refresh", (eventName) => {
    expect(classifyEvent(eventName)).toEqual({ kind: "sync", resource: "products" });
  });

  it("still handles the deprecated names, because Salla may still deliver them", () => {
    // The official table strikes these two through ("~~…~~"). They stay routed,
    // because a webhook registered before the deprecation still delivers them,
    // but they are labelled deprecated and never reported as current.
    expect(classifyEvent("product.updated")).toEqual({ kind: "sync", resource: "products" });
    expect(classifyEvent("product.available")).toEqual({ kind: "sync", resource: "products" });

    for (const eventName of ["product.updated", "product.available"]) {
      expect(classifyLifecycle(eventName)).toBe("deprecated");
      expect(isCurrentEvent(eventName)).toBe(false);
      expect(findEventDefinition(eventName)?.deprecationNote).toBeTruthy();
    }
  });

  it("refreshes inventory as well as products for a low-quantity notice", () => {
    expect(classifyEvent("product.quantity.low")).toEqual({
      kind: "sync",
      resource: "products",
      also: ["inventory"],
    });
  });
});

describe("classifyEvent — categories and customers", () => {
  it("maps documented category events", () => {
    expect(classifyEvent("category.created")).toEqual({ kind: "sync", resource: "categories" });
    expect(classifyEvent("category.updated")).toEqual({ kind: "sync", resource: "categories" });
  });

  it("maps documented customer state events", () => {
    expect(classifyEvent("customer.created")).toEqual({ kind: "sync", resource: "customers" });
    expect(classifyEvent("customer.updated")).toEqual({ kind: "sync", resource: "customers" });
  });

  it("does not turn shopper session signals into a customer rewrite", () => {
    expect(classifyEvent("customer.login")).toEqual({
      kind: "ignore",
      reason: "customer_session_signal",
    });
    expect(classifyEvent("customer.otp.request")).toEqual({
      kind: "ignore",
      reason: "customer_session_signal",
    });
  });
});

describe("classifyEvent — app lifecycle", () => {
  it("records an authorization without applying tokens", () => {
    expect(classifyEvent("app.store.authorize")).toEqual({ kind: "record_authorization" });
  });

  it("records an app update without overwriting connection state", () => {
    expect(classifyEvent("app.updated")).toEqual({ kind: "record_app_update" });
  });

  it("revokes the connection on uninstall", () => {
    expect(classifyEvent("app.uninstalled")).toEqual({
      kind: "revoke_connection",
      reason: "app_uninstalled",
    });
  });

  it("ignores other documented app events", () => {
    for (const eventName of [
      "app.installed",
      "app.trial.started",
      "app.trial.expired",
      "app.trial.canceled",
      "app.subscription.started",
      "app.subscription.expired",
      "app.subscription.canceled",
      "app.subscription.renewed",
      "app.feedback.created",
      "app.settings.updated",
    ]) {
      expect(classifyEvent(eventName)).toEqual({
        kind: "ignore",
        reason: "lifecycle_not_actionable",
      });
    }
  });
});

describe("classifyEvent — documented but not consumed", () => {
  /**
   * Real names from the official store-event tables (Shipping Companies,
   * Shipments, Brand, Store, Cart, Invoice, Special Offer, Miscellaneous).
   * Recognised so the record says "documented, not consumed" rather than
   * implying we do not know the event.
   */
  it.each([
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
  ])("acknowledges %s without acting on it", (eventName) => {
    expect(classifyEvent(eventName)).toEqual({
      kind: "ignore",
      reason: "documented_not_consumed",
    });
    expect(classifyLifecycle(eventName)).toBe("documented_not_consumed");
    expect(isKnownEvent(eventName)).toBe(true);
    expect(isCurrentEvent(eventName)).toBe(false);
  });
});

describe("classifyEvent — unknown events", () => {
  it("ignores a name it has never seen instead of throwing", () => {
    expect(classifyEvent("future.event.name")).toEqual({
      kind: "ignore",
      reason: "unknown_event",
    });
    expect(classifyLifecycle("future.event.name")).toBe("unknown");
    expect(isKnownEvent("future.event.name")).toBe(false);
  });

  it("is not fooled by prefix lookalikes or invented names", () => {
    for (const eventName of ["order.created.extra", "product", "order.created ", "Order.created"]) {
      expect(classifyEvent(eventName)).toEqual({ kind: "ignore", reason: "unknown_event" });
    }
  });
});

describe("event registry — coverage of the official tables", () => {
  it("holds exactly the documented store and app events", () => {
    // Order 17 · Product 11 · Category 2 · Customer 4 · App 13 = 47
    expect(eventRegistry()).toHaveLength(47);
    expect(new Set(registeredEventNames()).size).toBe(47);
  });

  it("counts each documented family exactly once", () => {
    const counts = eventRegistry().reduce<Record<string, number>>((accumulator, entry) => {
      accumulator[entry.family] = (accumulator[entry.family] ?? 0) + 1;
      return accumulator;
    }, {});

    expect(counts).toEqual({ order: 17, product: 11, category: 2, customer: 4, app: 13 });
  });

  it("marks only the two struck-through product events as deprecated", () => {
    const deprecated = eventRegistry()
      .filter((entry) => entry.lifecycle === "deprecated")
      .map((entry) => entry.name)
      .sort();

    expect(deprecated).toEqual(["product.available", "product.updated"]);
  });

  it("keeps every sync target inside the sync engine's resource list", () => {
    for (const entry of eventRegistry()) {
      if (entry.action.kind !== "sync") continue;
      expect(WEBHOOK_SYNC_RESOURCES).toContain(entry.action.resource);
      for (const extra of entry.action.also ?? []) {
        expect(WEBHOOK_SYNC_RESOURCES).toContain(extra);
      }
    }
  });
});

describe("WEBHOOK_SYNC_RESOURCES", () => {
  it("covers every resource the engine can refresh", () => {
    expect([...WEBHOOK_SYNC_RESOURCES]).toEqual([
      "products",
      "categories",
      "orders",
      "customers",
      "inventory",
    ]);
  });
});
