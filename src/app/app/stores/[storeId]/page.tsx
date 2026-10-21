import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { SallaConnectionCard } from "@/components/app/salla-connection-card";
import { StatusPill } from "@/components/status-pill";
import { getDb } from "@/db/client";
import { isAppError } from "@/lib/errors";
import { getStoreConnection } from "@/modules/integrations/salla/application/connection-service";
import { getSallaHealth } from "@/modules/integrations/salla/config";
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
          تم ربط المتجر بنجاح. الحالة الآن <span className="ltr">connected</span>. الخطوة التالية:
          سيُستخدم هذا الاتصال لقراءة البيانات في المراحل القادمة.
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

      <SallaConnectionCard
        storeId={store.id}
        connection={connection}
        canConnect={canConnect}
        canDisconnect={canDisconnect}
        sallaState={sallaState}
        initialError={null}
      />

      <section className="rounded-2xl border border-line bg-surface/40 p-5">
        <h2 className="text-sm font-semibold text-ink">ما لا تفعله هذه المرحلة</h2>
        <ul className="mt-2 grid list-inside list-disc gap-1 text-[12px] leading-6 text-muted">
          <li>لا مزامنة منتجات أو طلبات أو عملاء أو مخزون.</li>
          <li>لا Webhooks عامة، ولا كتابة أي بيانات إلى Salla.</li>
          <li>لا تحليلات أو تسويق أو ذكاء اصطناعي.</li>
        </ul>
      </section>
    </div>
  );
}
