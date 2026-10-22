import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import {
  CLASS_LABELS_AR,
  CLASS_TONES,
  CategoryTable,
  HealthPanel,
  InventoryPanel,
  MetricTile,
  OpportunityCard,
  ProductRow,
  formatDateTime,
  formatNumber,
  reasonLabel,
} from "@/components/app/intelligence/panels";
import { getDb } from "@/db/client";
import { isAppError } from "@/lib/errors";
import { getIntelligenceDashboard } from "@/modules/intelligence/application/intelligence-service";
import { requireStoreAccess } from "@/modules/stores/application/store-service";
import { requirePageTenant } from "@/server/pages";

export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "ذكاء المتجر" };

const PERIODS = [
  { key: "today", label: "اليوم" },
  { key: "7d", label: "7 أيام" },
  { key: "30d", label: "30 يومًا" },
  { key: "90d", label: "90 يومًا" },
] as const;

const COVERAGE_LABELS: Record<string, string> = {
  no_orders_stored: "لا توجد طلبات محفوظة بعد",
  history_starts_after_window: "سجل الطلبات يبدأ بعد بداية الفترة المطلوبة",
  orders_sync_incomplete: "آخر مزامنة للطلبات لم تكتمل",
  no_order_dates: "بعض الطلبات بلا تاريخ",
};

export default async function IntelligencePage({
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

  const periodParam = typeof query.period === "string" ? query.period : undefined;

  let dashboard;
  try {
    dashboard = await getIntelligenceDashboard(db, context, storeId, {
      period: periodParam,
      from: typeof query.from === "string" ? query.from : undefined,
      to: typeof query.to === "string" ? query.to : undefined,
    });
  } catch (error) {
    // Invalid custom ranges are a request problem, not a crash: show the page
    // with an explanatory banner instead of an error boundary.
    if (isAppError(error) && error.code === "VALIDATION_FAILED") {
      dashboard = await getIntelligenceDashboard(db, context, storeId, { period: "30d" });
    } else {
      throw error;
    }
  }

  const data = dashboard.data;
  const { sales, health, customers } = data.overview;
  const coverage = dashboard.coverage;
  const freshness = dashboard.freshness;
  const stale = freshness.staleResources;

  const baseHref = `/app/stores/${storeId}/intelligence`;
  const periodLink = (key: string) => `${baseHref}?period=${key}`;

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
        <span className="text-ink">ذكاء المتجر</span>
      </nav>

      <section className="space-y-4">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight text-ink">ذكاء المتجر</h1>
            <p className="mt-2 max-w-2xl text-[13px] leading-7 text-muted">
              تحليل حتمي لبيانات Salla المحفوظة. كل رقم هنا محسوب من قاعدة البيانات، وكل قيمة لا
              يمكن حسابها تظهر كغير متاحة مع سببها — لا أرقام تقديرية.
            </p>
          </div>

          <nav aria-label="الفترة الزمنية" className="flex flex-wrap items-center gap-1">
            {PERIODS.map((period) => (
              <Link
                key={period.key}
                href={periodLink(period.key)}
                aria-current={dashboard.period.key === period.key ? "page" : undefined}
                className={
                  dashboard.period.key === period.key
                    ? "rounded-lg bg-surface-2 px-3 py-1.5 text-[12px] font-semibold text-ink"
                    : "rounded-lg px-3 py-1.5 text-[12px] text-muted transition-colors hover:bg-surface-2 hover:text-ink"
                }
              >
                {period.label}
              </Link>
            ))}
          </nav>
        </div>

        <div className="flex flex-wrap items-center gap-2 rounded-2xl border border-line bg-surface/50 px-4 py-3 text-[11px] text-muted">
          <span>
            الفترة: <span className="text-ink">{dashboard.period.days}</span> يومًا
          </span>
          <span aria-hidden="true">·</span>
          <span className="ltr">
            {dashboard.period.from.slice(0, 10)} → {dashboard.period.to.slice(0, 10)}
          </span>
          <span aria-hidden="true">·</span>
          <span>
            آخر مزامنة ناجحة: <span className="text-ink">{formatDateTime(freshness.syncedAt)}</span>
          </span>
          {coverage.status !== "complete" ? (
            <span className="rounded-md bg-amber-500/10 px-2 py-0.5 text-[10.5px] text-amber-700">
              تغطية {coverage.status === "empty" ? "فارغة" : "جزئية"}
            </span>
          ) : null}
        </div>

        {coverage.notes.length > 0 ? (
          <ul className="flex flex-wrap gap-2 text-[10.5px] text-muted">
            {coverage.notes.map((note) => (
              <li key={note} className="rounded-md bg-surface-2 px-2 py-1">
                {COVERAGE_LABELS[note] ?? note}
              </li>
            ))}
          </ul>
        ) : null}

        {stale.length > 0 ? (
          <p className="rounded-xl border border-amber-500/25 bg-amber-500/5 px-3 py-2 text-[11.5px] text-amber-800">
            موارد متأخرة: {stale.join(" · ")} — شغّل «مزامنة الآن» قبل الاعتماد على الأرقام.
          </p>
        ) : null}
      </section>

      <section aria-labelledby="overview-heading" className="space-y-3">
        <h2 id="overview-heading" className="text-[13.5px] font-semibold text-ink">
          نظرة عامة
        </h2>

        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <MetricTile label="الطلبات" metric={sales.orders} />
          <MetricTile label="طلبات مكتملة" metric={sales.completedOrders} />
          <MetricTile label="طلبات ملغاة" metric={sales.cancelledOrders} />
          <MetricTile label="طلبات بحالات أخرى" metric={sales.otherStatusOrders} />
          <MetricTile
            label="قيمة الطلبات"
            metric={sales.totalOrderValue}
            format="money"
            currency={sales.currency.value}
          />
          <MetricTile
            label="متوسط قيمة الطلب"
            metric={sales.averageOrderValue}
            format="money"
            currency={sales.currency.value}
          />
          <MetricTile label="نمو عدد الطلبات" metric={sales.ordersGrowthPercent} format="percent" />
          <MetricTile label="نمو قيمة الطلبات" metric={sales.valueGrowthPercent} format="percent" />
        </div>

        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <MetricTile
            label="المنتجات"
            metric={{
              value: data.overview.products.total,
              availability: "available",
              basis: "count(products)",
              reason: null,
            }}
            hint={`${data.overview.products.inStock} متوفر · ${data.overview.products.outOfStock} نفد`}
          />
          <MetricTile
            label="منتجات بلا مبيعات"
            metric={{
              value: data.overview.products.unsold,
              availability: "available",
              basis: "count(products where sold_quantity = 0)",
              reason: null,
            }}
            hint="وفق القيمة التراكمية من Salla"
          />
          <MetricTile
            label="العملاء"
            metric={customers.customers}
            hint={`${formatNumber(customers.returningCustomers.value)} عميلًا مكرّرًا`}
          />
          <MetricTile
            label="معدل تكرار الشراء"
            metric={customers.repeatPurchaseRate}
            format="percent"
          />
        </div>

        <p className="text-[10.5px] leading-6 text-muted">
          الإيراد لكل منتج غير متاح: بنود الطلب في <span className="ltr">List Orders</span> تحمل
          الاسم والكمية والصورة فقط، بلا معرّف منتج ولا سعر بند. لذلك لا يُنسب أي مال إلى منتج.
        </p>
      </section>

      <section aria-labelledby="health-heading">
        <h2 id="health-heading" className="sr-only">
          صحة المتجر
        </h2>
        <HealthPanel health={health} />
      </section>

      <section aria-labelledby="opportunities-heading" className="space-y-3">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 id="opportunities-heading" className="text-[13.5px] font-semibold text-ink">
            الفرص ({data.opportunities.total})
          </h2>
          <p className="text-[10.5px] text-muted">قواعد حتمية بعتبات موثّقة — بلا ذكاء اصطناعي.</p>
        </div>

        {data.opportunities.items.length === 0 ? (
          <p className="rounded-2xl border border-dashed border-line px-4 py-6 text-center text-[12px] text-muted">
            لا توجد فرص حالية ضمن القواعد المعرّفة. يظهر هذا عندما تكون المخزونات والمبيعات داخل
            الحدود، أو عندما لا توجد بيانات كافية بعد.
          </p>
        ) : (
          <div className="grid gap-3 lg:grid-cols-2">
            {data.opportunities.items.slice(0, 8).map((item) => (
              <OpportunityCard key={item.id} item={item} />
            ))}
          </div>
        )}
      </section>

      <section aria-labelledby="products-heading" className="space-y-3">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 id="products-heading" className="text-[13.5px] font-semibold text-ink">
            المنتجات
          </h2>
          <div className="flex flex-wrap gap-2 text-[10.5px]">
            {(Object.keys(CLASS_LABELS_AR) as Array<keyof typeof CLASS_LABELS_AR>).map((key) => (
              <span key={key} className={`rounded-md px-2 py-0.5 ${CLASS_TONES[key]}`}>
                {CLASS_LABELS_AR[key]} {data.productSummary.byClass[key]}
              </span>
            ))}
          </div>
        </div>

        {data.products.length === 0 ? (
          <p className="rounded-2xl border border-dashed border-line px-4 py-6 text-center text-[12px] text-muted">
            لا توجد منتجات محفوظة بعد. شغّل مزامنة المنتجات أولًا.
          </p>
        ) : (
          <div className="overflow-x-auto rounded-2xl border border-line">
            <table className="w-full min-w-[640px] text-start">
              <thead className="bg-surface-2/60 text-[10.5px] text-muted">
                <tr>
                  <th className="px-3 py-2 text-start font-medium">المنتج</th>
                  <th className="px-3 py-2 text-start font-medium">التصنيف</th>
                  <th className="px-3 py-2 text-start font-medium">المخزون</th>
                  <th className="px-3 py-2 text-start font-medium">مبيعات تراكمية</th>
                  <th className="px-3 py-2 text-start font-medium">السعر</th>
                </tr>
              </thead>
              <tbody>
                {data.products.slice(0, 20).map((product) => (
                  <ProductRow key={product.productId} product={product} />
                ))}
              </tbody>
            </table>
            {data.productTotal > 20 ? (
              <p className="border-t border-line/60 px-3 py-2 text-[10.5px] text-muted">
                تُعرض 20 من {data.productTotal} منتجًا، مرتبة بالأولوية (خطر المخزون ثم الأكثر
                مبيعًا).
              </p>
            ) : null}
          </div>
        )}

        <div className="grid gap-3 sm:grid-cols-2">
          <div className="rounded-2xl border border-line bg-surface/60 p-4">
            <h3 className="text-[12px] font-semibold text-ink">الأكثر مبيعًا (تراكمي)</h3>
            {data.rankings.top.length === 0 ? (
              <p className="mt-2 text-[11px] text-muted">
                لا توجد قيمة <span className="ltr">sold_quantity</span> بعد — زامن المخزون.
              </p>
            ) : (
              <ol className="mt-2 space-y-1.5">
                {data.rankings.top.slice(0, 5).map((item) => (
                  <li
                    key={item.productId}
                    className="flex items-baseline justify-between gap-2 text-[11.5px]"
                  >
                    <span className="truncate text-ink">{item.name}</span>
                    <span className="ltr text-muted">{item.unitsSold}</span>
                  </li>
                ))}
              </ol>
            )}
          </div>

          <div className="rounded-2xl border border-line bg-surface/60 p-4">
            <h3 className="text-[12px] font-semibold text-ink">الأقل مبيعًا (تراكمي)</h3>
            {data.rankings.bottom.length === 0 ? (
              <p className="mt-2 text-[11px] text-muted">لا توجد بيانات كافية للترتيب.</p>
            ) : (
              <ol className="mt-2 space-y-1.5">
                {data.rankings.bottom.slice(0, 5).map((item) => (
                  <li
                    key={item.productId}
                    className="flex items-baseline justify-between gap-2 text-[11.5px]"
                  >
                    <span className="truncate text-ink">{item.name}</span>
                    <span className="ltr text-muted">{item.unitsSold}</span>
                  </li>
                ))}
              </ol>
            )}
          </div>
        </div>
      </section>

      <section aria-labelledby="inventory-heading" className="space-y-3">
        <h2 id="inventory-heading" className="text-[13.5px] font-semibold text-ink">
          المخزون
        </h2>
        <InventoryPanel inventory={data.inventory} />
      </section>

      <section aria-labelledby="categories-heading" className="space-y-3">
        <h2 id="categories-heading" className="text-[13.5px] font-semibold text-ink">
          الفئات
        </h2>
        <CategoryTable categories={data.categories} />
        <p className="text-[10.5px] leading-6 text-muted">
          المنتج قد يظهر في أكثر من فئة، لذلك مجموع الوحدات على مستوى الفئات قد يتجاوز إجمالي
          المتجر. الإيراد لكل فئة غير متاح لنفس سبب عدم توفّر إيراد المنتج.
        </p>
      </section>

      <section className="rounded-2xl border border-line bg-surface/40 p-4">
        <h2 className="text-[12px] font-semibold text-ink">كيف تُحسب هذه الأرقام؟</h2>
        <dl className="mt-2 space-y-1.5 text-[10.5px] leading-6 text-muted">
          {Object.entries(data.overview.definitions).map(([key, value]) => (
            <div key={key} className="flex gap-2">
              <dt className="shrink-0 font-medium text-ink">{key}</dt>
              <dd>{value}</dd>
            </div>
          ))}
        </dl>
        <p className="mt-3 text-[10.5px] leading-6 text-muted">
          النوافذ الزمنية بتوقيت UTC. القيم غير المحسوبة تُعرض{" "}
          <span className="font-semibold">—</span> مع سببها، ولا تُستبدل بصفر.
        </p>
        <p className="mt-1 text-[10.5px] text-muted">
          العملة: {sales.currency.value ?? reasonLabel(sales.currency.reason) ?? "—"} · آخر تحديث
          للتحليل: {formatDateTime(dashboard.generatedAt)}
        </p>
      </section>
    </div>
  );
}
