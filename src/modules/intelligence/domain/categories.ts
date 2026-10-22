import { THRESHOLDS } from "@/modules/intelligence/domain/thresholds";
import type { Metric } from "@/modules/intelligence/domain/types";
import { available, partial, unavailable } from "@/modules/intelligence/domain/types";

/**
 * Category intelligence.
 *
 * Product ↔ category is many-to-many: the same product can sit in several
 * categories, so units are counted in **every** category it belongs to. The sums
 * across categories can therefore exceed the store total, and that is stated in
 * the response rather than hidden. Revenue and contribution are `unavailable`
 * for the same documented reason as product revenue: order lines carry no
 * product id and no line price (§12.1), so no defensible attribution exists.
 */

export interface CategoryMetricInput {
  id: string;
  name: string;
}

export interface CategoryProductInput {
  productId: string;
  categoryIds: readonly string[];
  soldQuantity: number | null;
  stock: number | null;
  isAvailable: boolean;
}

export interface CategoryItem {
  categoryId: string;
  name: string;
  productCount: number;
  availableProducts: number;
  unitsSold: Metric<number>;
  revenue: Metric<number>;
  contribution: Metric<number>;
  weak: boolean;
}

export interface CategoryIntelligence {
  totalCategories: number;
  uncategorisedProducts: number;
  items: CategoryItem[];
  /** True when a product can appear under more than one category. */
  manyToMany: true;
}

export function computeCategoryIntelligence(
  categories: readonly CategoryMetricInput[],
  products: readonly CategoryProductInput[],
): CategoryIntelligence {
  const items = categories.map<CategoryItem>((category) => {
    const members = products.filter((product) => product.categoryIds.includes(category.id));

    const soldKnown = members.filter((product) => product.soldQuantity !== null);
    const soldSum = soldKnown.reduce((sum, product) => sum + (product.soldQuantity ?? 0), 0);

    const unitsSold: Metric<number> =
      members.length === 0
        ? available(0, "sum(product.sold_quantity) within category")
        : soldKnown.length === 0
          ? unavailable("inventory_not_synced")
          : soldKnown.length < members.length
            ? partial(
                soldSum,
                "sum(product.sold_quantity) within category",
                "some_products_missing_sales_data",
              )
            : available(soldSum, "sum(product.sold_quantity) within category");

    const weak =
      members.length >= THRESHOLDS.WEAK_CATEGORY_MIN_PRODUCTS &&
      soldKnown.length === members.length &&
      soldSum === 0;

    return {
      categoryId: category.id,
      name: category.name,
      productCount: members.length,
      availableProducts: members.filter((product) => product.isAvailable).length,
      unitsSold,
      revenue: unavailable("line_level_data_unavailable"),
      contribution: unavailable("line_level_data_unavailable"),
      weak,
    };
  });

  const uncategorisedProducts = products.filter(
    (product) => product.categoryIds.length === 0,
  ).length;

  return {
    totalCategories: categories.length,
    uncategorisedProducts,
    items: items.sort((a, b) => a.name.localeCompare(b.name, "ar")),
    manyToMany: true,
  };
}
