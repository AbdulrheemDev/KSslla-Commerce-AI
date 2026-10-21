import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { StatusPill } from "@/components/status-pill";
import { getDb } from "@/db/client";
import { isAppError } from "@/lib/errors";
import { requireStoreAccess } from "@/modules/stores/application/store-service";
import { requirePageTenant } from "@/server/pages";

export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "إعدادات المتجر" };

export default async function StoreSettingsPage({
  params,
}: {
  params: Promise<{ storeId: string }>;
}) {
  const { storeId } = await params;
  const { context } = await requirePageTenant();

  let store;
  try {
    store = await requireStoreAccess(getDb(), context, storeId);
  } catch (error) {
    if (isAppError(error) && error.httpStatus === 404) notFound();
    throw error;
  }

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
          سجل داخلي مستقل عن أي مزوّد. المعرّف الداخلي هو المرجع الوحيد.
        </p>
      </section>

      <section className="grid gap-4 sm:grid-cols-2">
        <div className="rounded-2xl border border-line bg-surface/70 p-5">
          <p className="text-[11px] tracking-[0.15em] text-muted">المنصة</p>
          <p className="ltr mt-2 text-sm font-semibold text-ink">{store.platform}</p>
        </div>

        <div className="rounded-2xl border border-line bg-surface/70 p-5">
          <p className="text-[11px] tracking-[0.15em] text-muted">حالة الاتصال</p>
          <div className="mt-2">
            <StatusPill tone="amber">
              <span className="ltr">Not Connected</span>
            </StatusPill>
          </div>
        </div>

        <div className="rounded-2xl border border-line bg-surface/70 p-5 sm:col-span-2">
          <p className="text-[11px] tracking-[0.15em] text-muted">معرّف المتجر الداخلي</p>
          <p className="ltr mt-2 break-all text-[12px] text-muted">{store.id}</p>
        </div>
      </section>

      <section className="rounded-3xl border border-gold/20 bg-gold/[0.06] p-6">
        <h2 className="text-sm font-semibold text-gold-soft">ربط Salla</h2>
        <p className="mt-2 text-[12.5px] leading-7 text-muted">
          التفويض الرسمي عبر <span className="ltr">OAuth</span> وتخزين الرموز المشفّرة يُنفَّذ في
          المرحلة 03. لا يوجد هنا زر اتصال فعّال، ولا تُرسَل أي بيانات إلى{" "}
          <span className="ltr">Salla</span>.
        </p>
        <button
          type="button"
          disabled
          className="mt-4 cursor-not-allowed rounded-xl border border-line bg-surface-2 px-4 py-2.5 text-[12.5px] text-muted"
        >
          ربط المتجر — متاح في المرحلة 03
        </button>
      </section>
    </div>
  );
}
