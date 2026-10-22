import { describe, expect, it } from "vitest";

import { sallaCategoryDtoSchema, sallaProductDtoSchema } from "@/modules/catalog/domain/dto";
import {
  mapCategory,
  mapProduct,
  parseSallaTimestamp,
  toInteger,
  toMoneyString,
} from "@/modules/catalog/domain/mappers";

const productPayload = {
  id: 1672932878,
  name: "T-Shirt",
  sku: "",
  type: "product",
  status: "sale",
  description: "  ",
  url: "https://salla.sa/dev/t-shirt/p1672932878",
  thumbnail: "https://cdn.example/thumb.jpg",
  main_image: "https://cdn.example/main.jpg",
  price: { amount: 100, currency: "SAR" },
  regular_price: { amount: "159.5", currency: "SAR" },
  sale_price: {},
  quantity: "50",
  is_available: true,
  updated_at: "2024-03-06 13:50:32",
  categories: [{ id: 1032561074 }, { id: "1032561074" }, { id: 256950451 }],
  brand: { id: 1097509908, name: "Acme" },
  urls: { customer: "https://salla.sa/x" },
  metadata: { title: "Chocolate bar" },
};

describe("product mapping", () => {
  it("maps the documented payload onto the domain object", () => {
    const dto = sallaProductDtoSchema.parse(productPayload);
    const product = mapProduct(dto);

    expect(product.externalId).toBe("1672932878");
    expect(product.name).toBe("T-Shirt");
    expect(product.status).toBe("sale");
    expect(product.productType).toBe("product");
    expect(product.priceAmount).toBe("100.00");
    expect(product.regularPriceAmount).toBe("159.50");
    expect(product.salePriceAmount).toBeNull();
    expect(product.quantity).toBe(50);
    expect(product.isAvailable).toBe(true);
    expect(product.brandName).toBe("Acme");
    expect(product.imageUrl).toBe("https://cdn.example/main.jpg");
  });

  it("normalises empty strings to null instead of storing blanks", () => {
    const product = mapProduct(sallaProductDtoSchema.parse(productPayload));

    expect(product.sku).toBeNull();
    expect(product.description).toBeNull();
  });

  it("deduplicates category references and keeps them as strings", () => {
    const product = mapProduct(sallaProductDtoSchema.parse(productPayload));

    expect(product.categoryExternalIds).toEqual(["1032561074", "256950451"]);
  });

  it("keeps only the compatibility metadata it can explain", () => {
    const product = mapProduct(sallaProductDtoSchema.parse(productPayload));

    expect(product.metadata).toEqual({
      urls: { customer: "https://salla.sa/x" },
      sallaMetadata: { title: "Chocolate bar" },
      brandId: "1097509908",
    });
  });

  it("rejects a product without an id, name, or status", () => {
    expect(sallaProductDtoSchema.safeParse({ ...productPayload, id: undefined }).success).toBe(
      false,
    );
    expect(sallaProductDtoSchema.safeParse({ ...productPayload, name: "" }).success).toBe(false);
    expect(sallaProductDtoSchema.safeParse({ ...productPayload, name: "   " }).success).toBe(false);
    expect(sallaProductDtoSchema.safeParse({ ...productPayload, status: "" }).success).toBe(false);
  });

  it("tolerates a missing categories array", () => {
    const { categories, ...rest } = productPayload;
    expect(categories).toHaveLength(3);
    const product = mapProduct(sallaProductDtoSchema.parse(rest));

    expect(product.categoryExternalIds).toEqual([]);
  });
});

describe("category mapping", () => {
  const categoryPayload = {
    id: 1390018242,
    name: "laptops",
    image: null,
    parent_id: 0,
    sort_order: 0,
    status: "active",
    update_at: "2024-10-24 13:24:48",
    urls: { customer: "https://store.test/laptops/c1390018242" },
    metadata: { title: "Laptops" },
    show_in: { app: true, salla_points: false },
  };

  it("maps a root category and treats parent_id 0 as no parent", () => {
    const category = mapCategory(sallaCategoryDtoSchema.parse(categoryPayload));

    expect(category.externalId).toBe("1390018242");
    expect(category.parentExternalId).toBeNull();
    expect(category.imageUrl).toBeNull();
    expect(category.sortOrder).toBe(0);
  });

  it("keeps a real parent id", () => {
    const category = mapCategory(
      sallaCategoryDtoSchema.parse({ ...categoryPayload, parent_id: "774382199" }),
    );

    expect(category.parentExternalId).toBe("774382199");
  });

  it("accepts the embedded {date} timestamp shape", () => {
    const category = mapCategory(
      sallaCategoryDtoSchema.parse({
        ...categoryPayload,
        update_at: {
          date: "2022-04-25 19:46:26.000000",
          timezone_type: 3,
          timezone: "Asia/Riyadh",
        },
      }),
    );

    expect(category.sourceUpdatedAt?.toISOString()).toBe("2022-04-25T19:46:26.000Z");
  });

  it("rejects a category without a name", () => {
    expect(sallaCategoryDtoSchema.safeParse({ ...categoryPayload, name: "" }).success).toBe(false);
  });
});

describe("provider scalar coercion", () => {
  it("formats money without float artefacts", () => {
    expect(toMoneyString(96.33)).toBe("96.33");
    expect(toMoneyString("159.5")).toBe("159.50");
    expect(toMoneyString(0)).toBe("0.00");
    expect(toMoneyString("")).toBeNull();
    expect(toMoneyString("abc")).toBeNull();
    expect(toMoneyString(null)).toBeNull();
  });

  it("parses integer-like strings and rejects junk", () => {
    expect(toInteger("50")).toBe(50);
    expect(toInteger(12)).toBe(12);
    expect(toInteger("12abc")).toBe(12);
    expect(toInteger("")).toBeNull();
    expect(toInteger(null)).toBeNull();
  });

  it("never returns an invalid date", () => {
    expect(parseSallaTimestamp("2024-03-06 13:50:32")?.toISOString()).toBe(
      "2024-03-06T13:50:32.000Z",
    );
    expect(parseSallaTimestamp("not a date")).toBeNull();
    expect(parseSallaTimestamp(undefined)).toBeNull();
  });
});
