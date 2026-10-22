import type { CategoryInventoryHealth } from "@/modules/inventory-intelligence/domain/categories";
import type {
  InventoryConfidence,
  InventoryCoverage,
  InventoryIssueSummary,
  InventoryRecommendation,
  InventoryStatus,
  ProductInventoryAnalysis,
} from "@/modules/inventory-intelligence/domain/types";

import { formatDateTime, formatNumber, reasonLabel } from "@/components/app/intelligence/panels";

/**
 * Presentation for the inventory-intelligence page.
 *
 * The rule of the screen: a number either exists and names its population, or it
 * is `—` with a reason. No cell carries a value the server did not compute, and
 * nothing on this page can change inventory — there is no button, no form post,
 * and no action link.
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

const STATUS_LABELS_AR: Record<InventoryStatus, string> = {
  unlimited: "غير محدود",
  in_stock: "متوفر",
  low_stock: "منخفض",
  out_of_stock: "نافد",
  unknown: "غير معروف",
};

const STATUS_CLASS: Record<InventoryStatus, string> = {
  unlimited: "border-teal/25 bg-teal/5 text-teal",
  in_stock: "border-teal/25 bg-teal/10 text-teal",
  low_stock: "border-amber/30 bg-amber/10 text-amber",
  out_of_stock: "border-rose/30 bg-rose/10 text-rose",
  unknown: "border-line bg-surface-2 text-muted",
};

const PRIORITY_AR: Record<string, string> = {
  P1: "أولوية أولى",
  P2: "أولوية ثانية",
  P3: "أولوية ثالثة",
};

const COVERAGE_NOTES_AR: Record<string, string> = {
  no_products_stored: "لا توجد منتجات محفوظة في الكتالوج",
  inventory_not_synced: "مخزون المتجر لم يُزامَن بعد",
  inventory_sync_incomplete: "آخر مزامنة للمخزون لم تكتمل",
  no_inventory_rows: "لا توجد صفوف مخزون محفوظة",
  inventory_entries_unlinked: "سجلات مخزون غير مرتبطة بمنتجات",
  products_without_inventory_record: "بعض المنتجات بلا سجل مخزون",
  inventory_snapshot_stale: "لقطة المخزون أقدم من الحد المعلن",
};

const ISSUE_POPULATION_AR: Record<string, string> = {
  products: "من إجمالي المنتجات",
  inventory_entries: "من إجمالي سجلات المخزون",
};

export function StockStatusBadge({ status }: { status: InventoryStatus }) {
  return (
    <span
      className={`rounded-md border px-1.5 py-0.5 text-[10px] ${STATUS_CLASS[status]}`}
      title={status === "unknown" ? "لا يوجد سجل مخزون لهذا المنتج" : undefined}
    >
      {STATUS_LABELS_AR[status]}
    </span>
  );
}

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

/**
 * Data-quality banner. Every partial state is named, not smoothed over: the
 * merchant must be able to tell "the shelf is empty" from "we never saw the
 * shelf".
 */
export function InventoryCoverageBanner({
  coverage,
  confidence,
  syncedAt,
}: {
  coverage: InventoryCoverage;
  confidence: InventoryConfidence;
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

  const body =
    coverage.status === "complete"
      ? "كل منتج في الكتالوج له سجل مخزون، واللقطة حديثة بما يكفي."
      : coverage.status === "partial"
        ? "البيانات جزئية — بعض المنتجات بلا سجل مخزون أو أن آخر مزامنة لم تكتمل. الأرقام أدناه محسوبة على ما حُفظ فعلًا، وتغطيتها أقل من 100%."
        : "لا توجد بيانات مخزون محفوظة لهذا المتجر — لم تتم مزامنة بيانات المخزون بعد. لن ترى أصفارًا؛ كل مؤشر يظهر «—» مع سببه.";

  return (
    <section className={`rounded-2xl border px-5 py-4 ${tone}`} aria-labelledby="inv-quality">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p id="inv-quality" className="text-sm font-semibold text-ink">
          جودة البيانات — {label}
        </p>
        <p className="text-[11.5px] text-muted">
          التغطية{" "}
          <span className="ltr">
            {coverage.coveragePercent.value === null
              ? "—"
              : `${formatNumber(coverage.coveragePercent.value)}%`}
          </span>
          <span className="mx-1">·</span>
          آخر مزامنة ناجحة: {formatDateTime(syncedAt)}
        </p>
      </div>

      <p className="mt-2 text-[11.5px] leading-6 text-muted">{body}</p>

      {coverage.notes.length > 0 ? (
        <ul className="mt-2 flex flex-wrap gap-1.5">
          {coverage.notes.map((note) => (
            <li
              key={note}
              className="rounded-md border border-line bg-surface/70 px-1.5 py-0.5 text-[10px] text-muted"
            >
              {COVERAGE_NOTES_AR[note] ?? reasonLabel(note) ?? note}
            </li>
          ))}
        </ul>
      ) : null}

      <p className="mt-2 text-[10.5px] leading-5 text-muted">
        لا تُقرأ التغطية كأنها 100% عند نقص السجلات، ولا تُستنتج كمية لمنتج بلا سجل.
      </p>
    </section>
  );
}

function quantityText(product: ProductInventoryAnalysis): string {
  if (product.unlimited === true) return "غير محدود";
  return product.stock.value === null ? "—" : formatNumber(product.stock.value);
}

/**
 * The products table.
 *
 * Columns: product, stock, status, coverage, days remaining, risk. The last two
 * are unavailable for every row today, and they say why rather than showing a
 * dash with no explanation. `highStockQuantity` is a neutral quantity note and is
 * labelled as such — never «راكد».
 */
export function InventoryProductTable({ items }: { items: readonly ProductInventoryAnalysis[] }) {
  if (items.length === 0) {
    return (
      <p className="rounded-2xl border border-line bg-surface/60 px-4 py-4 text-[12px] text-muted">
        لا منتجات مطابقة لهذا البحث أو الفلتر. إن كان المتجر بلا منتجات فشغّل مزامنة المنتجات أولًا،
        وإن لم تُزامَن الكميات فشغّل مزامنة المخزون.
      </p>
    );
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[860px] text-right">
        <thead>
          <tr className="text-[10.5px] text-muted">
            <th className="py-2 pe-3 font-medium">المنتج</th>
            <th className="py-2 pe-3 font-medium">المخزون</th>
            <th className="py-2 pe-3 font-medium">الحالة</th>
            <th className="py-2 pe-3 font-medium">التغطية</th>
            <th className="py-2 pe-3 font-medium">الأيام المتبقية</th>
            <th className="py-2 pe-3 font-medium">المخاطر</th>
          </tr>
        </thead>
        <tbody>
          {items.map((product) => (
            <tr key={product.id} className="border-t border-line/60 align-top">
              <td className="py-2.5 pe-3">
                <p className="text-[12.5px] font-medium text-ink">{product.name}</p>
                <p className="ltr mt-0.5 text-[10px] text-muted">{product.sku ?? "—"}</p>
                <p className="mt-0.5 text-[10.5px] text-muted">
                  {product.categories.length > 0 ? product.categories.join(" · ") : "بلا تصنيف"}
                  {product.variants.length > 1
                    ? ` · ${formatNumber(product.variants.length)} متغيّر`
                    : ""}
                </p>
              </td>

              <td className="py-2.5 pe-3">
                <p className="ltr text-[12.5px] text-ink">{quantityText(product)}</p>
                {product.highStockQuantity ? (
                  <p className="mt-0.5 text-[10px] leading-5 text-muted">
                    كمية مرتفعة — ملاحظة كمية لا حكم راكد
                  </p>
                ) : null}
                {product.cumulativeSoldQuantity.value !== null ? (
                  <p className="mt-0.5 text-[10px] leading-5 text-muted">
                    مبيع تراكمي:{" "}
                    <span className="ltr">
                      {formatNumber(product.cumulativeSoldQuantity.value)}
                    </span>{" "}
                    (بلا فترة)
                  </p>
                ) : null}
              </td>

              <td className="py-2.5 pe-3">
                <StockStatusBadge status={product.status} />
                {product.severity !== null ? (
                  <p className="mt-1">
                    <SeverityBadge severity={product.severity} />
                  </p>
                ) : null}
              </td>

              <td className="py-2.5 pe-3 text-[11px] leading-5 text-muted">
                {product.stock.availability === "available" ? (
                  <span className="text-teal">كمية محفوظة</span>
                ) : (
                  <>
                    <span>—</span>
                    <span className="mt-0.5 block text-[10px]">
                      {reasonLabel(product.stock.reason) ?? "بلا سجل مخزون"}
                    </span>
                  </>
                )}
              </td>

              <td className="py-2.5 pe-3 text-[11px] leading-5 text-muted">
                <span className="ltr">
                  {product.daysOfStock.value === null
                    ? "—"
                    : formatNumber(product.daysOfStock.value)}
                </span>
                <span className="mt-0.5 block text-[10px]">
                  {reasonLabel(product.daysOfStock.reason) ?? "غير متاح"}
                </span>
              </td>

              <td className="py-2.5 pe-3 text-[11px] leading-5 text-muted">
                <span>{product.stockoutRisk === "unknown" ? "—" : product.stockoutRisk}</span>
                <span className="mt-0.5 block text-[10px]">
                  {reasonLabel(product.stockoutRiskReason) ?? "لا تنبؤ متاح"}
                </span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function InventoryIssueTable({ items }: { items: readonly InventoryIssueSummary[] }) {
  if (items.length === 0) {
    return (
      <p className="rounded-2xl border border-line bg-surface/60 px-4 py-4 text-[12px] text-muted">
        لا مشكلات مخزون مطابقة لقواعد المرحلة على هذه اللقطة.
      </p>
    );
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[720px] text-right">
        <thead>
          <tr className="text-[10.5px] text-muted">
            <th className="py-2 pe-3 font-medium">المشكلة</th>
            <th className="py-2 pe-3 font-medium">الخطورة</th>
            <th className="py-2 pe-3 font-medium">المتأثرون</th>
            <th className="py-2 pe-3 font-medium">القاعدة</th>
            <th className="py-2 pe-3 font-medium">أمثلة</th>
          </tr>
        </thead>
        <tbody>
          {items.map((issue) => (
            <tr key={issue.id} className="border-t border-line/60 align-top">
              <td className="py-2.5 pe-3">
                <p className="text-[12px] font-medium text-ink">{issue.definition}</p>
                <p className="ltr mt-0.5 text-[10px] text-muted">{issue.id}</p>
              </td>
              <td className="py-2.5 pe-3">
                <SeverityBadge severity={issue.severity} />
              </td>
              <td className="py-2.5 pe-3 text-[11.5px] text-muted">
                <span className="ltr">{formatNumber(issue.affectedCount)}</span>
                <span className="mx-1">·</span>
                <span className="ltr">{formatNumber(issue.affectedPercent)}%</span>
                <p className="mt-0.5 text-[10px]">
                  {ISSUE_POPULATION_AR[issue.population] ?? issue.population}
                </p>
              </td>
              <td className="py-2.5 pe-3 text-[11px] text-muted">
                <span className="ltr text-[10px]">{issue.rule}</span>
                <p className="mt-0.5 text-[10px]">الدرجة {formatNumber(issue.score)}</p>
              </td>
              <td className="py-2.5 pe-3 text-[10.5px] leading-5 text-muted">
                {issue.evidence.length === 0
                  ? "—"
                  : issue.evidence.slice(0, 3).map((name, index) => (
                      <span key={`${issue.id}-${name}-${index}`} className="block">
                        {name}
                      </span>
                    ))}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function InventoryCategoryTable({ items }: { items: readonly CategoryInventoryHealth[] }) {
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
            <th className="py-2 pe-3 font-medium">المنتجات</th>
            <th className="py-2 pe-3 font-medium">متوفر</th>
            <th className="py-2 pe-3 font-medium">منخفض</th>
            <th className="py-2 pe-3 font-medium">نافد</th>
            <th className="py-2 pe-3 font-medium">بلا سجل</th>
            <th className="py-2 pe-3 font-medium">التغطية</th>
            <th className="py-2 pe-3 font-medium">معدل الطلب</th>
          </tr>
        </thead>
        <tbody>
          {items.map((category) => (
            <tr key={category.id} className="border-t border-line/60 align-top">
              <td className="py-2.5 pe-3">
                <p className="text-[12px] font-medium text-ink">{category.name}</p>
                {category.hidden ? <p className="mt-0.5 text-[10px] text-muted">مخفي</p> : null}
              </td>
              <td className="py-2.5 pe-3 text-[11.5px] text-muted">
                {formatNumber(category.productCount)}
              </td>
              <td className="py-2.5 pe-3 text-[11.5px] text-muted">
                {formatNumber(category.inStock + category.unlimited)}
                <span className="mx-1">·</span>
                <span className="ltr">{formatNumber(category.inStockPercent.value ?? 0)}%</span>
              </td>
              <td className="py-2.5 pe-3 text-[11.5px] text-muted">
                {formatNumber(category.lowStock)}
              </td>
              <td className="py-2.5 pe-3 text-[11.5px] text-muted">
                {formatNumber(category.outOfStock)}
                <span className="mx-1">·</span>
                <span className="ltr">{formatNumber(category.outOfStockPercent.value ?? 0)}%</span>
              </td>
              <td className="py-2.5 pe-3 text-[11.5px] text-muted">
                {formatNumber(category.unknownCount)}
              </td>
              <td className="py-2.5 pe-3 text-[11.5px] text-muted">
                <span className="ltr">
                  {category.coveragePercent.value === null
                    ? "—"
                    : `${formatNumber(category.coveragePercent.value)}%`}
                </span>
                {category.coveragePercent.availability !== "available" ? (
                  <span className="mt-0.5 block text-[10px]">
                    {reasonLabel(category.coveragePercent.reason) ?? "غير متاح"}
                  </span>
                ) : null}
              </td>
              <td className="py-2.5 pe-3 text-[10.5px] text-muted">
                <span>—</span>
                <span className="mt-0.5 block">
                  {reasonLabel(category.demandRate.reason) ?? "غير متاح"}
                </span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function InventoryRecommendationCard({ item }: { item: InventoryRecommendation }) {
  return (
    <article className="rounded-2xl border border-line bg-surface/60 px-4 py-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-[12.5px] font-semibold text-ink">{item.title}</p>
        <div className="flex items-center gap-1.5">
          <SeverityBadge severity={item.severity} />
          <span className="rounded-md border border-line bg-surface-2 px-1.5 py-0.5 text-[10px] text-muted">
            {PRIORITY_AR[item.priority] ?? item.priority}
          </span>
        </div>
      </div>

      <p className="mt-2 text-[11.5px] leading-6 text-muted">{item.rationale}</p>

      <div className="mt-2 flex flex-wrap items-center gap-2 text-[10px] text-muted">
        <span className="ltr rounded-md bg-surface-2 px-1.5 py-0.5">{item.rule}</span>
        <span className="ltr">{formatNumber(item.affectedCount)}</span>
        <span>متأثر</span>
        <span className="ltr">({formatNumber(item.affectedPercent)}%)</span>
      </div>

      {item.evidence.length > 0 ? (
        <p className="mt-2 text-[10.5px] leading-5 text-muted">
          أمثلة: {item.evidence.slice(0, 3).join(" · ")}
        </p>
      ) : null}

      <p className="mt-2 text-[10px] text-muted">
        استشارية فقط — لا تُنفَّذ أي كتابة مخزون من هذه الشاشة.
      </p>
    </article>
  );
}

/**
 * «كيف نحسب هذه الأرقام؟» — the methodology block. It names each formula, its
 * denominator, and the four quantities the source cannot produce.
 */
export function InventoryMethodology({
  definitions,
  unavailableByDesign,
  thresholds,
  thresholdLabels,
}: {
  definitions: Record<string, string>;
  unavailableByDesign: readonly {
    metric: string;
    reason: string;
    explanation: string;
  }[];
  thresholds: Record<string, number | Record<string, number>>;
  thresholdLabels: Record<string, string>;
}) {
  return (
    <section aria-labelledby="inv-methodology" className="space-y-3">
      <h2 id="inv-methodology" className="text-sm font-semibold text-ink">
        كيف نحسب هذه الأرقام؟
      </h2>

      <div className="grid gap-3 md:grid-cols-2">
        <div className="rounded-2xl border border-line bg-surface/50 px-4 py-4">
          <h3 className="text-[12px] font-semibold text-ink">تعريف كل مؤشر</h3>
          <dl className="mt-2 space-y-2">
            {Object.entries(definitions).map(([key, value]) => (
              <div key={key}>
                <dt className="ltr text-[10.5px] text-muted">{key}</dt>
                <dd className="text-[11px] leading-6 text-muted">{value}</dd>
              </div>
            ))}
          </dl>
        </div>

        <div className="space-y-3">
          <div className="rounded-2xl border border-amber/25 bg-amber/5 px-4 py-4">
            <h3 className="text-[12px] font-semibold text-ink">ما لا يمكن قياسه من هذه البيانات</h3>
            <ul className="mt-2 space-y-2">
              {unavailableByDesign.map((item) => (
                <li key={item.metric} className="text-[11px] leading-6 text-muted">
                  <span className="ltr text-[10.5px]">{item.metric}</span>
                  <span className="mx-1">—</span>
                  {item.explanation}
                </li>
              ))}
            </ul>
          </div>

          <div className="rounded-2xl border border-line bg-surface/50 px-4 py-4">
            <h3 className="text-[12px] font-semibold text-ink">الحدود المستخدمة</h3>
            <dl className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1.5">
              {Object.entries(thresholds)
                .filter(([, value]) => typeof value === "number")
                .map(([key, value]) => (
                  <div key={key} className="flex items-baseline justify-between gap-2">
                    <dt className="text-[10.5px] text-muted">{thresholdLabels[key] ?? key}</dt>
                    <dd className="ltr text-[11px] text-ink">{String(value)}</dd>
                  </div>
                ))}
            </dl>
            <p className="mt-2 text-[10px] leading-5 text-muted">
              قيم تحريرية معلنة، لا إحصاءات مدربة — أي متجرين بنفس المخزون يحصلان على نفس الحكم.
            </p>
          </div>
        </div>
      </div>
    </section>
  );
}
