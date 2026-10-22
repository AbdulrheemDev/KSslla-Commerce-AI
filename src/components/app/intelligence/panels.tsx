import type { CategoryIntelligence } from "@/modules/intelligence/domain/categories";
import type { HealthComponent, StoreHealth } from "@/modules/intelligence/domain/health";
import type { InventoryIntelligence, StockRisk } from "@/modules/intelligence/domain/inventory";
import type {
  Opportunity,
  OpportunityType,
  Severity,
} from "@/modules/intelligence/domain/opportunities";
import type { ProductClass, ProductIntelligence } from "@/modules/intelligence/domain/products";
import type { Metric } from "@/modules/intelligence/domain/types";

/**
 * Presentation helpers for the intelligence page.
 *
 * The single rule this file enforces: a missing value is rendered as `—` with a
 * reason, never as `0`, `0%`, or a placeholder that could be mistaken for data.
 */

const NUMBER = new Intl.NumberFormat("ar-SA", { numberingSystem: "latn" });
const MONEY = new Intl.NumberFormat("ar-SA", {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
  numberingSystem: "latn",
});

export const REASON_LABELS_AR: Record<string, string> = {
  orders_not_synced: "لم تُزامَن الطلبات بعد",
  no_order_totals: "لا توجد إجماليات طلبات محفوظة",
  mixed_currency: "أكثر من عملة — لا يُجمع المال",
  some_orders_missing_total: "بعض الطلبات بلا إجمالي محفوظ",
  no_baseline_period: "لا توجد فترة سابقة كافية للمقارنة",
  no_baseline_orders: "لا طلبات في الفترة السابقة",
  orders_sync_incomplete: "آخر مزامنة للطلبات لم تكتمل",
  line_level_data_unavailable: "بنود الطلب في Salla لا تحمل معرّف منتج ولا سعرًا",
  no_sales_period: "Salla لا توثّق فترة لمبيعات المنتج",
  no_stock_data: "لا توجد بيانات مخزون",
  inventory_not_synced: "المخزون لم يُزامَن بعد",
  no_price: "لا يوجد سعر محفوظ",
  invalid_price: "السعر المحفوظ غير صالح",
  customers_not_synced: "لم يُزامَن العملاء بعد",
  customers_sync_incomplete: "آخر مزامنة للعملاء لم تكتمل",
  source_created_at_missing_for_some_customers: "تاريخ إنشاء بعض العملاء غير متاح",
  no_customers_with_orders: "لا يوجد عملاء لديهم طلبات",
  revenue_unavailable: "الإيراد غير متاح",
  insufficient_data: "بيانات غير كافية",
  some_components_unavailable: "بعض مكوّنات المؤشر غير متاحة",
  no_orders_stored: "لا توجد طلبات محفوظة",
  history_starts_after_window: "سجل الطلبات يبدأ بعد بداية الفترة",
  some_products_missing_sales_data: "بعض المنتجات بلا بيانات مبيعات",
};

export const CLASS_LABELS_AR: Record<ProductClass, string> = {
  star: "نجم",
  growth_opportunity: "فرصة نمو",
  stable: "مستقر",
  low_performer: "أداء منخفض",
  inventory_risk: "خطر مخزون",
  insufficient_data: "بيانات غير كافية",
};

export const CLASS_TONES: Record<ProductClass, string> = {
  star: "bg-teal/15 text-teal",
  growth_opportunity: "bg-amber-500/15 text-amber-700",
  stable: "bg-surface-2 text-muted",
  low_performer: "bg-orange-500/15 text-orange-700",
  inventory_risk: "bg-red-500/15 text-red-700",
  insufficient_data: "bg-surface-2 text-muted",
};

export const SEVERITY_LABELS_AR: Record<Severity, string> = {
  high: "أولوية عالية",
  medium: "أولوية متوسطة",
  low: "أولوية منخفضة",
};

export const SEVERITY_TONES: Record<Severity, string> = {
  high: "border-red-500/30 bg-red-500/10 text-red-700",
  medium: "border-amber-500/30 bg-amber-500/10 text-amber-700",
  low: "border-line bg-surface-2 text-muted",
};

export const OPPORTUNITY_TYPE_LABELS: Record<OpportunityType, string> = {
  out_of_stock: "نفاد مخزون",
  high_sales_low_stock: "مبيعات سريعة ومخزون منخفض",
  low_stock: "مخزون منخفض",
  overstock: "مخزون راكد",
  slow_mover: "منتج بطيء",
  weak_category: "فئة بلا مبيعات",
  incomplete_product_data: "بيانات منتج ناقصة",
  stale_sync: "بيانات قديمة",
  no_recent_sales: "لا مبيعات حديثة",
};

export const HEALTH_COMPONENT_LABELS: Record<HealthComponent["id"], string> = {
  catalog_completeness: "اكتمال بيانات المنتجات",
  stock_health: "صحة المخزون",
  sales_activity: "نشاط المبيعات",
  sync_health: "صحة المزامنة",
  freshness: "حداثة البيانات",
};

export const STOCK_RISK_LABELS: Record<StockRisk, string> = {
  out: "نفد",
  low: "منخفض",
  overstock: "راكد",
  unlimited: "بلا حد",
  ok: "متوفر",
};

export function reasonLabel(reason: string | null): string | null {
  if (!reason) return null;
  return REASON_LABELS_AR[reason] ?? reason;
}

export function formatNumber(value: number | null): string {
  return value === null ? "—" : NUMBER.format(value);
}

export function formatMoney(value: number | null, currency: string | null): string {
  if (value === null) return "—";
  return currency ? `${MONEY.format(value)} ${currency}` : MONEY.format(value);
}

export function formatDateTime(value: string | null): string {
  if (!value) return "—";
  return new Intl.DateTimeFormat("ar-SA", {
    dateStyle: "medium",
    timeStyle: "short",
    calendar: "gregory",
    numberingSystem: "latn",
  }).format(new Date(value));
}

/** A metric tile: value if it exists, otherwise `—` plus the reason. */
export function MetricTile({
  label,
  metric,
  format = "number",
  currency = null,
  hint,
}: {
  label: string;
  metric: Metric<number>;
  format?: "number" | "money" | "percent";
  currency?: string | null;
  hint?: string;
}) {
  const value = metric.value;
  const text =
    format === "money"
      ? formatMoney(value, currency)
      : format === "percent"
        ? value === null
          ? "—"
          : `${MONEY.format(value)}%`
        : formatNumber(value);

  const note = reasonLabel(metric.reason);

  return (
    <div className="rounded-2xl border border-line bg-surface/60 px-4 py-3">
      <div className="flex items-start justify-between gap-2">
        <p className="text-[11px] text-muted">{label}</p>
        {metric.availability !== "available" ? (
          <span className="rounded-md bg-surface-2 px-1.5 py-0.5 text-[9.5px] text-muted">
            {metric.availability === "partial" ? "جزئي" : "غير متاح"}
          </span>
        ) : null}
      </div>
      <p className="ltr mt-1 text-lg font-semibold text-ink">{text}</p>
      {note ? <p className="mt-1 text-[10.5px] leading-5 text-muted">{note}</p> : null}
      {hint ? <p className="mt-1 text-[10.5px] leading-5 text-muted">{hint}</p> : null}
    </div>
  );
}

export function ProductRow({ product }: { product: ProductIntelligence }) {
  return (
    <tr className="border-t border-line/60 align-top">
      <td className="py-2.5 pe-3">
        <p className="text-[12.5px] font-medium text-ink">{product.name}</p>
        <p className="mt-0.5 text-[10.5px] text-muted">
          {product.categories.length > 0 ? product.categories.join(" · ") : "بلا تصنيف"}
        </p>
      </td>
      <td className="py-2.5 pe-3">
        <span
          className={`rounded-md px-2 py-0.5 text-[10.5px] font-medium ${CLASS_TONES[product.classification]}`}
        >
          {CLASS_LABELS_AR[product.classification]}
        </span>
      </td>
      <td className="py-2.5 pe-3 text-[12px]">
        <span className="ltr">{formatNumber(product.stock.value)}</span>
        {product.stock.value === null ? (
          <span className="ms-1 text-[10px] text-muted">({reasonLabel(product.stock.reason)})</span>
        ) : null}
      </td>
      <td className="py-2.5 pe-3 text-[12px]">
        <span className="ltr">{formatNumber(product.unitsSold.value)}</span>
        {product.unitsSold.value === null ? (
          <span className="ms-1 text-[10px] text-muted">
            ({reasonLabel(product.unitsSold.reason)})
          </span>
        ) : null}
      </td>
      <td className="py-2.5 text-[12px]">
        <span className="ltr">{formatMoney(product.price.value, null)}</span>
      </td>
    </tr>
  );
}

export function OpportunityCard({ item }: { item: Opportunity }) {
  return (
    <article className="rounded-2xl border border-line bg-surface/60 p-4">
      <div className="flex flex-wrap items-center gap-2">
        <span
          className={`rounded-md border px-2 py-0.5 text-[10.5px] font-semibold ${SEVERITY_TONES[item.severity]}`}
        >
          {SEVERITY_LABELS_AR[item.severity]}
        </span>
        <span className="rounded-md bg-surface-2 px-2 py-0.5 text-[10.5px] text-muted">
          {OPPORTUNITY_TYPE_LABELS[item.type]}
        </span>
        <span className="text-[10.5px] text-muted">
          الثقة:{" "}
          {item.confidence === "high"
            ? "عالية"
            : item.confidence === "medium"
              ? "متوسطة"
              : "منخفضة"}
        </span>
      </div>

      <h3 className="mt-2 text-[13.5px] font-semibold text-ink">{item.title}</h3>
      <p className="mt-1 text-[12px] leading-6 text-muted">{item.description}</p>

      <dl className="mt-3 grid gap-1.5 sm:grid-cols-2">
        {item.evidence.map((evidence) => (
          <div
            key={`${evidence.label}-${String(evidence.value)}`}
            className="flex items-baseline justify-between gap-2 rounded-lg bg-canvas/60 px-2.5 py-1.5"
          >
            <dt className="text-[10.5px] text-muted">{evidence.label}</dt>
            <dd className="text-[11.5px] font-medium text-ink">
              {evidence.value === null ? "—" : String(evidence.value)}
              {evidence.unit ? (
                <span className="ms-1 text-[10px] text-muted">{evidence.unit}</span>
              ) : null}
            </dd>
          </div>
        ))}
      </dl>

      <p className="mt-3 rounded-lg border border-teal/20 bg-teal/5 px-3 py-2 text-[11.5px] leading-6 text-ink">
        <span className="font-semibold">ماذا تفعل: </span>
        {item.recommendedAction}
      </p>
      <p className="mt-1.5 text-[10.5px] leading-5 text-muted">{item.rationale}</p>
    </article>
  );
}

export function HealthPanel({ health }: { health: StoreHealth }) {
  const score = health.score;

  return (
    <section className="rounded-2xl border border-line bg-surface/60 p-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-[13.5px] font-semibold text-ink">صحة المتجر</h2>
          <p className="mt-1 text-[11px] text-muted">
            مؤشر حتمي من خمسة مكوّنات؛ لا ذكاء اصطناعي ولا معايير خارجية.
          </p>
        </div>
        <div className="text-end">
          <p className="ltr text-2xl font-semibold text-ink">
            {score.value === null ? "—" : `${score.value}`}
            <span className="text-[11px] text-muted"> / 100</span>
          </p>
          <p className="text-[10.5px] text-muted">
            {score.value === null
              ? reasonLabel(score.reason)
              : health.grade === "excellent"
                ? "ممتاز"
                : health.grade === "good"
                  ? "جيد"
                  : health.grade === "fair"
                    ? "مقبول"
                    : "ضعيف"}
          </p>
        </div>
      </div>

      <ul className="mt-4 space-y-2">
        {health.components.map((component) => (
          <li key={component.id} className="rounded-lg bg-canvas/60 px-3 py-2">
            <div className="flex items-center justify-between gap-2">
              <span className="text-[11.5px] text-ink">
                {HEALTH_COMPONENT_LABELS[component.id]}
                <span className="ms-1.5 text-[10px] text-muted">وزن {component.weight}</span>
              </span>
              <span className="ltr text-[11.5px] font-medium text-ink">
                {component.score === null ? "—" : component.score}
              </span>
            </div>
            <p className="mt-0.5 text-[10px] leading-5 text-muted">{component.detail}</p>
          </li>
        ))}
      </ul>
    </section>
  );
}

export function CategoryTable({ categories }: { categories: CategoryIntelligence }) {
  if (categories.items.length === 0) {
    return (
      <p className="rounded-2xl border border-dashed border-line px-4 py-6 text-center text-[12px] text-muted">
        لا توجد تصنيفات محفوظة بعد. شغّل مزامنة التصنيفات والمنتجات.
      </p>
    );
  }

  return (
    <div className="overflow-x-auto rounded-2xl border border-line">
      <table className="w-full min-w-[520px] text-start">
        <thead className="bg-surface-2/60 text-[10.5px] text-muted">
          <tr>
            <th className="px-3 py-2 text-start font-medium">الفئة</th>
            <th className="px-3 py-2 text-start font-medium">المنتجات</th>
            <th className="px-3 py-2 text-start font-medium">متاح</th>
            <th className="px-3 py-2 text-start font-medium">وحدات مبيعة (تراكمي)</th>
          </tr>
        </thead>
        <tbody>
          {categories.items.slice(0, 20).map((category) => (
            <tr key={category.categoryId} className="border-t border-line/60">
              <td className="px-3 py-2 text-[12px] text-ink">
                {category.name}
                {category.weak ? (
                  <span className="ms-2 rounded bg-amber-500/15 px-1.5 py-0.5 text-[9.5px] text-amber-700">
                    بلا مبيعات
                  </span>
                ) : null}
              </td>
              <td className="ltr px-3 py-2 text-[12px]">{category.productCount}</td>
              <td className="ltr px-3 py-2 text-[12px]">{category.availableProducts}</td>
              <td className="px-3 py-2 text-[12px]">
                {category.unitsSold.value === null ? (
                  <span className="text-muted">—</span>
                ) : (
                  <span className="ltr">{formatNumber(category.unitsSold.value)}</span>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {categories.uncategorisedProducts > 0 ? (
        <p className="border-t border-line/60 px-3 py-2 text-[10.5px] text-muted">
          {categories.uncategorisedProducts} منتجًا بلا تصنيف — لا تظهر في أي فئة.
        </p>
      ) : null}
    </div>
  );
}

export function InventoryPanel({ inventory }: { inventory: InventoryIntelligence }) {
  return (
    <div className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-4">
        <div className="rounded-2xl border border-line bg-surface/60 px-4 py-3">
          <p className="text-[11px] text-muted">أصناف متتبّعة</p>
          <p className="ltr mt-1 text-lg font-semibold text-ink">{inventory.trackedProducts}</p>
        </div>
        <div className="rounded-2xl border border-red-500/25 bg-red-500/5 px-4 py-3">
          <p className="text-[11px] text-muted">نفد مخزونها</p>
          <p className="ltr mt-1 text-lg font-semibold text-ink">{inventory.outOfStock}</p>
        </div>
        <div className="rounded-2xl border border-amber-500/25 bg-amber-500/5 px-4 py-3">
          <p className="text-[11px] text-muted">مخزون منخفض</p>
          <p className="ltr mt-1 text-lg font-semibold text-ink">{inventory.lowStock}</p>
        </div>
        <div className="rounded-2xl border border-line bg-surface/60 px-4 py-3">
          <p className="text-[11px] text-muted">راكد (بلا مبيعات)</p>
          <p className="ltr mt-1 text-lg font-semibold text-ink">{inventory.overstock}</p>
        </div>
      </div>

      <p className="text-[10.5px] leading-6 text-muted">
        السرعة (وحدة/يوم) وأيام التغطية <span className="font-semibold">غير متاحة</span>: Salla لا
        توثّق فترة زمنية لقيمة <span className="ltr">sold_quantity</span>، وحسابها يتطلب اختراع
        فترة.
      </p>

      {inventory.items.length === 0 ? (
        <p className="rounded-2xl border border-dashed border-line px-4 py-6 text-center text-[12px] text-muted">
          لا توجد بيانات مخزون محفوظة بعد. شغّل مزامنة الكميات.
        </p>
      ) : (
        <div className="overflow-x-auto rounded-2xl border border-line">
          <table className="w-full min-w-[520px] text-start">
            <thead className="bg-surface-2/60 text-[10.5px] text-muted">
              <tr>
                <th className="px-3 py-2 text-start font-medium">الصنف</th>
                <th className="px-3 py-2 text-start font-medium">الكمية</th>
                <th className="px-3 py-2 text-start font-medium">مبيعات تراكمية</th>
                <th className="px-3 py-2 text-start font-medium">الحالة</th>
              </tr>
            </thead>
            <tbody>
              {inventory.items.slice(0, 20).map((item) => (
                <tr
                  key={`${item.productId ?? item.externalProductId}`}
                  className="border-t border-line/60"
                >
                  <td className="px-3 py-2 text-[12px] text-ink">{item.name}</td>
                  <td className="ltr px-3 py-2 text-[12px]">{item.quantity}</td>
                  <td className="ltr px-3 py-2 text-[12px]">{item.soldQuantity}</td>
                  <td className="px-3 py-2 text-[11.5px] text-muted">
                    {STOCK_RISK_LABELS[item.risk]}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
