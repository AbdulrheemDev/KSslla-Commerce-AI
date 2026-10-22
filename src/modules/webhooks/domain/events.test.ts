import { describe, expect, it } from "vitest";

import {
  classifyEvent,
  isKnownEvent,
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
    // docs: product.updated and product.available are marked deprecated; a
    // merchant that registered a webhook earlier still receives them.
    expect(classifyEvent("product.updated")).toEqual({ kind: "sync", resource: "products" });
    expect(classifyEvent("product.available")).toEqual({ kind: "sync", resource: "products" });
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

describe("classifyEvent — unknown and out-of-scope events", () => {
  it("ignores documented families this phase does not consume", () => {
    for (const eventName of [
      "shipping.company.created",
      "brand.updated",
      "cart.updated",
      "invoice.created",
      "store.branch.updated",
    ]) {
      expect(classifyEvent(eventName)).toEqual({ kind: "ignore", reason: "unsupported_event" });
      expect(isKnownEvent(eventName)).toBe(false);
    }
  });

  it("ignores a name it has never seen instead of throwing", () => {
    expect(classifyEvent("future.event.name")).toEqual({
      kind: "ignore",
      reason: "unsupported_event",
    });
  });

  it("is not fooled by prefix lookalikes", () => {
    expect(classifyEvent("order.created.extra")).toEqual({
      kind: "ignore",
      reason: "unsupported_event",
    });
    expect(classifyEvent("product")).toEqual({ kind: "ignore", reason: "unsupported_event" });
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
