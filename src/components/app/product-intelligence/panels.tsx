import type { CategoryHealth } from "@/modules/product-intelligence/domain/categories";
import type {
  CatalogConfidence,
  CatalogCoverage,
} from "@/modules/product-intelligence/domain/catalog";
import type {
  IssueSummary,
  ProductAnalysis,
  Recommendation,
} from "@/modules/product-intelligence/domain/types";
import {
  CONTENT_CHECK_IDS,
  CONTENT_CHECK_LABELS_AR,
  contentWeight,
  type ContentCheckId,
} from "@/modules/product-intelligence/domain/content";
import { PRODUCT_THRESHOLDS } from "@/modules/product-intelligence/domain/thresholds";

import { formatDateTime, formatNumber, reasonLabel } from "@/components/app/intelligence/panels";

/**
 * Presentation for the product-intelligence page.
 *
 * Same rule as the shared panels: a value that does not exist is rendered as
 * `—` with its reason. Nothing here computes a metric, invents a percentage, or
 * offers an action — the page reports what the engines found.
 */

const SEVERITY_LABELS_AR: Record<string, string> = {
  high: "عالية",
  medium: "متوسطة",
  low: "منخفضة",
};

const SEVERITY_CLASS: Record<string, string> = {
  high: "border-rose/30 bg-rose/10 text-rose",
  medium: "border-amber/30 bg-amber/10 text-amber",
  low: "border-line bg-surface-2 text-muted",
};

const IMAGE_STATUS_AR: Record<string, string> = {
  present: "موجودة",
  missing: "غير موجودة",
  invalid: "رابط غير صالح",
};

const PRIORITY_AR: Record<string, string> = {
  P1: "أولوية أولى",
  P2: "أولوية ثانية",
  P3: "أولوية ثالثة",
};

const COVERAGE_NOTES_AR: Record<string, string> = {
  products_not_synced: "المنتجات لم تُزامَن بعد",
  products_sync_incomplete: "آخر مزامنة للمنتجات لم تكتمل",
  categories_not_synced: "التصنيفات لم تُزامَن بعد",
  categories_sync_incomplete: "آخر مزامنة للتصنيفات لم تكتمل",
  products_skipped_in_last_run: "تخطّت آخر مزامنة بعض المنتجات",
  categories_skipped_in_last_run: "تخطّت آخر مزامنة بعض التصنيفات",
  no_products_stored: "لا توجد منتجات محفوظة",
  metadata_not_captured: "البيانات الوصفية غير محفوظة لبعض المنتجات",
};

export function SeverityBadge({ severity }: { severity: string | null }) {
  if (severity === null) {
    return (
      <span className="rounded-md border border-teal/25 bg-teal/10 px-1.5 py-0.5 text-[10px] text-teal">
        سليم
      </span>
    );
  }

  return (
    <span
      className={`rounded-md border px-1.5 py-0.5 text-[10px] ${SEVERITY_CLASS[severity] ?? SEVERITY_CLASS.low}`}
    >
      {SEVERITY_LABELS_AR[severity] ?? severity}
    </span>
  );
}

/** Coverage, confidence, and the notes that explain a partial snapshot. */
export function CoverageBanner({
  coverage,
  confidence,
  syncedAt,
}: {
  coverage: CatalogCoverage;
  confidence: CatalogConfidence;
  syncedAt: string | null;
}) {
  const tone =
    confidence.level === "high"
      ? "border-teal/25 bg-teal/5"
      : confidence.level === "medium"
        ? "border-amber/25 bg-amber/5"
        : "border-rose/25 bg-rose/5";

  const label =
    confidence.level === "high"
      ? "ثقة عالية"
      : confidence.level === "medium"
        ? "ثقة متوسطة"
        : "ثقة منخفضة";

  return (
    <section className={`rounded-2xl border px-5 py-4 ${tone}`}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm font-semibold text-ink">{label}</p>
        <p className="text-[11.5px] text-muted">آخر مزامنة ناجحة: {formatDateTime(syncedAt)}</p>
      </div>

      <p className="mt-2 text-[11.5px] leading-6 text-muted">
        {coverage.status === "complete"
          ? "النسخة المحلية تغطي الكتالوج بالكامل."
          : coverage.status === "partial"
            ? "النسخة المحلية جزئية — الأرقام أدناه محسوبة على ما حُفظ فعلًا."
            : "لا توجد منتجات محفوظة بعد؛ كل مؤشر يظهر غير متاح مع سببه."}
      </p>

      {coverage.notes.length > 0 ? (
        <ul className="mt-2 flex flex-wrap gap-1.5">
          {coverage.notes.map((note) => (
            <li
              key={note}
              className="rounded-md border border-line bg-surface/70 px-1.5 py-0.5 text-[10px] text-muted"
            >
              {COVERAGE_NOTES_AR[note] ?? note}
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}

/** Ranked issues: score, rule, affected count, and the products it hit. */
export function IssueTable({ items }: { items: readonly IssueSummary[] }) {
  if (items.length === 0) {
    return (
      <p className="rounded-2xl border border-line bg-surface/60 px-4 py-4 text-[12px] text-muted">
        لا مشكلات مسجّلة في الكتالوج الحالي.
      </p>
    );
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[640px] text-right">
        <thead>
          <tr className="text-[10.5px] text-muted">
            <th className="py-2 pe-3 font-medium">#</th>
            <th className="py-2 pe-3 font-medium">المشكلة</th>
            <th className="py-2 pe-3 font-medium">الخطورة</th>
            <th className="py-2 pe-3 font-medium">منتجات</th>
            <th className="py-2 pe-3 font-medium">النسبة</th>
            <th className="py-2 pe-3 font-medium">الدرجة</th>
            <th className="py-2 pe-3 font-medium">أمثلة</th>
          </tr>
        </thead>
        <tbody>
          {items.map((item, index) => (
            <tr key={item.id} className="border-t border-line/60 align-top">
              <td className="py-2.5 pe-3 text-[11px] text-muted">{index + 1}</td>
              <td className="py-2.5 pe-3">
                <p className="text-[12.5px] font-medium text-ink">{item.definition}</p>
                <p className="ltr mt-0.5 text-[10.5px] text-muted">{item.rule}</p>
              </td>
              <td className="py-2.5 pe-3">
                <SeverityBadge severity={item.severity} />
              </td>
              <td className="py-2.5 pe-3 text-[12px] text-ink">
                {formatNumber(item.affectedCount)}
              </td>
              <td className="py-2.5 pe-3 text-[12px] text-muted">
                {item.affectedPercent.toFixed(1)}%
              </td>
              <td className="py-2.5 pe-3 text-[12px] font-medium text-ink">
                {formatNumber(item.score)}
              </td>
              <td className="py-2.5 pe-3 text-[11px] leading-5 text-muted">
                {item.evidence.join(" · ")}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** A rule-based recommendation. Advisory only — there is no button. */
export function RecommendationCard({ item }: { item: Recommendation }) {
  return (
    <article className="rounded-2xl border border-line bg-surface/60 px-4 py-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-[12.5px] font-semibold text-ink">{item.title}</p>
        <div className="flex items-center gap-1.5">
          <span className="rounded-md border border-line bg-surface-2 px-1.5 py-0.5 text-[10px] text-muted">
            {PRIORITY_AR[item.priority] ?? item.priority}
          </span>
          <SeverityBadge severity={item.severity} />
        </div>
      </div>

      <p className="mt-2 text-[11.5px] leading-6 text-muted">{item.rationale}</p>

      <p className="mt-2 text-[11px] leading-5 text-muted">
        القاعدة: <span className="ltr">{item.rule}</span> · يؤثر على{" "}
        {formatNumber(item.affectedCount)} منتج ({item.affectedPercent.toFixed(1)}%)
      </p>

      {item.examples.length > 0 ? (
        <p className="mt-1 text-[11px] leading-5 text-muted">أمثلة: {item.examples.join(" · ")}</p>
      ) : null}

      <p className="mt-2 rounded-md border border-line/70 bg-surface px-2 py-1 text-[10.5px] text-muted">
        توصية استشارية فقط — لا يوجد تنفيذ تلقائي ولا تعديل على Salla.
      </p>
    </article>
  );
}

function failingChecks(product: ProductAnalysis): string[] {
  return product.content.failed.map((id) => {
    const known = (CONTENT_CHECK_IDS as readonly string[]).includes(id);
    const label = CONTENT_CHECK_LABELS_AR[id as ContentCheckId] ?? id;
    return known ? `${label} (−${contentWeight(id as ContentCheckId)})` : label;
  });
}

function contentScoreText(product: ProductAnalysis): string {
  const value = product.content.score.value;
  return value === null ? "—" : `${formatNumber(value)} / 100`;
}

function stockText(product: ProductAnalysis): string {
  const stock = product.commercial.stock;
  if (stock.availability === "unavailable") return reasonLabel(stock.reason) ?? "—";
  if (stock.value === null) return "—";
  if (product.commercial.unlimitedQuantity) return "بلا حد";
  return formatNumber(stock.value);
}

/** Product-level health table, worst first (the order comes from the service). */
export function ProductHealthTable({ items }: { items: readonly ProductAnalysis[] }) {
  if (items.length === 0) {
    return (
      <p className="rounded-2xl border border-line bg-surface/60 px-4 py-4 text-[12px] text-muted">
        لا منتجات مطابقة. إن كان الكتالوج فارغًا فشغّل مزامنة المنتجات أولًا.
      </p>
    );
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[760px] text-right">
        <thead>
          <tr className="text-[10.5px] text-muted">
            <th className="py-2 pe-3 font-medium">المنتج</th>
            <th className="py-2 pe-3 font-medium">جودة المحتوى</th>
            <th className="py-2 pe-3 font-medium">البيانات الوصفية</th>
            <th className="py-2 pe-3 font-medium">الصورة</th>
            <th className="py-2 pe-3 font-medium">المخزون</th>
            <th className="py-2 pe-3 font-medium">آخر تحديث</th>
            <th className="py-2 pe-3 font-medium">المشكلات</th>
            <th className="py-2 pe-3 font-medium">الخطورة</th>
          </tr>
        </thead>
        <tbody>
          {items.map((product) => {
            const metadata = product.metadata.score;
            const failed = product.content.failed;

            return (
              <tr key={product.id} className="border-t border-line/60 align-top">
                <td className="py-2.5 pe-3">
                  <p className="text-[12.5px] font-medium text-ink">{product.name}</p>
                  <p className="ltr mt-0.5 text-[10px] text-muted">{product.sku ?? "—"}</p>
                  <p className="mt-0.5 text-[10.5px] text-muted">
                    {product.categories.length > 0 ? product.categories.join(" · ") : "بلا تصنيف"}
                  </p>
                </td>
                <td className="py-2.5 pe-3">
                  <p className="ltr text-[12px] text-ink">{contentScoreText(product)}</p>
                  {failed.length > 0 ? (
                    <p className="mt-0.5 text-[10px] leading-5 text-muted">
                      {failingChecks(product).join(" · ")}
                    </p>
                  ) : null}
                </td>
                <td className="py-2.5 pe-3">
                  <p className="ltr text-[12px] text-ink">
                    {metadata.value === null ? "—" : `${formatNumber(metadata.value)} / 100`}
                  </p>
                  {metadata.availability !== "available" ? (
                    <p className="mt-0.5 text-[10px] leading-5 text-muted">
                      {reasonLabel(metadata.reason) ?? metadata.availability}
                    </p>
                  ) : null}
                </td>
                <td className="py-2.5 pe-3">
                  <p className="text-[12px] text-ink">
                    {IMAGE_STATUS_AR[product.images.status] ?? product.images.status}
                  </p>
                  <p className="mt-0.5 text-[10px] leading-5 text-muted">
                    العدد ونص البديل غير محفوظين
                  </p>
                </td>
                <td className="py-2.5 pe-3 text-[11.5px] text-muted">{stockText(product)}</td>
                <td className="py-2.5 pe-3 text-[11px] text-muted">
                  {product.lifecycle.lastUpdated.availability === "available"
                    ? formatDateTime(product.lifecycle.lastUpdated.value)
                    : (reasonLabel(product.lifecycle.lastUpdated.reason) ?? "—")}
                  <span className="mt-0.5 block text-[10px]">
                    {product.lifecycle.stale === true
                      ? `أقدم من ${PRODUCT_THRESHOLDS.STALE_CONTENT_DAYS} يومًا`
                      : product.lifecycle.stale === false
                        ? "حديث"
                        : "غير معروف"}
                  </span>
                </td>
                <td className="py-2.5 pe-3 text-[11.5px] text-muted">
                  {formatNumber(product.issues.length)}
                </td>
                <td className="py-2.5 pe-3">
                  <SeverityBadge severity={product.severity} />
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

/** Category catalogue health — explicitly not sales performance. */
export function CategoryHealthTable({ items }: { items: readonly CategoryHealth[] }) {
  if (items.length === 0) {
    return (
      <p className="rounded-2xl border border-line bg-surface/60 px-4 py-4 text-[12px] text-muted">
        لا تصنيفات محفوظة بعد.
      </p>
    );
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[720px] text-right">
        <thead>
          <tr className="text-[10.5px] text-muted">
            <th className="py-2 pe-3 font-medium">التصنيف</th>
            <th className="py-2 pe-3 font-medium">منتجات</th>
            <th className="py-2 pe-3 font-medium">بلا وصف</th>
            <th className="py-2 pe-3 font-medium">بلا بيانات وصفية</th>
            <th className="py-2 pe-3 font-medium">بلا صورة</th>
            <th className="py-2 pe-3 font-medium">متوسط المحتوى</th>
            <th className="py-2 pe-3 font-medium">الاكتمال</th>
            <th className="py-2 pe-3 font-medium">أداء المبيعات</th>
          </tr>
        </thead>
        <tbody>
          {items.map((category) => (
            <tr key={category.id} className="border-t border-line/60 align-top">
              <td className="py-2.5 pe-3">
                <p className="text-[12.5px] font-medium text-ink">{category.name}</p>
                <p className="ltr mt-0.5 text-[10px] text-muted">
                  {category.status}
                  {category.hidden ? " · مخفي" : ""}
                </p>
              </td>
              <td className="py-2.5 pe-3 text-[12px] text-ink">
                {formatNumber(category.productCount)}
              </td>
              <td className="py-2.5 pe-3 text-[11.5px] text-muted">
                {formatNumber(category.missingDescription)}{" "}
                <span className="text-[10px]">
                  ({category.missingDescriptionPercent.toFixed(1)}%)
                </span>
              </td>
              <td className="py-2.5 pe-3 text-[11.5px] text-muted">
                {formatNumber(category.missingMetadata)}{" "}
                <span className="text-[10px]">({category.missingMetadataPercent.toFixed(1)}%)</span>
              </td>
              <td className="py-2.5 pe-3 text-[11.5px] text-muted">
                {formatNumber(category.missingImage)}{" "}
                <span className="text-[10px]">({category.missingImagePercent.toFixed(1)}%)</span>
              </td>
              <td className="py-2.5 pe-3">
                {category.averageContentScore.availability === "available" ? (
                  <span className="ltr text-[12px] text-ink">
                    {formatNumber(category.averageContentScore.value)} / 100
                  </span>
                ) : (
                  <span className="text-[11px] text-muted">
                    {reasonLabel(category.averageContentScore.reason) ?? "—"}
                  </span>
                )}
              </td>
              <td className="py-2.5 pe-3">
                {category.completenessPercent.availability === "available" ? (
                  <span className="ltr text-[12px] text-ink">
                    {formatNumber(category.completenessPercent.value)}%
                  </span>
                ) : (
                  <span className="text-[11px] text-muted">
                    {reasonLabel(category.completenessPercent.reason) ?? "—"}
                  </span>
                )}
              </td>
              <td className="py-2.5 pe-3 text-[11px] leading-5 text-muted">
                {reasonLabel(category.salesAttribution.reason) ?? "—"}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
