import { THRESHOLDS } from "@/modules/intelligence/domain/thresholds";
import type { DataFreshness, Metric } from "@/modules/intelligence/domain/types";
import { available, partial, unavailable } from "@/modules/intelligence/domain/types";

/**
 * Store health — a deterministic, explainable score.
 *
 * Five components, each scored 0–100 from stored facts, each with a fixed
 * weight. A component that cannot be computed is **excluded** and the score is
 * renormalised over the remaining weights, with availability downgraded to
 * `partial`. Fewer than two computable components means `insufficient_data`:
 * a one-component "health score" would look authoritative while saying almost
 * nothing.
 *
 * No AI, no benchmarks, no industry averages. Every point is traceable to a
 * component below.
 */

export type HealthComponentId =
  "catalog_completeness" | "stock_health" | "sales_activity" | "sync_health" | "freshness";

export interface HealthComponent {
  id: HealthComponentId;
  weight: number;
  score: number | null;
  basis: string;
  detail: string;
}

export type HealthGrade = "excellent" | "good" | "fair" | "poor";

export interface StoreHealth {
  score: Metric<number>;
  grade: HealthGrade | null;
  components: HealthComponent[];
  usedComponents: HealthComponentId[];
}

export interface HealthInput {
  productTotal: number;
  missingPrice: number;
  missingCategory: number;
  missingImage: number;
  inStock: number;
  /** Products whose stock is known (products.quantity or an inventory row). */
  stockKnown: number;
  /** Completed orders in a fixed 30-day window; null when orders never synced. */
  completedOrders30d: number | null;
  freshness: DataFreshness;
  now: Date;
}

export const HEALTH_WEIGHTS: Record<HealthComponentId, number> = {
  catalog_completeness: 25,
  stock_health: 20,
  sales_activity: 25,
  sync_health: 15,
  freshness: 15,
};

function clamp(value: number): number {
  return Math.max(0, Math.min(100, Math.round(value)));
}

function catalogComponent(input: HealthInput): HealthComponent {
  const base = {
    id: "catalog_completeness" as const,
    weight: HEALTH_WEIGHTS.catalog_completeness,
    basis: "1 - (missing_price + missing_category + missing_image) / (3 × products)",
    detail: "اكتمال بيانات المنتجات: السعر والتصنيف والصورة",
  };

  if (input.productTotal === 0) {
    return { ...base, score: null, detail: "لا توجد منتجات لمزامنتها بعد" };
  }

  const gaps = input.missingPrice + input.missingCategory + input.missingImage;
  const score = clamp(100 - (gaps / (input.productTotal * 3)) * 100);

  return { ...base, score };
}

function stockComponent(input: HealthInput): HealthComponent {
  const base = {
    id: "stock_health" as const,
    weight: HEALTH_WEIGHTS.stock_health,
    basis: "in_stock_products / products_with_known_stock",
    detail: "نسبة المنتجات المتوفرة من إجمالي ما نعرف مخزونه",
  };

  if (input.stockKnown === 0) {
    return { ...base, score: null, detail: "لا توجد بيانات مخزون بعد" };
  }

  return { ...base, score: clamp((input.inStock / input.stockKnown) * 100) };
}

function salesComponent(input: HealthInput): HealthComponent {
  const base = {
    id: "sales_activity" as const,
    weight: HEALTH_WEIGHTS.sales_activity,
    basis: `min(100, completed_orders_30d / ${THRESHOLDS.SALES_ACTIVITY_TARGET_ORDERS} × 100)`,
    detail: "نشاط الطلبات المكتملة في آخر 30 يومًا",
  };

  if (input.completedOrders30d === null) {
    return { ...base, score: null, detail: "لم تُزامَن الطلبات بعد" };
  }

  return {
    ...base,
    score: clamp((input.completedOrders30d / THRESHOLDS.SALES_ACTIVITY_TARGET_ORDERS) * 100),
  };
}

function syncComponent(input: HealthInput): HealthComponent {
  const base = {
    id: "sync_health" as const,
    weight: HEALTH_WEIGHTS.sync_health,
    basis: "resources_with_recent_successful_sync / tracked_resources",
    detail: "حديث نجاح المزامنة لكل مورد",
  };

  const tracked = input.freshness.resources.filter((resource) => resource.lastSuccessAt !== null);
  if (tracked.length === 0) {
    return { ...base, score: null, detail: "لم تنجح أي مزامنة بعد" };
  }

  const healthy = tracked.filter((resource) => !resource.stale).length;
  return { ...base, score: clamp((healthy / tracked.length) * 100) };
}

function freshnessComponent(input: HealthInput): HealthComponent {
  const base = {
    id: "freshness" as const,
    weight: HEALTH_WEIGHTS.freshness,
    basis: "ladder: ≤1h 100 · ≤24h 75 · ≤7d 40 · otherwise 10",
    detail: "عمر آخر مزامنة ناجحة",
  };

  if (!input.freshness.syncedAt) {
    return { ...base, score: null, detail: "لا توجد مزامنة ناجحة بعد" };
  }

  const ageHours = (input.now.getTime() - new Date(input.freshness.syncedAt).getTime()) / 3_600_000;

  const score = ageHours <= 1 ? 100 : ageHours <= 24 ? 75 : ageHours <= 168 ? 40 : 10;

  return { ...base, score };
}

function gradeOf(score: number): HealthGrade {
  if (score >= 85) return "excellent";
  if (score >= 70) return "good";
  if (score >= 50) return "fair";
  return "poor";
}

export function computeStoreHealth(input: HealthInput): StoreHealth {
  const components = [
    catalogComponent(input),
    stockComponent(input),
    salesComponent(input),
    syncComponent(input),
    freshnessComponent(input),
  ];

  const usable = components.filter(
    (component): component is HealthComponent & { score: number } => component.score !== null,
  );

  if (usable.length < 2) {
    return {
      score: unavailable("insufficient_data", "weighted_average"),
      grade: null,
      components,
      usedComponents: [],
    };
  }

  const totalWeight = usable.reduce((sum, component) => sum + component.weight, 0);
  const weighted = usable.reduce((sum, component) => sum + component.score * component.weight, 0);
  const score = clamp(weighted / totalWeight);

  const incomplete = usable.length < components.length;

  return {
    score: incomplete
      ? partial(score, "weighted_average", "some_components_unavailable")
      : available(score, "weighted_average"),
    grade: gradeOf(score),
    components,
    usedComponents: usable.map((component) => component.id),
  };
}
