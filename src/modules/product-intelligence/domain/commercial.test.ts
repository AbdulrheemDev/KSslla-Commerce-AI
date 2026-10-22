import { describe, expect, it } from "vitest";

import { evaluateCommercial } from "@/modules/product-intelligence/domain/commercial";
import { evaluatePerformance } from "@/modules/product-intelligence/domain/performance";
import { catalogProduct, inventoryState } from "@/test/product-intelligence-fixtures";

describe("evaluateCommercial — price and currency", () => {
  it("reads the stored price verbatim", () => {
    const result = evaluateCommercial(catalogProduct({ priceAmount: "149.00" }));

    expect(result.price.availability).toBe("available");
    expect(result.price.value).toBe(149);
    expect(result.price.basis).toBe("products.price_amount");
  });

  it("reports a missing price as unavailable, not as zero", () => {
    const result = evaluateCommercial(catalogProduct({ priceAmount: null }));

    expect(result.price.availability).toBe("unavailable");
    expect(result.price.reason).toBe("no_price");
    expect(result.price.value).toBeNull();
  });

  it("still parses a zero price, so the zero can be reported", () => {
    const result = evaluateCommercial(catalogProduct({ priceAmount: "0.00" }));

    expect(result.price.value).toBe(0);
    expect(result.price.availability).toBe("available");
  });

  it("reports a missing currency instead of assuming one", () => {
    const result = evaluateCommercial(catalogProduct({ currency: null }));

    expect(result.currency.availability).toBe("unavailable");
    expect(result.currency.reason).toBe("missing_currency");
  });
});

describe("evaluateCommercial — availability", () => {
  it("prefers the inventory mirror over the product row", () => {
    const result = evaluateCommercial(
      catalogProduct({ quantity: 3, inventory: inventoryState({ quantity: 40 }) }),
    );

    expect(result.stock.value).toBe(40);
    expect(result.stockSource).toBe("inventory");
  });

  it("falls back to products.quantity when no inventory row exists", () => {
    const result = evaluateCommercial(catalogProduct({ quantity: 7, inventory: null }));

    expect(result.stock.value).toBe(7);
    expect(result.stockSource).toBe("products");
  });

  it("reports unknown stock as unavailable", () => {
    const result = evaluateCommercial(catalogProduct({ quantity: null, inventory: null }));

    expect(result.stock.availability).toBe("unavailable");
    expect(result.stock.reason).toBe("no_stock_data");
    expect(result.outOfStock).toBeNull();
  });

  it("marks zero stock as out of stock", () => {
    expect(
      evaluateCommercial(catalogProduct({ inventory: inventoryState({ quantity: 0 }) })).outOfStock,
    ).toBe(true);
  });

  it("does not mark an unlimited product as out of stock", () => {
    const result = evaluateCommercial(
      catalogProduct({
        inventory: inventoryState({ quantity: 0, unlimitedQuantity: true }),
      }),
    );

    expect(result.unlimitedQuantity).toBe(true);
    expect(result.outOfStock).toBe(false);
  });
});

describe("evaluatePerformance", () => {
  it("never reports period sales or revenue", () => {
    const result = evaluatePerformance(catalogProduct());

    for (const metric of [result.periodSales, result.revenue]) {
      expect(metric.availability).toBe("unavailable");
      expect(metric.reason).toBe("product_sales_not_linked");
      expect(metric.value).toBeNull();
    }
  });

  it("labels the provider counter as cumulative and does not divide it", () => {
    const result = evaluatePerformance(
      catalogProduct({ inventory: inventoryState({ soldQuantity: 37 }) }),
    );

    expect(result.cumulativeSoldQuantity.value).toBe(37);
    expect(result.cumulativeSoldQuantity.basis).toContain("cumulative");
    expect(result.cumulativeSoldQuantity.basis).toContain("period not documented");
  });

  it("reports the cumulative counter as unavailable when inventory was never synced", () => {
    const result = evaluatePerformance(catalogProduct({ inventory: null }));

    expect(result.cumulativeSoldQuantity.availability).toBe("unavailable");
    expect(result.cumulativeSoldQuantity.reason).toBe("inventory_not_synced");
  });
});
