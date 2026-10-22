import type { Metadata } from "next";
import Link from "next/link";

import { CreateStoreForm } from "@/components/app/create-store-form";
import { StatusPill } from "@/components/status-pill";
import { getDb } from "@/db/client";
import { listStores } from "@/modules/stores/application/store-service";
import { requirePageTenant } from "@/server/pages";

export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "المتاجر" };

export default async function StoresPage() {
  const { context } = await requirePageTenant();
  const stores = await listStores(getDb(), context);

  return (
    <div className="space-y-8">
      <section>
        <h1 className="text-2xl font-semibold tracking-tight text-ink">المتاجر</h1>
        <p className="mt-2 max-w-2xl text-[13px] leading-7 text-muted">
          سجلات داخلية مرتبطة بـ <span className="ltr">Salla</span> عبر تفويض رسمي. تُقرأ المنتجات
          والتصنيفات فقط، ولا تُكتب أي بيانات إلى Salla.
        </p>
      </section>

      {context.permissions.includes("organization:update") ? (
        <section className="rounded-2xl border border-line bg-surface/70 p-5">
          <h2 className="text-sm font-semibold text-ink">إضافة سجل متجر</h2>
          <p className="mt-1 text-[11.5px] leading-6 text-muted">
            اختياري. يبدأ السجل كـ <span className="ltr">not_connected</span> حتى تربطه بتفويض Salla
            من صفحة المتجر.
          </p>
          <div className="mt-4">
            <CreateStoreForm />
          </div>
        </section>
      ) : null}

      <section className="rounded-2xl border border-line bg-surface/70 p-5">
        <div className="flex items-center justify-between gap-3">
          <h2 className="text-sm font-semibold text-ink">السجلات</h2>
          <StatusPill tone="muted">{stores.length}</StatusPill>
        </div>

        {stores.length === 0 ? (
          <p className="mt-3 rounded-xl border border-line/70 bg-canvas/40 px-4 py-3 text-[12px] leading-6 text-muted">
            لا توجد متاجر داخلية بعد.
          </p>
        ) : (
          <ul className="mt-4 space-y-3">
            {stores.map((store) => (
              <li key={store.id}>
                <Link
                  href={`/app/stores/${store.id}`}
                  className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-line/70 bg-canvas/40 px-4 py-3 transition-colors hover:border-line-strong"
                >
                  <div>
                    <p className="text-[13px] font-medium text-ink">{store.name}</p>
                    <p className="ltr text-[11px] text-muted">
                      {store.platform} · {store.status}
                    </p>
                  </div>
                  <StatusPill tone={store.status === "connected" ? "teal" : "amber"}>
                    {store.status === "connected" ? "متصل" : "غير متصل"}
                  </StatusPill>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
