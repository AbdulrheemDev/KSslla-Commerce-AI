import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import {
  MetricTile,
  formatDateTime,
  formatMoney,
  formatNumber,
  reasonLabel,
} from "@/components/app/intelligence/panels";
import {
  AlertList,
  AnomalySection,
  ConfidenceBanner,
  DiscountPanel,
  LeakagePanel,
  SeasonalityPanel,
  TrendChart,
  TrendTable,
} from "@/components/app/sales-intelligence/panels";
import { getDb } from "@/db/client";
import { isAppError } from "@/lib/errors";
import { requireStoreAccess } from "@/modules/stores/application/store-service";
import {
  SALES_DEFINITIONS,
  getSalesDashboard,
} from "@/modules/sales-intelligence/application/sales-intelligence-service";
import { requirePageTenant } from "@/server/pages";

export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "تحليل المبيعات" };

const PERIODS = [
  { key: "today", label: "اليوم" },
  { key: "7d", label: "7 أيام" },
  { key: "30d", label: "30 يومًا" },
  { key: "90d", label: "90 يومًا" },
] as const;

const GRANULARITIES = [
  { key: "day", label: "يومي" },
  { key: "week", label: "أسبوعي" },
  { key: "month", label: "شهري" },
] as const;

const COVERAGE_LABELS: Record<string, string> = {
  no_orders_stored: "لا توجد طلبات محفوظة بعد",
  history_starts_after_window: "سجل الطلبات يبدأ بعد بداية الفترة المطلوبة",
  orders_sync_incomplete: "آخر مزامنة للطلبات لم تكتمل",
  no_order_dates: "بعض الطلبات بلا تاريخ",
};

export default async function SalesIntelligencePage({
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

  const granularityParam = typeof query.granularity === "string" ? query.granularity : undefined;
  const granularity =
    granularityParam === "week" || granularityParam === "month" ? granularityParam : "day";

  const request = {
    period: typeof query.period === "string" ? query.period : undefined,
    from: typeof query.from === "string" ? query.from : undefined,
    to: typeof query.to === "string" ? query.to : undefined,
  };

  let dashboard;
  try {
    dashboard = await getSalesDashboard(db, context, storeId, request, granularity);
  } catch (error) {
    // A malformed custom range is a request problem: show the default window
    // with a banner instead of an error boundary.
    if (isAppError(error) && error.code === "VALIDATION_FAILED") {
      dashboard = await getSalesDashboard(db, context, storeId, { period: "30d" }, granularity);
    } else {
      throw error;
    }
  }

  const data = dashboard.data;
  const { metrics, confidence, trends, seasonality, anomalies, leakage, discounts, alerts } = data;
  const currency = metrics.currency.value;

  const baseHref = `/app/stores/${storeId}/sales-intelligence`;
  const periodQuery =
    dashboard.period.key === "custom"
      ? `from=${dashboard.period.from.slice(0, 10)}&to=${dashboard.period.to.slice(0, 10)}`
      : `period=${dashboard.period.key}`;

  const periodLink = (key: string) => `${baseHref}?period=${key}&granularity=${granularity}`;
  const granularityLink = (key: string) => `${baseHref}?${periodQuery}&granularity=${key}`;

  const exportHref = (dataset: "summary" | "trends" | "anomalies") =>
    `/api/organizations/current/stores/${storeId}/sales-intelligence/export?${periodQuery}&granularity=${granularity}&dataset=${dataset}`;

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
        <span className="text-ink">تحليل المبيعات</span>
      </nav>

      <section className="space-y-4">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight text-ink">تحليل المبيعات</h1>
            <p className="mt-2 max-w-2xl text-[13px] leading-7 text-muted">
              إيراد وطلبات ومتوسط طلب واتجاهات وموسمية وتسريبات وشذوذ — كلها محسوبة من الطلبات
              المحفوظة، بلا ذكاء اصطناعي وبلا تقديرات. كل قيمة لا يمكن حسابها تظهر كغير متاحة مع
              سببها.
            </p>
          </div>

          <div className="flex flex-col items-end gap-2">
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

            <nav aria-label="تجمع الرسم" className="flex items-center gap-1">
              {GRANULARITIES.map((option) => (
                <Link
                  key={option.key}
                  href={granularityLink(option.key)}
                  aria-current={granularity === option.key ? "true" : undefined}
                  className={
                    granularity === option.key
                      ? "rounded-lg border border-line px-2.5 py-1 text-[11px] font-semibold text-ink"
                      : "rounded-lg px-2.5 py-1 text-[11px] text-muted transition-colors hover:bg-surface-2 hover:text-ink"
                  }
                >
                  {option.label}
                </Link>
              ))}
            </nav>
          </div>
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
            آخر مزامنة ناجحة:{" "}
            <span className="text-ink">{formatDateTime(dashboard.freshness.syncedAt)}</span>
          </span>
          {dashboard.coverage.status !== "complete" ? (
            <span className="rounded-md bg-amber-500/10 px-2 py-0.5 text-[10.5px] text-amber-700">
              تغطية {dashboard.coverage.status === "empty" ? "فارغة" : "جزئية"}
            </span>
          ) : null}
        </div>

        {dashboard.coverage.notes.length > 0 ? (
          <ul className="flex flex-wrap gap-2 text-[10.5px] text-muted">
            {dashboard.coverage.notes.map((note) => (
              <li key={note} className="rounded-md bg-surface-2 px-2 py-1">
                {COVERAGE_LABELS[note] ?? reasonLabel(note) ?? note}
              </li>
            ))}
          </ul>
        ) : null}

        <ConfidenceBanner confidence={confidence} />
      </section>

      <section aria-labelledby="kpis-heading" className="space-y-3">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 id="kpis-heading" className="text-[13.5px] font-semibold text-ink">
            المؤشرات الأساسية
          </h2>
          <p className="text-[10.5px] text-muted">
            العملة: {currency ?? reasonLabel(metrics.currency.reason) ?? "—"} · الإيراد ليس صافيًا
            من الرسوم ولا المرتجعات
          </p>
        </div>

        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <MetricTile
            label="الإيراد المعتمد"
            metric={metrics.recognizedRevenue}
            format="money"
            currency={currency}
            hint="طلبات غير ملغاة وغير مسودّة، بعملة واحدة"
          />
          <MetricTile label="الطلبات" metric={metrics.orders} hint="بلا المسودّة" />
          <MetricTile
            label="متوسط قيمة الطلب"
            metric={metrics.averageOrderValue}
            format="money"
            currency={currency}
            hint="الإيراد ÷ الطلبات المقيمة"
          />
          <MetricTile
            label="نسبة الإلغاء"
            metric={metrics.cancellationRate}
            format="percent"
            hint="ملغاة ÷ الطلبات غير المسودّة"
          />

          <MetricTile
            label="نمو الإيراد"
            metric={metrics.revenueGrowthPercent}
            format="percent"
            hint="مقارنة بالفترة السابقة"
          />
          <MetricTile
            label="نمو الطلبات"
            metric={metrics.ordersGrowthPercent}
            format="percent"
            hint="مقارنة بالفترة السابقة"
          />
          <MetricTile
            label="نمو متوسط الطلب"
            metric={metrics.averageOrderValueGrowthPercent}
            format="percent"
            hint="مقارنة بالفترة السابقة"
          />
          <MetricTile
            label="طلبات مسودّة"
            metric={metrics.draftOrders}
            hint="تُعدّ ولا تدخل في أي مبلغ"
          />

          <MetricTile label="طلبات مكتملة" metric={metrics.completedOrders} />
          <MetricTile label="طلبات ملغاة" metric={metrics.cancelledOrders} />
          <MetricTile label="حالات أخرى" metric={metrics.otherStatusOrders} />
          <MetricTile
            label="طلبات الفترة السابقة"
            metric={metrics.previousOrders}
            hint={`متوسط سابق: ${formatMoney(metrics.previousAverageOrderValue.value, currency)}`}
          />
        </div>

        <p className="text-[10px] leading-5 text-muted">
          الطلبات المسودّة لا تدخل في الإيراد ولا في المتوسط، والملغاة تُحسب في العدد ولا تدخل في
          المال. الطلبات ذات حالات غير معروفة تبقى في العدد وتُعرض منفصلة، ولا تُصنّف مكتملة.
        </p>
      </section>

      <section aria-labelledby="trends-heading" className="space-y-3">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 id="trends-heading" className="text-[13.5px] font-semibold text-ink">
            الاتجاه الزمني
          </h2>
          <p className="text-[10.5px] text-muted">
            {trends.buckets.length} نقطة ·{" "}
            {trends.granularity === "day"
              ? "يومي"
              : trends.granularity === "week"
                ? "أسبوعي"
                : "شهري"}{" "}
            · حدود UTC
          </p>
        </div>

        <div className="grid gap-3 lg:grid-cols-2">
          <TrendChart
            title="الإيراد"
            buckets={trends.buckets}
            previous={trends.previous?.buckets ?? null}
            pick="revenue"
            unit="money"
            currency={currency}
          />
          <TrendChart
            title="الطلبات"
            buckets={trends.buckets}
            previous={trends.previous?.buckets ?? null}
            pick="orders"
            unit="number"
          />
          <TrendChart
            title="متوسط قيمة الطلب"
            buckets={trends.buckets}
            previous={trends.previous?.buckets ?? null}
            pick="averageOrderValue"
            unit="money"
            currency={currency}
          />
          <div className="rounded-2xl border border-line bg-surface/60 p-4">
            <h3 className="text-[12.5px] font-semibold text-ink">الفترة السابقة</h3>
            {trends.previous ? (
              <>
                <p className="mt-1 text-[10.5px] text-muted ltr">
                  {trends.previous.period.from.slice(0, 10)} →{" "}
                  {trends.previous.period.to.slice(0, 10)}
                </p>
                <dl className="mt-3 space-y-1.5 text-[11px]">
                  <div className="flex justify-between gap-3">
                    <dt className="text-muted">الطلبات</dt>
                    <dd className="text-ink">{formatNumber(metrics.previousOrders.value)}</dd>
                  </div>
                  <div className="flex justify-between gap-3">
                    <dt className="text-muted">الإيراد</dt>
                    <dd className="text-ink">
                      {formatMoney(metrics.previousRecognizedRevenue.value, currency)}
                    </dd>
                  </div>
                  <div className="flex justify-between gap-3">
                    <dt className="text-muted">متوسط الطلب</dt>
                    <dd className="text-ink">
                      {formatMoney(metrics.previousAverageOrderValue.value, currency)}
                    </dd>
                  </div>
                </dl>
              </>
            ) : (
              <p className="mt-2 text-[11.5px] leading-6 text-muted">
                لا فترة سابقة مغطاة بالكامل، لذلك لا تُرسم مقارنة ولا تُحسب نسب نمو.
              </p>
            )}
          </div>
        </div>

        <TrendTable buckets={trends.buckets} currency={currency} />
      </section>

      <section aria-labelledby="seasonality-heading" className="space-y-3">
        <h2 id="seasonality-heading" className="text-[13.5px] font-semibold text-ink">
          الموسمية
        </h2>
        <SeasonalityPanel analysis={seasonality} />
      </section>

      <section aria-labelledby="anomalies-heading" className="space-y-3">
        <h2 id="anomalies-heading" className="text-[13.5px] font-semibold text-ink">
          الشذوذ ({anomalies.anomalies.length})
        </h2>
        <AnomalySection report={anomalies} currency={currency} />
      </section>

      <section aria-labelledby="leakage-heading" className="space-y-3">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 id="leakage-heading" className="text-[13.5px] font-semibold text-ink">
            تسرّب المبيعات
          </h2>
          <p className="text-[10.5px] text-muted">إشارات من بيانات الطلبات فقط</p>
        </div>
        <LeakagePanel report={leakage} />
      </section>

      <section aria-labelledby="discounts-heading" className="space-y-3">
        <h2 id="discounts-heading" className="text-[13.5px] font-semibold text-ink">
          الخصومات
        </h2>
        <DiscountPanel analysis={discounts} />
      </section>

      <section aria-labelledby="alerts-heading" className="space-y-3">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 id="alerts-heading" className="text-[13.5px] font-semibold text-ink">
            التنبيهات
          </h2>
          <p className="text-[10.5px] text-muted">استشارية فقط — لا تُنفّذ أي إجراء تلقائي</p>
        </div>
        <AlertList alerts={alerts} />
      </section>

      <section aria-labelledby="export-heading" className="space-y-3">
        <h2 id="export-heading" className="text-[13.5px] font-semibold text-ink">
          التصدير
        </h2>
        <div className="flex flex-wrap gap-2">
          <a
            href={exportHref("summary")}
            className="rounded-lg border border-line bg-surface-2 px-3 py-1.5 text-[11.5px] font-medium text-ink"
          >
            تصدير المؤشرات (CSV)
          </a>
          <a
            href={exportHref("trends")}
            className="rounded-lg border border-line bg-surface-2 px-3 py-1.5 text-[11.5px] font-medium text-ink"
          >
            تصدير الاتجاهات (CSV)
          </a>
          <a
            href={exportHref("anomalies")}
            className="rounded-lg border border-line bg-surface-2 px-3 py-1.5 text-[11.5px] font-medium text-ink"
          >
            تصدير الشذوذ (CSV)
          </a>
        </div>
        <p className="text-[10.5px] leading-5 text-muted">
          الملف يُبنى من نفس لقطة الشاشة: نفس الصلاحيات، ونفس الفترة، ونفس قواعد العملة والتغطية. لا
          يحتوي أي بريد أو هاتف أو اسم عميل. القيم غير المتاحة تُترك فارغة ولا تُكتب صفرًا.
        </p>
      </section>

      <section className="rounded-2xl border border-line bg-surface/40 p-4">
        <h2 className="text-[12px] font-semibold text-ink">كيف تُحسب هذه الأرقام؟</h2>
        <dl className="mt-2 space-y-1.5 text-[10.5px] leading-6 text-muted">
          {Object.entries(SALES_DEFINITIONS).map(([key, value]) => (
            <div key={key} className="flex gap-2">
              <dt className="shrink-0 font-medium text-ink ltr">{key}</dt>
              <dd>{value}</dd>
            </div>
          ))}
        </dl>
        <p className="mt-3 text-[10.5px] leading-6 text-muted">
          النوافذ الزمنية بتوقيت UTC. القيم غير المحسوبة تُعرض «—» مع سببها، ولا تُستبدل بصفر. قيمة
          الطلب هي <span className="ltr">orders.total_amount</span> كما أرجعها Salla، بلا استنتاج
          رسوم أو ضرائب أو مرتجعات.
        </p>
        <p className="mt-1 text-[10.5px] text-muted">
          آخر تحديث للتحليل: {formatDateTime(dashboard.generatedAt)}
        </p>
      </section>
    </div>
  );
}
