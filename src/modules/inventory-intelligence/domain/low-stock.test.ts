import { describe, expect, it } from "vitest";

import {
  inventoryProduct,
  productWithQuantity,
  stocklessProduct,
} from "@/test/inventory-intelligence-fixtures";

import { detectIssues, highestSeverity } from "./issues";
import { analyseInventoryProduct } from "./products";
import { INVENTORY_THRESHOLDS } from "./thresholds";

/**
 * Low stock is an absolute shelf rule, not a forecast.
 *
 * These tests pin the exact edge (`5` is low, `6` is not), that unlimited stock
 * never trips it, and that a product with no row is `unknown` rather than low or
 * out of stock.
 */
describe("low stock classification", () => {
  const low = INVENTORY_THRESHOLDS.LOW_STOCK_UNITS;

  it("covers every unit from 1 through the threshold", () => {
    for (let quantity = 1; quantity <= low; quantity += 1) {
      expect(analyseInventoryProduct(productWithQuantity(quantity)).status).toBe("low_stock");
    }
  });

  it("stops exactly after the threshold", () => {
    expect(analyseInventoryProduct(productWithQuantity(low + 1)).status).toBe("in_stock");
  });

  it("does not classify a product with no inventory row as low stock", () => {
    const analysis = analyseInventoryProduct(stocklessProduct());

    expect(analysis.status).toBe("unknown");
    expect(analysis.stock.value).toBeNull();
    expect(analysis.issues).toEqual(["missing_inventory_record"]);
  });

  it("does not classify unlimited stock as low even at zero units", () => {
    const analysis = analyseInventoryProduct(productWithQuantity(0, { unlimitedQuantity: true }));

    expect(analysis.status).toBe("unlimited");
    expect(analysis.issues).toEqual([]);
  });
});

describe("stock issues", () => {
  it("fires low_stock with medium severity", () => {
    const issues = detectIssues(productWithQuantity(3));

    expect(issues).toEqual(["low_stock"]);
    expect(highestSeverity(issues)).toBe("medium");
  });

  it("fires out_of_stock at zero with high severity", () => {
    const issues = detectIssues(productWithQuantity(0));

    expect(issues).toEqual(["out_of_stock"]);
    expect(highestSeverity(issues)).toBe("high");
  });

  it("fires negative_quantity instead of out_of_stock, and keeps it high", () => {
    const issues = detectIssues(productWithQuantity(-4));

    expect(issues).toEqual(["negative_quantity"]);
    expect(highestSeverity(issues)).toBe("high");
  });

  it("fires nothing for a healthy in-stock product", () => {
    expect(detectIssues(inventoryProduct())).toEqual([]);
    expect(highestSeverity([])).toBeNull();
  });

  it("fires missing_inventory_record for a catalogued product with no row", () => {
    const issues = detectIssues(stocklessProduct());

    expect(issues).toEqual(["missing_inventory_record"]);
    expect(highestSeverity(issues)).toBe("medium");
  });

  it("keeps the threshold in the rule text so a reader can re-evaluate it", () => {
    const analysis = analyseInventoryProduct(productWithQuantity(2));

    expect(analysis.issues).toContain("low_stock");
    expect(INVENTORY_THRESHOLDS.LOW_STOCK_UNITS).toBe(5);
  });
});
