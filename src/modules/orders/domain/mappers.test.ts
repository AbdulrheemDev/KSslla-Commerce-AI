import { describe, expect, it } from "vitest";

import { sallaOrderListSchema } from "@/modules/orders/domain/dto";
import { buildRawPayload, formatOrderWallClock, mapOrder } from "@/modules/orders/domain/mappers";

/**
 * Order mapping tests.
 *
 * The fixture is the documented List Orders shape. The important assertions are
 * about what the payload does **not** contain: no product id, SKU, or line
 * price, so those columns must stay null and say why.
 */

const documentedOrder = {
  id: 560000001,
  external_reference_id: "EXT-1",
  reference_id: "REF-1",
  total: { amount: "129.00", currency: "SAR" },
  date: { date: "2026-10-20 14:33:00.000000", timezone_type: 3, timezone: "Asia/Riyadh" },
  source: "web",
  status: { id: 1978235176, name: "مكتمل", slug: "completed" },
  draft: false,
  payment_method: "mada",
  is_pending_payment: false,
  items: [
    { name: "عطر قريس 100 مل", quantity: 2, thumbnail: null },
    { name: "SSD 128G", quantity: "1", thumbnail: null },
  ],
  customer: {
    id: 700100000,
    first_name: "نورة",
    last_name: "العتيبي",
    mobile: { number: 512345671, mobile_code: "+966" },
    email: "noura@example.test",
    city: "الرياض",
    country: "السعودية",
    country_code: "SA",
    currency: "SAR",
    lang: "ar",
    type: "user",
    created_at: { date: "2025-01-02 10:00:00.000000" },
    updated_at: { date: "2026-09-02 10:00:00.000000" },
  },
};

describe("order DTO", () => {
  it("parses the documented envelope", () => {
    const parsed = sallaOrderListSchema.parse({
      status: 200,
      success: true,
      data: [documentedOrder],
      pagination: {
        count: 1,
        total: 67,
        perPage: 30,
        currentPage: 1,
        totalPages: 3,
        links: { next: "?page=2" },
      },
    });

    expect(parsed.data[0]?.id).toBe("560000001");
  });

  it("rejects an order without an id", () => {
    expect(() =>
      sallaOrderListSchema.parse({
        data: [{ total: {} }],
        pagination: { currentPage: 1, totalPages: 1 },
      }),
    ).toThrow();
  });
});

describe("order mapper", () => {
  it("maps every documented field", () => {
    const order = mapOrder(
      sallaOrderListSchema.parse({
        data: [documentedOrder],
        pagination: { currentPage: 1, totalPages: 1 },
      }).data[0]!,
    );

    expect(order.externalOrderId).toBe("560000001");
    expect(order.externalReferenceId).toBe("EXT-1");
    expect(order.referenceId).toBe("REF-1");
    expect(order.statusName).toBe("مكتمل");
    expect(order.statusSlug).toBe("completed");
    expect(order.totalAmount).toBe("129.00");
    expect(order.currency).toBe("SAR");
    expect(order.paymentMethod).toBe("mada");
    expect(order.isPendingPayment).toBe(false);
    expect(order.draft).toBe(false);
    expect(order.orderTimezone).toBe("Asia/Riyadh");
    expect(order.customerExternalId).toBe("700100000");
    expect(order.customer?.firstName).toBe("نورة");
    expect(order.customer?.mobileCode).toBe("+966");
  });

  it("keeps the line fields nullable and records why they are unavailable", () => {
    const order = mapOrder(
      sallaOrderListSchema.parse({
        data: [documentedOrder],
        pagination: { currentPage: 1, totalPages: 1 },
      }).data[0]!,
    );

    expect(order.items).toHaveLength(2);
    for (const [index, item] of order.items.entries()) {
      expect(item.lineNumber).toBe(index + 1);
      expect(item.externalProductId).toBeNull();
      expect(item.externalSkuId).toBeNull();
      expect(item.sku).toBeNull();
      expect(item.unitPrice).toBeNull();
      expect(item.totalPrice).toBeNull();
      expect(item.linkStatus).toBe("no_product_reference");
      expect(item.productName.length).toBeGreaterThan(0);
    }

    expect(order.items[1]?.quantity).toBe(1);
  });

  it("never shifts the wall clock and keeps the zone", () => {
    const order = mapOrder(
      sallaOrderListSchema.parse({
        data: [documentedOrder],
        pagination: { currentPage: 1, totalPages: 1 },
      }).data[0]!,
    );

    expect(formatOrderWallClock(order.orderDate)).toBe("2026-10-20 14:33");
    expect(order.orderTimezone).toBe("Asia/Riyadh");
  });

  it("stores an allowlisted snapshot with no customer or payment secrets", () => {
    const parsed = sallaOrderListSchema.parse({
      data: [
        {
          ...documentedOrder,
          // Documented on Order Details only; must never be stored or logged.
          notes: "اتصل قبل التوصيل",
          bank: { iban_number: "SA0380000000608010167519" },
          urls: { customer: "https://salla.sa/orders/abc?token=secret" },
          payment_actions: [{ url: "https://pay.example.test/secret" }],
          source_details: { utm_source: "ads" },
          // An undocumented future key must not slip in through a denylist.
          future_field: "should not be stored",
        },
      ],
      pagination: { currentPage: 1, totalPages: 1 },
    });

    const raw = buildRawPayload(parsed.data[0]!);
    expect(raw).not.toBeNull();

    const serialised = JSON.stringify(raw);
    expect(serialised).not.toContain("iban");
    expect(serialised).not.toContain("اتصل قبل التوصيل");
    expect(serialised).not.toContain("secret");
    expect(serialised).not.toContain("future_field");
    expect(serialised).not.toContain("noura@example.test");
    expect(serialised).not.toContain("512345671");

    expect(Object.keys(raw!).sort()).toEqual(
      [
        "date",
        "draft",
        "external_reference_id",
        "id",
        "is_pending_payment",
        "items",
        "payment_method",
        "reference_id",
        "source",
        "status",
        "total",
      ].sort(),
    );
    expect(raw!.status).toEqual({ id: 1978235176, name: "مكتمل", slug: "completed" });
    expect(raw!.items).toEqual([
      { name: "عطر قريس 100 مل", quantity: 2, thumbnail: null },
      { name: "SSD 128G", quantity: "1", thumbnail: null },
    ]);

    // The mapped order carries the same snapshot the repository persists.
    expect(mapOrder(parsed.data[0]!).rawPayload).toEqual(raw);
  });

  it("tolerates a missing customer and missing date", () => {
    const order = mapOrder(
      sallaOrderListSchema.parse({
        data: [{ id: 1 }],
        pagination: { currentPage: 1, totalPages: 1 },
      }).data[0]!,
    );

    expect(order.customer).toBeNull();
    expect(order.customerExternalId).toBeNull();
    expect(order.orderDate).toBeNull();
    expect(order.orderTimezone).toBeNull();
    expect(order.totalAmount).toBeNull();
    expect(order.isPendingPayment).toBe(false);
    expect(order.draft).toBe(false);
  });
});
