import { describe, expect, it } from "vitest";

import { sallaCategoryListSchema, sallaProductListSchema } from "@/modules/catalog/domain/dto";

const pagination = {
  count: 2,
  total: 2,
  perPage: 15,
  currentPage: 1,
  totalPages: 1,
  links: [],
};

const product = {
  id: 1,
  name: "T-Shirt",
  status: "sale",
  price: { amount: 100, currency: "SAR" },
};

const category = {
  id: 2,
  name: "laptops",
  parent_id: 0,
  status: "active",
  update_at: "2024-10-24 13:24:48",
};

describe("list envelope validation", () => {
  it("accepts the documented product envelope", () => {
    const parsed = sallaProductListSchema.safeParse({
      status: 200,
      success: true,
      data: [product],
      pagination,
    });

    expect(parsed.success).toBe(true);
  });

  it("accepts the documented category envelope", () => {
    const parsed = sallaCategoryListSchema.safeParse({
      status: 200,
      success: true,
      data: [category],
      pagination,
    });

    expect(parsed.success).toBe(true);
  });

  it("rejects a payload with no data array", () => {
    expect(
      sallaProductListSchema.safeParse({ status: 200, success: true, pagination }).success,
    ).toBe(false);
  });

  it("rejects a payload with no pagination block", () => {
    expect(
      sallaProductListSchema.safeParse({ status: 200, success: true, data: [product] }).success,
    ).toBe(false);
  });

  it("rejects a product without a status", () => {
    expect(
      sallaProductListSchema.safeParse({
        data: [product, { id: 3, name: "No status" }],
        pagination,
      }).success,
    ).toBe(false);
  });

  it("does not reject an unknown extra field", () => {
    const parsed = sallaProductListSchema.safeParse({
      data: [{ ...product, future_field: { nested: true } }],
      pagination,
    });

    expect(parsed.success).toBe(true);
  });
});
