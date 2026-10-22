import { describe, expect, it } from "vitest";

import { sallaQuantityDtoSchema } from "@/modules/inventory/domain/dto";
import { mapQuantity, quantityKeyFor } from "@/modules/inventory/domain/mappers";

/** Quantity mapping tests, using both documented `price` shapes. */

describe("quantity DTO", () => {
  it("accepts a numeric and a string price", () => {
    const numeric = sallaQuantityDtoSchema.parse({
      id: 1,
      name: "منتج",
      quantity: 4,
      sold_quantity: 2,
      price: 127,
      unlimited_quantity: false,
      sku_id: null,
      variant: null,
    });
    const text = sallaQuantityDtoSchema.parse({
      id: 2,
      name: "منتج",
      quantity: "0",
      sold_quantity: "5",
      price: "127.00",
      unlimited_quantity: true,
    });

    expect(numeric.price).toBe(127);
    expect(text.price).toBe("127.00");
  });
});

describe("quantity mapper", () => {
  it("keys a product without variants by product id", () => {
    const mapped = mapQuantity(
      sallaQuantityDtoSchema.parse({
        id: 1730800454,
        name: "SSD",
        sku_id: null,
        sku: "sam-ssd-128g",
        quantity: 127,
        sold_quantity: 340,
        price: "150.00",
        unlimited_quantity: false,
        variant: null,
      }),
    );

    expect(mapped.quantityKey).toBe("product:1730800454");
    expect(mapped.externalSkuId).toBeNull();
    expect(mapped.externalProductId).toBe("1730800454");
    expect(mapped.priceAmount).toBe("150.00");
    expect(mapped.sku).toBe("sam-ssd-128g");
  });

  it("keys each variant by sku_id so variants never collapse", () => {
    const first = mapQuantity(
      sallaQuantityDtoSchema.parse({
        id: 357354565,
        name: "service",
        sku_id: 1141551363,
        sku: null,
        quantity: 0,
        sold_quantity: 0,
        price: 127,
        unlimited_quantity: true,
        variant: "Fast - red",
      }),
    );
    const second = mapQuantity(
      sallaQuantityDtoSchema.parse({
        id: 357354565,
        name: "service",
        sku_id: 299356172,
        sku: null,
        quantity: 0,
        sold_quantity: 0,
        price: 127,
        unlimited_quantity: true,
        variant: "Slow - white",
      }),
    );

    expect(first.quantityKey).toBe("sku:1141551363");
    expect(second.quantityKey).toBe("sku:299356172");
    expect(first.quantityKey).not.toBe(second.quantityKey);
  });

  it("treats a missing boolean as false and a missing quantity as zero", () => {
    const mapped = mapQuantity(sallaQuantityDtoSchema.parse({ id: 5, name: "منتج" }));
    expect(mapped.unlimitedQuantity).toBe(false);
    expect(mapped.quantity).toBe(0);
    expect(mapped.soldQuantity).toBe(0);
    expect(mapped.priceAmount).toBeNull();
  });

  it("builds a stable key helper", () => {
    expect(quantityKeyFor({ id: "1", skuId: null })).toBe("product:1");
    expect(quantityKeyFor({ id: "1", skuId: "2" })).toBe("sku:2");
  });
});
