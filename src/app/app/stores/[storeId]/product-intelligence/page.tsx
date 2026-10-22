import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { MetricTile, formatDateTime } from "@/components/app/intelligence/panels";
import {
  CategoryHealthTable,
  CoverageBanner,
  IssueTable,
  ProductHealthTable,
  RecommendationCard,
  SeverityBadge,
} from "@/components/app/product-intelligence/panels";
import { getDb } from "@/db/client";
import { isAppError } from "@/lib/errors";
import { catalogQueryFromSearch } from "@/modules/product-intelligence/application/query";
import { getProductDashboard } from "@/modules/product-intelligence/application/product-intelligence-service";
import { PRODUCT_THRESHOLDS } from "@/modules/product-intelligence/domain/thresholds";
import { requireStoreAccess } from "@/modules/stores/application/store-service";
import { requirePageTenant } from "@/server/pages";

export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "ذكاء المنتجات" };

const FILTERS = [
  { key: "all", label: "الكل" },
  { key: "attention", label: "تحتاج مراجعة" },
  { key: "clean", label: "سليمة" },
] as const;

/**
 * Product intelligence — a read-only view of the mirrored catalogue.
 *
 * Everything on this page comes from one snapshot computed on the request: no
 * cached numbers, no period selector (the catalogue has no window), no action
 * buttons. What the mirror cannot answer is printed as unavailable with the
 * reason, in Arabic, rather than as a zero.
 */
export default async function ProductIntelligencePage({
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

  const catalogQuery = catalogQueryFromSearch(search);
  const dashboard = await getProductDashboard(db, context, storeId, catalogQuery);
  const data = dashboard.data;

  const baseHref = `/app/stores/${storeId}/product-intelligence`;
  const filterHref = (filter: string) => {
    const next = new URLSearchParams();
    if (catalogQuery.query) next.set("q", catalogQuery.query);
    if (filter !== "all") next.set("filter", filter);
    const qs = next.toString();
    return qs ? `${baseHref}?${qs}` : baseHref;
  };

  const pageHref = (page: number) => {
    const next = new URLSearchParams();
    if (catalogQuery.query) next.set("q", catalogQuery.query);
    if (catalogQuery.filter !== "all") next.set("filter", catalogQuery.filter);
    if (page > 1) next.set("page", String(page));
    const qs = next.toString();
    return qs ? `${baseHref}?${qs}` : baseHref;
  };

  const overview = data.overview;

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
        <span className="text-ink">ذكاء المنتجات</span>
      </nav>

      <section>
        <h1 className="text-2xl font-semibold tracking-tight text-ink">ذكاء المنتجات</h1>
        <p className="mt-2 max-w-3xl text-[13px] leading-7 text-muted">
          صحة الكتالوج كما هي محفوظة في النسخة المحلية: جودة المحتوى، البيانات الوصفية، الصور، دورة
          الحياة، والتصنيفات. كل رقم محسوب بقاعدة معلنة، وكل ما لا تتوفر بياناته يظهر «—» مع سببه.
        </p>
      </section>

      <CoverageBanner
        coverage={dashboard.coverage}
        confidence={dashboard.confidence}
        syncedAt={dashboard.freshness.syncedAt}
      />

      <section aria-labelledby="pi-overview">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 id="pi-overview" className="text-sm font-semibold text-ink">
            نظرة عامة
          </h2>
          <p className="text-[11px] text-muted">
            لقطة بتاريخ {formatDateTime(dashboard.generatedAt)}
          </p>
        </div>

        <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <MetricTile label="إجمالي المنتجات" metric={overview.totalProducts} />
          <MetricTile label="تحتاج مراجعة" metric={overview.needsAttention} />
          <MetricTile
            label="متوسط جودة المحتوى"
            metric={overview.averageContentScore}
            hint="من 100 — ليس مؤشر SEO"
          />
          <MetricTile label="تغطية الصور" metric={overview.imageCoveragePercent} format="percent" />
          <MetricTile
            label="صحة البيانات الوصفية"
            metric={overview.metadataHealthPercent}
            format="percent"
          />
          <MetricTile
            label="تغطية التصنيفات"
            metric={overview.categoryCoveragePercent}
            format="percent"
          />
          <MetricTile label="منتجات مخفية" metric={overview.hiddenProducts} />
          <MetricTile
            label={`محتوى أقدم من ${PRODUCT_THRESHOLDS.STALE_CONTENT_DAYS} يومًا`}
            metric={overview.staleProducts}
          />
        </div>

        <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <div className="rounded-2xl border border-line bg-surface/60 px-4 py-3">
            <p className="text-[11px] text-muted">منتجات سليمة</p>
            <p className="ltr mt-1 text-lg font-semibold text-ink">{data.counts.clean}</p>
            <p className="mt-1 text-[10.5px] leading-5 text-muted">بلا مشكلة عالية أو متوسطة</p>
          </div>
          <MetricTile label="بلا تصنيف" metric={overview.uncategorized} />
          <MetricTile label="نافدة" metric={overview.outOfStock} />
          <div className="rounded-2xl border border-line bg-surface/60 px-4 py-3">
            <p className="text-[11px] text-muted">إجمالي المشكلات</p>
            <p className="ltr mt-1 text-lg font-semibold text-ink">{data.counts.issueCount}</p>
            <p className="mt-1 text-[10.5px] leading-5 text-muted">
              مجموع المشكلات على كل المنتجات
            </p>
          </div>
        </div>
      </section>

      <section aria-labelledby="pi-products">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 id="pi-products" className="text-sm font-semibold text-ink">
            المنتجات
          </h2>
          <p className="text-[11px] text-muted">
            مرتّبة من الأسوأ إلى الأفضل — المنتجات المطابقة: {data.products.total}
          </p>
        </div>

        <form action={baseHref} method="get" className="mt-3 flex flex-wrap items-end gap-2">
          <label className="flex flex-col gap-1 text-[11px] text-muted">
            بحث بالاسم أو SKU
            <input
              type="search"
              name="q"
              defaultValue={catalogQuery.query}
              className="w-56 rounded-xl border border-line bg-surface px-3 py-2 text-[12px] text-ink outline-none focus:border-teal/50"
            />
          </label>
          <input type="hidden" name="filter" value={catalogQuery.filter} />
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
                catalogQuery.filter === filter.key
                  ? "border-teal/40 bg-teal/10 text-teal"
                  : "border-line bg-surface/60 text-muted hover:border-teal/30"
              }`}
            >
              {filter.label}
            </Link>
          ))}
        </div>

        <div className="mt-3">
          <ProductHealthTable items={data.products.items} />
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

      <section aria-labelledby="pi-issues">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 id="pi-issues" className="text-sm font-semibold text-ink">
            المشكلات مرتّبة
          </h2>
          <p className="text-[11px] text-muted">
            الدرجة = عدد المنتجات المتأثرة × وزن الخطورة (عالية 3، متوسطة 2، منخفضة 1)
          </p>
        </div>
        <div className="mt-3 rounded-2xl border border-line bg-surface/40 p-4">
          <IssueTable items={data.issues} />
        </div>
      </section>

      <section aria-labelledby="pi-categories">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 id="pi-categories" className="text-sm font-semibold text-ink">
            صحة التصنيفات
          </h2>
          <p className="text-[11px] text-muted">
            صحة كتالوج لا أداء مبيعات: لا يوجد ربط موثوق بين بنود الطلب والمنتجات
          </p>
        </div>
        <div className="mt-3 rounded-2xl border border-line bg-surface/40 p-4">
          <CategoryHealthTable items={data.categories} />
        </div>
      </section>

      <section aria-labelledby="pi-recommendations">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 id="pi-recommendations" className="text-sm font-semibold text-ink">
            التوصيات
          </h2>
          <p className="text-[11px] text-muted">
            قواعد حتمية على بيانات محفوظة — بلا ذكاء اصطناعي وبلا تنفيذ
          </p>
        </div>
        <div className="mt-3 grid gap-3 md:grid-cols-2">
          {data.recommendations.length === 0 ? (
            <p className="rounded-2xl border border-line bg-surface/60 px-4 py-4 text-[12px] text-muted">
              لا توصيات: لا توجد مشكلة واحدة مطابقة لقواعد المرحلة.
            </p>
          ) : (
            data.recommendations.map((item) => <RecommendationCard key={item.id} item={item} />)
          )}
        </div>
      </section>

      <section aria-labelledby="pi-definitions">
        <h2 id="pi-definitions" className="text-sm font-semibold text-ink">
          تعريفات وحدود
        </h2>

        <div className="mt-3 grid gap-3 md:grid-cols-2">
          <div className="rounded-2xl border border-line bg-surface/50 px-4 py-4">
            <h3 className="text-[12px] font-semibold text-ink">ماذا يقيس كل مؤشر</h3>
            <dl className="mt-2 space-y-2">
              {Object.entries(data.definitions).map(([key, value]) => (
                <div key={key}>
                  <dt className="ltr text-[10.5px] text-muted">{key}</dt>
                  <dd className="text-[11px] leading-6 text-muted">{value}</dd>
                </div>
              ))}
            </dl>
          </div>

          <div className="rounded-2xl border border-amber/25 bg-amber/5 px-4 py-4">
            <h3 className="text-[12px] font-semibold text-ink">ما لا يمكن قياسه من هذه البيانات</h3>
            <ul className="mt-2 space-y-2">
              {data.unavailableByDesign.map((item) => (
                <li key={item.metric} className="text-[11px] leading-6 text-muted">
                  <span className="ltr text-[10.5px]">{item.metric}</span>
                  <span className="mx-1">—</span>
                  {item.explanation}
                </li>
              ))}
            </ul>

            <p className="mt-3 text-[11px] leading-6 text-muted">
              الكمية المبيعة التراكمية من المزوّد تُعرض كما هي ولا تُحوَّل إلى مبيعات فترة. الكتالوج
              لا يحتوي منتجات كشخة الحقيقية، وكل الأرقام أعلاه من النسخة المحلية.
            </p>
            <div className="mt-2 flex items-center gap-1.5">
              <SeverityBadge severity={null} />
              <span className="text-[10.5px] text-muted">يعني: لا مشكلة عالية أو متوسطة</span>
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}
