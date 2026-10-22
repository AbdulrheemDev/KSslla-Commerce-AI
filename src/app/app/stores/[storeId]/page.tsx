import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { CommerceDataCard } from "@/components/app/commerce-data-card";
import { SallaConnectionCard } from "@/components/app/salla-connection-card";
import { SimulatorNotice } from "@/components/app/simulator-notice";
import { StatusPill } from "@/components/status-pill";
import { getDb } from "@/db/client";
import { getCommerceOverview } from "@/modules/catalog/application/catalog-service";
import { getStoreDataOverview } from "@/modules/sync/application/store-data-sync-service";
import { isAppError } from "@/lib/errors";
import { getStoreConnection } from "@/modules/integrations/salla/application/connection-service";
import { getSallaHealth } from "@/modules/integrations/salla/config";
import { SALLA_REQUIRED_SCOPES } from "@/modules/integrations/salla/domain/scopes";
import { callbackReasonToMessage } from "@/modules/integrations/salla/domain/messages";
import { requireStoreAccess } from "@/modules/stores/application/store-service";
import { requirePageTenant } from "@/server/pages";

export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "إعدادات المتجر" };

export default async function StoreSettingsPage({
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

  const connection = await getStoreConnection(db, context, storeId);
  const overview = await getCommerceOverview(db, context, storeId);
  const dataOverview = await getStoreDataOverview(db, context, storeId);

  const number = new Intl.NumberFormat("ar-SA", { numberingSystem: "latn" });
  // Provider timestamps are stored as wall clock; trimming to the minute keeps
  // the footer honest without inventing an offset.
  const short = (value: string | null): string =>
    value ? `${value.slice(0, 16).replace("T", " ")}` : "—";
  const dataTiles = [
    {
      label: "العملاء",
      value: dataOverview.counts.customers,
      href: `/app/customers?store=${storeId}`,
    },
    { label: "الطلبات", value: dataOverview.counts.orders, href: `/app/orders?store=${storeId}` },
    {
      label: "بنود الطلبات",
      value: dataOverview.counts.orderItems,
      href: `/app/orders?store=${storeId}`,
    },
    {
      label: "أصناف المخزون",
      value: dataOverview.counts.inventory,
      href: `/app/inventory?store=${storeId}`,
    },
  ];

  const salla = (() => {
    try {
      return getSallaHealth();
    } catch {
      return { configured: false, oauthMode: "custom" as const, implemented: false };
    }
  })();

  const sallaState: "ready" | "easy_mode_pending" | "not_configured" = !salla.configured
    ? "not_configured"
    : salla.implemented
      ? "ready"
      : "easy_mode_pending";

  const justConnected = query.connected === "1";
  const rawError = typeof query.salla_error === "string" ? query.salla_error : null;
  const errorMessage = rawError ? callbackReasonToMessage(rawError) : null;

  const canConnect = context.permissions.includes("store:connect");
  const canDisconnect = context.permissions.includes("store:disconnect");
  const missingScopes = SALLA_REQUIRED_SCOPES.filter((scope) => !connection.scopes.includes(scope));

  return (
    <div className="space-y-8">
      <nav aria-label="مسار التنقل" className="text-[11.5px] text-muted">
        <Link href="/app/stores" className="hover:text-ink">
          المتاجر
        </Link>
        <span aria-hidden="true" className="mx-2">
          /
        </span>
        <span className="text-ink">{store.name}</span>
      </nav>

      <section>
        <h1 className="text-2xl font-semibold tracking-tight text-ink">{store.name}</h1>
        <p className="mt-2 text-[13px] leading-7 text-muted">
          سجل داخلي مستقل. معرّف المتجر الداخلي هو المرجع الوحيد، وبيانات Salla تُحفظ في سجل اتصال
          منفصل.
        </p>
      </section>

      {justConnected ? (
        <div
          role="status"
          className="rounded-2xl border border-teal/25 bg-teal/10 px-4 py-3 text-[12.5px] leading-6 text-teal"
        >
          تم ربط المتجر بنجاح. الحالة الآن <span className="ltr">connected</span>. يمكنك الآن تشغيل
          «مزامنة الآن» لجلب المنتجات والتصنيفات إلى نسخة محلية للقراءة فقط.
        </div>
      ) : null}

      {errorMessage ? (
        <div
          role="alert"
          className="rounded-2xl border border-rose/25 bg-rose/10 px-4 py-3 text-[12.5px] leading-6 text-rose"
        >
          {errorMessage}
        </div>
      ) : null}

      <section className="grid gap-4 sm:grid-cols-2">
        <div className="rounded-2xl border border-line bg-surface/70 p-5">
          <p className="text-[11px] tracking-[0.15em] text-muted">المنصة</p>
          <p className="ltr mt-2 text-sm font-semibold text-ink">{store.platform}</p>
        </div>

        <div className="rounded-2xl border border-line bg-surface/70 p-5">
          <p className="text-[11px] tracking-[0.15em] text-muted">حالة المتجر الداخلي</p>
          <div className="mt-2">
            <StatusPill tone={store.status === "connected" ? "teal" : "amber"}>
              <span className="ltr">{store.status}</span>
            </StatusPill>
          </div>
        </div>

        <div className="rounded-2xl border border-line bg-surface/70 p-5 sm:col-span-2">
          <p className="text-[11px] tracking-[0.15em] text-muted">معرّف المتجر الداخلي</p>
          <p className="ltr mt-2 break-all text-[12px] text-muted">{store.id}</p>
        </div>
      </section>

      <Link
        href={`/app/stores/${store.id}/intelligence`}
        className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-teal/25 bg-teal/5 px-5 py-4 transition hover:border-teal/50"
      >
        <span>
          <span className="block text-sm font-semibold text-ink">ذكاء المتجر</span>
          <span className="mt-1 block text-[11.5px] leading-6 text-muted">
            مؤشرات وتحليلات وفرص محسوبة من البيانات المحفوظة — مع توضيح ما لا تتوفر بياناته.
          </span>
        </span>
        <span className="text-[11.5px] font-medium text-teal">فتح التحليل ←</span>
      </Link>

      <Link
        href={`/app/stores/${store.id}/sales-intelligence`}
        className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-line bg-surface/50 px-5 py-4 transition hover:border-teal/40"
      >
        <span>
          <span className="block text-sm font-semibold text-ink">تحليل المبيعات</span>
          <span className="mt-1 block text-[11.5px] leading-6 text-muted">
            إيراد وطلبات ومتوسط طلب واتجاهات وموسمية وشذوذ وتسرّب — مع تصدير CSV وتوضيح كل قيمة غير
            متاحة.
          </span>
        </span>
        <span className="text-[11.5px] font-medium text-teal">فتح التحليل ←</span>
      </Link>

      <Link
        href={`/app/stores/${store.id}/product-intelligence`}
        className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-line bg-surface/50 px-5 py-4 transition hover:border-teal/40"
      >
        <span>
          <span className="block text-sm font-semibold text-ink">ذكاء المنتجات</span>
          <span className="mt-1 block text-[11.5px] leading-6 text-muted">
            صحة الكتالوج: جودة المحتوى، البيانات الوصفية، الصور، دورة الحياة، والتصنيفات — بمشكلات
            مرتّبة وتوصيات قواعدية موثّقة الأدلة.
          </span>
        </span>
        <span className="text-[11.5px] font-medium text-teal">فتح التحليل ←</span>
      </Link>

      <Link
        href={`/app/stores/${store.id}/inventory-intelligence`}
        className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-line bg-surface/50 px-5 py-4 transition hover:border-teal/40"
      >
        <span>
          <span className="block text-sm font-semibold text-ink">ذكاء المخزون</span>
          <span className="mt-1 block text-[11.5px] leading-6 text-muted">
            تغطية المخزون وحالات الكمية والمخاطر المرتّبة وتوصيات استشارية — مع توضيح ما لا يمكن
            حسابه من البيانات الحالية.
          </span>
        </span>
        <span className="text-[11.5px] font-medium text-teal">فتح التحليل ←</span>
      </Link>

      <SimulatorNotice />

      <SallaConnectionCard
        storeId={store.id}
        connection={connection}
        canConnect={canConnect}
        canDisconnect={canDisconnect}
        sallaState={sallaState}
        initialError={null}
      />

      <CommerceDataCard
        storeId={store.id}
        overview={overview}
        canSync={context.permissions.includes("store:sync")}
        connected={connection.status === "connected"}
        missingScopes={missingScopes}
      />

      <section className="rounded-2xl border border-line bg-surface/70 p-5">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="text-sm font-semibold text-ink">بيانات التجارة المحلية</h2>
          <p className="text-[11.5px] text-muted">
            أرقام من PostgreSQL فقط — لا تقديرات ولا بيانات وهمية.
          </p>
        </div>

        <dl className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
          {dataTiles.map((tile) => (
            <Link
              key={tile.label}
              href={tile.href}
              className="rounded-xl border border-line/70 bg-surface px-3 py-3 transition hover:border-teal/40"
            >
              <dt className="text-[11px] text-muted">{tile.label}</dt>
              <dd className="mt-1 text-lg font-semibold text-ink">{number.format(tile.value)}</dd>
            </Link>
          ))}
        </dl>

        <p className="mt-3 text-[11.5px] leading-6 text-muted">
          آخر طلب: {short(dataOverview.orders.lastOrderAt)} · مسودات:{" "}
          {number.format(dataOverview.orders.drafts)} · بانتظار الدفع:{" "}
          {number.format(dataOverview.orders.pendingPayment)} · آخر مزامنة مخزون:{" "}
          {short(dataOverview.inventory.lastSyncedAt)}
        </p>
      </section>

      <section className="rounded-2xl border border-line bg-surface/40 p-5">
        <h2 className="text-sm font-semibold text-ink">حدود هذه المرحلة</h2>
        <ul className="mt-2 grid list-inside list-disc gap-1 text-[12px] leading-6 text-muted">
          <li>مزامنة للقراءة فقط: المنتجات، التصنيفات، العملاء، الطلبات، وكميات المخزون.</li>
          <li>لا إنشاء أو تعديل أو حذف لأي عنصر في Salla.</li>
          <li>لا Webhooks، ولا تحليلات أو تسويق أو ذكاء اصطناعي، ولا توقعات مخزون.</li>
          <li>
            بنود الطلبات تُحفظ بلا معرّف منتج لأن واجهة Salla الموثّقة لا توفّره في قائمة الطلبات.
          </li>
        </ul>
      </section>
    </div>
  );
}
