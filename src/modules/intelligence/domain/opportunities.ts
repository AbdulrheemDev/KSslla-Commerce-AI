import type { CategoryItem } from "@/modules/intelligence/domain/categories";
import type { ProductIntelligence } from "@/modules/intelligence/domain/products";
import type { SalesMetrics } from "@/modules/intelligence/domain/sales";
import { THRESHOLDS } from "@/modules/intelligence/domain/thresholds";
import type { Coverage, DataFreshness } from "@/modules/intelligence/domain/types";

/**
 * Opportunities engine — every card is a rule that fired on stored numbers.
 *
 * There is no "the product is excellent" without the units and stock that made
 * the rule fire: `evidence` carries the exact values, `rationale` states the
 * rule, and `confidence` is derived from whether those values were complete or
 * partial. Rules are evaluated in a fixed order and de-duplicated, so the same
 * snapshot always yields the same list.
 */

export type OpportunityType =
  | "out_of_stock"
  | "high_sales_low_stock"
  | "low_stock"
  | "overstock"
  | "slow_mover"
  | "weak_category"
  | "incomplete_product_data"
  | "stale_sync"
  | "no_recent_sales";

export type Severity = "high" | "medium" | "low";
export type Confidence = "high" | "medium" | "low";

export interface OpportunityEvidence {
  label: string;
  value: string | number | null;
  unit?: string;
}

export interface Opportunity {
  id: string;
  type: OpportunityType;
  severity: Severity;
  entityType: "product" | "category" | "store";
  entityId: string | null;
  title: string;
  description: string;
  evidence: OpportunityEvidence[];
  recommendedAction: string;
  rationale: string;
  confidence: Confidence;
  createdAt: string;
}

export interface OpportunityInput {
  products: readonly ProductIntelligence[];
  categories: readonly CategoryItem[];
  sales: SalesMetrics;
  freshness: DataFreshness;
  coverage: Coverage;
  ordersSynced: boolean;
  productsSynced: boolean;
  now: Date;
}

export interface OpportunityList {
  items: Opportunity[];
  total: number;
  truncated: boolean;
  countsByType: Partial<Record<OpportunityType, number>>;
}

const MAX_ITEMS = 100;

function confidenceOf(values: ReadonlyArray<{ availability: string }>): Confidence {
  const unavailableCount = values.filter((value) => value.availability === "unavailable").length;
  const partialCount = values.filter((value) => value.availability === "partial").length;

  if (unavailableCount > 0) return "low";
  if (partialCount > 0) return "medium";
  return "high";
}

function productOpportunity(
  type: OpportunityType,
  severity: Severity,
  product: ProductIntelligence,
  detail: {
    title: string;
    description: string;
    evidence: OpportunityEvidence[];
    action: string;
    rationale: string;
    confidence: Confidence;
  },
  createdAt: string,
): Opportunity {
  return {
    id: `${type}:product:${product.productId}`,
    type,
    severity,
    entityType: "product",
    entityId: product.productId,
    title: detail.title,
    description: detail.description,
    evidence: detail.evidence,
    recommendedAction: detail.action,
    rationale: detail.rationale,
    confidence: detail.confidence,
    createdAt,
  };
}

export function buildOpportunities(input: OpportunityInput): OpportunityList {
  const createdAt = input.now.toISOString();
  const items: Opportunity[] = [];
  const countsByType: Partial<Record<OpportunityType, number>> = {};

  const bump = (type: OpportunityType): void => {
    countsByType[type] = (countsByType[type] ?? 0) + 1;
  };

  const usableProducts = input.products.filter(
    (product) => product.stock.value !== null || product.unitsSold.value !== null,
  );

  for (const product of usableProducts) {
    const stock = product.stock.value;
    const sold = product.unitsSold.value;

    if (stock !== null && stock <= 0) {
      // The rule fires on zero stock alone, so the wording must not claim sales
      // that may not exist: a product that never sold is a different problem
      // (availability, price, visibility) than one that sold out.
      const hadSales = sold !== null && sold > 0;

      items.push(
        productOpportunity(
          "out_of_stock",
          "high",
          product,
          {
            title: hadSales
              ? `نفد مخزون «${product.name}» بعد مبيعات فعلية`
              : `نفد مخزون «${product.name}» بلا مبيعات مسجّلة`,
            description: hadSales
              ? "المنتج غير متوفر حاليًا، لكن بيانات المزوّد تُظهر أنه بيع منه من قبل. كل يوم بلا مخزون هو مبيعات مفقودة."
              : "المنتج غير متوفر حاليًا ولا توجد مبيعات مسجّلة له في بيانات Salla. سبب النفاده قد يكون أن الكمية لم تكن معروضة أصلًا.",
            evidence: [
              { label: "المخزون الحالي", value: stock, unit: "وحدة" },
              { label: "الوحدات المبيعة (تراكمي من Salla)", value: sold, unit: "وحدة" },
              { label: "حالة المنتج", value: product.status },
            ],
            action: hadSales
              ? "أعد تعبئة المخزون أو اجعل المنتج غير معروض حتى تتوفر الكمية."
              : "تحقّق من الكمية في Salla، وأضف مخزونًا إن كان المنتج معروضًا فعلًا.",
            rationale: hadSales
              ? "القاعدة: المخزون ≤ 0 مع مبيعات سابقة."
              : "القاعدة: المخزون ≤ 0 (بلا شرط مبيعات).",
            confidence: confidenceOf([product.stock, product.unitsSold]),
          },
          createdAt,
        ),
      );
      bump("out_of_stock");
      continue;
    }

    if (stock !== null && stock > 0 && stock <= THRESHOLDS.LOW_STOCK_UNITS && sold !== 0) {
      const isFast = sold !== null && sold >= THRESHOLDS.STAR_SALES_UNITS;

      items.push(
        productOpportunity(
          isFast ? "high_sales_low_stock" : "low_stock",
          isFast ? "high" : "medium",
          product,
          {
            title: isFast
              ? `«${product.name}» يبيع بسرعة والمخزون على وشك النفاد`
              : `مخزون «${product.name}» منخفض`,
            description: isFast
              ? "المنتج من الأكثر مبيعًا تراكميًا، والمخزون المتبقي داخل حد المخزون المنخفض. النفاد هنا يوقف منتجًا ناجحًا."
              : "الكمية المتبقية داخل حد المخزون المنخفض. الرقم لا يتنبأ بتاريخ النفاد لأن Salla لا توثّق فترة لمبيعات المنتج.",
            evidence: [
              { label: "المخزون الحالي", value: stock, unit: "وحدة" },
              { label: "الوحدات المبيعة (تراكمي)", value: sold, unit: "وحدة" },
              { label: "حد المخزون المنخفض", value: THRESHOLDS.LOW_STOCK_UNITS, unit: "وحدة" },
            ],
            action: isFast
              ? "اطلب كمية إضافية قبل النفاد، وراقب المنتج أسبوعيًا."
              : "راجع معدل البيع اليدوي وقرر إعادة الطلب قبل النفاد.",
            rationale: isFast
              ? `القاعدة: المخزون ≤ ${THRESHOLDS.LOW_STOCK_UNITS} والمبيعات ≥ ${THRESHOLDS.STAR_SALES_UNITS}.`
              : `القاعدة: 0 < المخزون ≤ ${THRESHOLDS.LOW_STOCK_UNITS} مع مبيعات سابقة.`,
            confidence: confidenceOf([product.stock, product.unitsSold]),
          },
          createdAt,
        ),
      );
      bump(isFast ? "high_sales_low_stock" : "low_stock");
      continue;
    }

    if (
      stock !== null &&
      stock >= THRESHOLDS.OVERSTOCK_UNITS &&
      sold === 0 &&
      product.status !== "hidden"
    ) {
      items.push(
        productOpportunity(
          "overstock",
          "medium",
          product,
          {
            title: `مخزون راكد: «${product.name}»`,
            description:
              "الكمية كبيرة ولم يُبع منها شيء حسب بيانات Salla الحالية. المخزون المجمّد رأس مال لا يتحرك.",
            evidence: [
              { label: "المخزون", value: stock, unit: "وحدة" },
              { label: "الوحدات المبيعة", value: sold, unit: "وحدة" },
              { label: "حد التكدّس", value: THRESHOLDS.OVERSTOCK_UNITS, unit: "وحدة" },
            ],
            action: "أوقف إعادة الطلب، وفكّر في عرض تخفيض أو حزمة لتحريك المخزون.",
            rationale: `القاعدة: المخزون ≥ ${THRESHOLDS.OVERSTOCK_UNITS} والمبيعات = 0.`,
            confidence: confidenceOf([product.stock, product.unitsSold]),
          },
          createdAt,
        ),
      );
      bump("overstock");
      continue;
    }

    if (
      stock !== null &&
      stock > THRESHOLDS.LOW_STOCK_UNITS &&
      sold === 0 &&
      product.status !== "hidden"
    ) {
      items.push(
        productOpportunity(
          "slow_mover",
          "low",
          product,
          {
            title: `«${product.name}» بلا مبيعات مع مخزون متاح`,
            description:
              "المنتج متوفر ولم يُبع منه شيء وفق بيانات المزوّد. قد تكون المشكلة في الظهور أو السعر أو الوصف.",
            evidence: [
              { label: "المخزون", value: stock, unit: "وحدة" },
              { label: "الوحدات المبيعة", value: sold, unit: "وحدة" },
              { label: "التصنيفات", value: product.categories.length },
            ],
            action: "راجع السعر والصور والتصنيف، وتأكد أن المنتج معروض فعلًا في المتجر.",
            rationale: "القاعدة: المخزون > حد المخزون المنخفض والمبيعات = 0.",
            confidence: confidenceOf([product.stock, product.unitsSold]),
          },
          createdAt,
        ),
      );
      bump("slow_mover");
    }
  }

  for (const category of input.categories) {
    if (!category.weak) continue;

    items.push({
      id: `weak_category:category:${category.categoryId}`,
      type: "weak_category",
      severity: "low",
      entityType: "category",
      entityId: category.categoryId,
      title: `فئة بلا مبيعات: «${category.name}»`,
      description:
        "الفئة تحتوي منتجات كافية للحكم عليها، ولا يوجد أي بيع مسجّل لأي منها حسب بيانات Salla.",
      evidence: [
        { label: "عدد المنتجات", value: category.productCount },
        { label: "منتجات متاحة", value: category.availableProducts },
        { label: "الوحدات المبيعة", value: category.unitsSold.value, unit: "وحدة" },
      ],
      recommendedAction: "راجع تشكيلة الفئة: قد تكون المنتجات غير مناسبة أو غير ظاهرة للعميل.",
      rationale: `القاعدة: عدد منتجات ≥ ${THRESHOLDS.WEAK_CATEGORY_MIN_PRODUCTS} والمبيعات = 0.`,
      confidence: confidenceOf([category.unitsSold]),
      createdAt,
    });
    bump("weak_category");
  }

  const missingData = input.products.filter(
    (product) =>
      product.signals.includes("missing_price") ||
      product.signals.includes("missing_category") ||
      product.signals.includes("missing_image"),
  ).length;

  if (missingData > 0) {
    items.push({
      id: "incomplete_product_data:store",
      type: "incomplete_product_data",
      severity: "low",
      entityType: "store",
      entityId: null,
      title: "بيانات منتجات ناقصة تحدّ من دقة التحليل",
      description:
        "بعض المنتجات ينقصها السعر أو التصنيف أو الصورة. التحليل يعمل، لكن جودة القرارات المرتبطة بها أقل.",
      evidence: [
        { label: "منتجات ببيانات ناقصة", value: missingData },
        { label: "إجمالي المنتجات", value: input.products.length },
      ],
      recommendedAction: "أكمل السعر والتصنيف والصورة للمنتجات الناقصة من لوحة Salla.",
      rationale: "القاعدة: أي منتج بلا سعر أو تصنيف أو صورة.",
      confidence: "high",
      createdAt,
    });
    bump("incomplete_product_data");
  }

  if (input.freshness.staleResources.length > 0) {
    items.push({
      id: "stale_sync:store",
      type: "stale_sync",
      severity: "medium",
      entityType: "store",
      entityId: null,
      title: "بيانات قديمة قد تُضلّل القرار",
      description:
        "مورد واحد على الأقل لم تُنجح مزامنته خلال الحد المسموح، لذلك قد لا يعكس التحليل الوضع الحالي للمتجر.",
      evidence: input.freshness.staleResources.map((resource) => ({
        label: `مورد متأخر: ${resource}`,
        value: "stale",
      })),
      recommendedAction: "شغّل «مزامنة الآن» للموارد المتأخرة قبل الاعتماد على الأرقام.",
      rationale: `القاعدة: آخر مزامنة ناجحة أقدم من ${THRESHOLDS.STALE_SYNC_HOURS} ساعة.`,
      confidence: "high",
      createdAt,
    });
    bump("stale_sync");
  }

  const completed = input.sales.completedOrders.value;

  if (
    input.ordersSynced &&
    completed !== null &&
    completed === 0 &&
    input.coverage.status !== "empty"
  ) {
    items.push({
      id: "no_recent_sales:store",
      type: "no_recent_sales",
      severity: "medium",
      entityType: "store",
      entityId: null,
      title: "لا طلبات مكتملة في الفترة المحددة",
      description:
        "الطلبات مُزامنة، لكن لا يوجد طلب مكتمل (status = completed) في هذه الفترة. أي طلبات بحالات أخرى لا تُحتسب مبيعات.",
      evidence: [
        { label: "الطلبات في الفترة", value: input.sales.orders.value },
        { label: "طلبات مكتملة", value: completed },
        { label: "طلبات بحالات أخرى", value: input.sales.otherStatusOrders.value },
      ],
      recommendedAction: "راجع حالات الطلبات في Salla، وتأكد أن الطلبات تُنقل إلى completed.",
      rationale: "القاعدة: طلبات مُزامنة، والفترة غير فارغة، والطلبات المكتملة = 0.",
      confidence: confidenceOf([input.sales.completedOrders]),
      createdAt,
    });
    bump("no_recent_sales");
  }

  const severityRank: Record<Severity, number> = { high: 0, medium: 1, low: 2 };

  const sorted = items.sort(
    (a, b) =>
      severityRank[a.severity] - severityRank[b.severity] ||
      a.type.localeCompare(b.type) ||
      a.title.localeCompare(b.title, "ar"),
  );

  return {
    items: sorted.slice(0, MAX_ITEMS),
    total: sorted.length,
    truncated: sorted.length > MAX_ITEMS,
    countsByType,
  };
}
