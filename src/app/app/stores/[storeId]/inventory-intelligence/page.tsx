import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { formatDateTime, formatNumber, MetricTile } from "@/components/app/intelligence/panels";
import {
  InventoryCategoryTable,
  InventoryCoverageBanner,
  InventoryIssueTable,
  InventoryMethodology,
  InventoryProductTable,
  InventoryRecommendationCard,
  SeverityBadge,
} from "@/components/app/inventory-intelligence/panels";
import { getDb } from "@/db/client";
import { isAppError } from "@/lib/errors";
import { getInventoryDashboard } from "@/modules/inventory-intelligence/application/inventory-intelligence-service";
import { inventoryQueryFromSearch } from "@/modules/inventory-intelligence/application/query";
import { INVENTORY_THRESHOLDS } from "@/modules/inventory-intelligence/domain/thresholds";
import { requireStoreAccess } from "@/modules/stores/application/store-service";
import { requirePageTenant } from "@/server/pages";

export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "ذكاء المخزون" };

const FILTERS = [
  { key: "all", label: "الكل" },
  { key: "out_of_stock", label: "نافد" },
  { key: "low_stock", label: "منخفض" },
  { key: "in_stock", label: "متوفر" },
  { key: "unlimited", label: "غير محدود" },
  { key: "unknown", label: "بلا سجل" },
  { key: "high_quantity", label: "كمية مرتفعة" },
] as const;

/**
 * Inventory intelligence — a read-only view of the mirrored stock.
 *
 * Every number comes from one snapshot computed on the request: no cache, no
 * period selector (there is no history to select from), no action buttons. The
 * four quantities this source cannot produce — days of stock, stockout
 * prediction, dead stock, reorder quantity — appear as `—` with their reason, in
 * the table and in the methodology block, rather than as an invented figure.
 */
export default async function InventoryIntelligencePage({
  params,
  searchParams,
}: {
  params: Promise<{ storeId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { storeId } = await params;
  const query = await searchParams;
  const { context } = await requirePageTenant();
  const db = getDb();

  let store;
  try {
    store = await requireStoreAccess(db, context, storeId);
  } catch (error) {
    if (isAppError(error) && error.httpStatus === 404) notFound();
    throw error;
  }

  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (typeof value === "string") search.set(key, value);
  }

  const inventoryQuery = inventoryQueryFromSearch(search);
  const dashboard = await getInventoryDashboard(db, context, storeId, inventoryQuery);
  const data = dashboard.data;
  const overview = data.overview;

  const baseHref = `/app/stores/${storeId}/inventory-intelligence`;
  const filterHref = (filter: string) => {
    const next = new URLSearchParams();
    if (inventoryQuery.query) next.set("q", inventoryQuery.query);
    if (filter !== "all") next.set("filter", filter);
    const qs = next.toString();
    return qs ? `${baseHref}?${qs}` : baseHref;
  };

  const pageHref = (page: number) => {
    const next = new URLSearchParams();
    if (inventoryQuery.query) next.set("q", inventoryQuery.query);
    if (inventoryQuery.filter !== "all") next.set("filter", inventoryQuery.filter);
    if (page > 1) next.set("page", String(page));
    const qs = next.toString();
    return qs ? `${baseHref}?${qs}` : baseHref;
  };

  return (
    <div className="space-y-8">
      <nav aria-label="مسار التنقل" className="text-[11.5px] text-muted">
        <Link href="/app/stores" className="hover:text-ink">
          المتاجر
        </Link>
        <span aria-hidden="true" className="mx-2">
          /
        </span>
        <Link href={`/app/stores/${storeId}`} className="hover:text-ink">
          {store.name}
        </Link>
        <span aria-hidden="true" className="mx-2">
          /
        </span>
        <span className="text-ink">ذكاء المخزون</span>
      </nav>

      <section>
        <h1 className="text-2xl font-semibold tracking-tight text-ink">ذكاء المخزون</h1>
        <p className="mt-2 max-w-3xl text-[13px] leading-7 text-muted">
          حالة الرف الآن كما هي محفوظة في النسخة المحلية: التغطية، والكميات، والمنخفض والنافد
          والكمية المرتفعة، مع ترتيب المخاطر وتوصيات استشارية. لا يُكتب مخزون من هذه الشاشة، وكل ما
          لا تتوفر بياناته يظهر «—» مع سببه.
        </p>
      </section>

      <InventoryCoverageBanner
        coverage={dashboard.coverage}
        confidence={dashboard.confidence}
        syncedAt={dashboard.freshness.syncedAt}
      />

      <section aria-labelledby="inv-overview">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 id="inv-overview" className="text-sm font-semibold text-ink">
            نظرة عامة
          </h2>
          <p className="text-[11px] text-muted">
            لقطة بتاريخ {formatDateTime(dashboard.generatedAt)}
          </p>
        </div>

        <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <MetricTile label="إجمالي المنتجات" metric={overview.productsTotal} />
          <MetricTile
            label="تغطية المخزون"
            metric={overview.inventoryCoveragePercent}
            format="percent"
            hint="منتجات لها سجل مخزون ÷ المنتجات"
          />
          <MetricTile label="منتجات متوفرة" metric={overview.inStock} />
          <MetricTile
            label={`منخفض (≤ ${INVENTORY_THRESHOLDS.LOW_STOCK_UNITS})`}
            metric={overview.lowStock}
            hint="حد كمية مطلق — ليس توقع نفاد"
          />
          <MetricTile label="نافد" metric={overview.outOfStock} />
          <MetricTile
            label="كمية غير محدودة"
            metric={overview.unlimited}
            hint="تتقدّم على الرقم: المزوّد قد يعرضها بكمية 0"
          />
          <MetricTile
            label="بلا سجل مخزون"
            metric={overview.unknownStock}
            hint="لا نعرف كميتها — لا تُعدّ نافدة"
          />
          <MetricTile
            label="درجة صحة المخزون"
            metric={overview.healthScore}
            hint="من 100 — وصفية لحالة الرف، ليست توقع مبيعات"
          />
        </div>

        <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <div className="rounded-2xl border border-line bg-surface/60 px-4 py-3">
            <p className="text-[11px] text-muted">إجمالي الوحدات</p>
            <p className="ltr mt-1 text-lg font-semibold text-ink">
              {overview.totalUnits.value === null ? "—" : formatNumber(overview.totalUnits.value)}
            </p>
            <p className="mt-1 text-[10.5px] leading-5 text-muted">
              مجموع كميات السجلات المرتبطة بالمنتجات — لا يضمّ غير المرتبطة
            </p>
          </div>

          <MetricTile
            label={`كمية مرتفعة (≥ ${INVENTORY_THRESHOLDS.HIGH_STOCK_UNITS})`}
            metric={overview.highStockQuantity}
            hint="ملاحظة كمية محايدة — ليست «راكد»"
          />

          <MetricTile
            label="كميات سالبة"
            metric={overview.negativeQuantity}
            hint="تُعرض كما وصلت — تحتاج مراجعة يدوية"
          />

          <div className="rounded-2xl border border-line bg-surface/60 px-4 py-3">
            <p className="text-[11px] text-muted">سجلات مخزون</p>
            <p className="ltr mt-1 text-lg font-semibold text-ink">
              {formatNumber(data.counts.inventoryEntries)}
            </p>
            <p className="mt-1 text-[10.5px] leading-5 text-muted">
              سجل لكل متغيّر — غير مرتبطة:{" "}
              <span className="ltr">{formatNumber(data.counts.unlinkedEntries)}</span>
            </p>
          </div>
        </div>

        <div className="mt-3 grid gap-3 sm:grid-cols-3">
          <MetricTile
            label="الأيام المتبقية (متوسط المتجر)"
            metric={overview.daysOfStock}
            hint="يحتاج معدل طلب لكل منتج — غير متاح"
          />
          <MetricTile
            label="مخزون راكد"
            metric={overview.deadStock}
            hint="يحتاج معدل طلب ومدة مراقبة — غير متاح"
          />
          <MetricTile
            label="كمية إعادة الطلب"
            metric={overview.reorderQuantity}
            hint="يحتاج الطلب ومهلة التوريد ومخزون الأمان"
          />
        </div>
      </section>

      <section aria-labelledby="inv-risks">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 id="inv-risks" className="text-sm font-semibold text-ink">
            المخاطر
          </h2>
          <p className="text-[11px] text-muted">
            الدرجة = عدد المتأثرين × وزن الخطورة (عالية 3، متوسطة 2، منخفضة 1)
          </p>
        </div>

        <div className="mt-3 rounded-2xl border border-line bg-surface/40 p-4">
          <InventoryIssueTable items={data.issues} />
        </div>

        <p className="mt-2 text-[10.5px] leading-5 text-muted">
          لا يصدر تنبؤ بنفاد المخزون: نطاقات الخطر معرّفة (
          {INVENTORY_THRESHOLDS.STOCKOUT_CRITICAL_DAYS}
          {" / "}
          {INVENTORY_THRESHOLDS.STOCKOUT_WARNING_DAYS}
          {" / "}
          {INVENTORY_THRESHOLDS.STOCKOUT_WATCH_DAYS} يومًا) لكنها لا تُفعّل قبل وجود معدل طلب موثّق
          لكل منتج.
        </p>
      </section>

      <section aria-labelledby="inv-products">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 id="inv-products" className="text-sm font-semibold text-ink">
            المنتجات
          </h2>
          <p className="text-[11px] text-muted">
            مرتّبة من الأعلى خطورة إلى الأقل — المطابق: {data.products.total}
          </p>
        </div>

        <form action={baseHref} method="get" className="mt-3 flex flex-wrap items-end gap-2">
          <label className="flex flex-col gap-1 text-[11px] text-muted">
            بحث بالاسم أو SKU
            <input
              type="search"
              name="q"
              defaultValue={inventoryQuery.query}
              className="w-56 rounded-xl border border-line bg-surface px-3 py-2 text-[12px] text-ink outline-none focus:border-teal/50"
            />
          </label>
          <input type="hidden" name="filter" value={inventoryQuery.filter} />
          <button
            type="submit"
            className="rounded-xl border border-line bg-surface-2 px-3 py-2 text-[12px] text-ink transition hover:border-teal/40"
          >
            بحث
          </button>
        </form>

        <div className="mt-2 flex flex-wrap gap-1.5">
          {FILTERS.map((filter) => (
            <Link
              key={filter.key}
              href={filterHref(filter.key)}
              className={`rounded-lg border px-2.5 py-1 text-[11px] transition ${
                inventoryQuery.filter === filter.key
                  ? "border-teal/40 bg-teal/10 text-teal"
                  : "border-line bg-surface/60 text-muted hover:border-teal/30"
              }`}
            >
              {filter.label}
            </Link>
          ))}
        </div>

        <div className="mt-3">
          <InventoryProductTable items={data.products.items} />
        </div>

        {data.products.pageCount > 1 ? (
          <nav aria-label="ترقيم الصفحات" className="mt-3 flex items-center justify-between gap-2">
            <p className="text-[11px] text-muted">
              صفحة {data.products.page} من {data.products.pageCount}
            </p>
            <div className="flex gap-2">
              {data.products.page > 1 ? (
                <Link
                  href={pageHref(data.products.page - 1)}
                  className="rounded-lg border border-line bg-surface px-2.5 py-1 text-[11px] text-ink"
                >
                  السابق
                </Link>
              ) : null}
              {data.products.page < data.products.pageCount ? (
                <Link
                  href={pageHref(data.products.page + 1)}
                  className="rounded-lg border border-line bg-surface px-2.5 py-1 text-[11px] text-ink"
                >
                  التالي
                </Link>
              ) : null}
            </div>
          </nav>
        ) : null}
      </section>

      <section aria-labelledby="inv-categories">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 id="inv-categories" className="text-sm font-semibold text-ink">
            التصنيفات
          </h2>
          <p className="text-[11px] text-muted">
            أعداد المخزون داخل كل تصنيف — ليست مبيعات تصنيف ولا دورانًا
          </p>
        </div>
        <div className="mt-3 rounded-2xl border border-line bg-surface/40 p-4">
          <InventoryCategoryTable items={data.categories} />
        </div>
      </section>

      <section aria-labelledby="inv-recommendations">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 id="inv-recommendations" className="text-sm font-semibold text-ink">
            التوصيات
          </h2>
          <p className="text-[11px] text-muted">
            قواعد حتمية على بيانات محفوظة — استشارية وبلا تنفيذ
          </p>
        </div>

        <div className="mt-3 grid gap-3 md:grid-cols-2">
          {data.topRecommendations.length === 0 ? (
            <p className="rounded-2xl border border-line bg-surface/60 px-4 py-4 text-[12px] text-muted">
              لا توصيات: لا توجد مشكلة واحدة مطابقة لقواعد المرحلة على هذه اللقطة.
            </p>
          ) : (
            data.topRecommendations.map((item) => (
              <InventoryRecommendationCard key={item.id} item={item} />
            ))
          )}
        </div>

        <div className="mt-3 flex items-center gap-1.5">
          <SeverityBadge severity={null} />
          <span className="text-[10.5px] text-muted">يعني: لا مشكلة عالية أو متوسطة</span>
        </div>
      </section>

      <InventoryMethodology
        definitions={data.definitions}
        unavailableByDesign={data.unavailableByDesign}
        thresholds={data.thresholds}
        thresholdLabels={data.thresholdLabels}
      />
    </div>
  );
}
