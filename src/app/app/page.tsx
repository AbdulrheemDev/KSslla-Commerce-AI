import type { Metadata } from "next";
import Link from "next/link";

import { StatusPill } from "@/components/status-pill";
import { getOrganizationOverview } from "@/modules/organizations/application/organization-service";
import { getDb } from "@/db/client";
import { ROLE_LABELS_AR } from "@/modules/identity/domain/permissions";
import { requirePageTenant } from "@/server/pages";

export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "مساحة المؤسسة" };

export default async function OrganizationHomePage() {
  const { context } = await requirePageTenant();
  const overview = await getOrganizationOverview(getDb(), context);

  return (
    <div className="space-y-8">
      <section>
        <p className="text-[11px] tracking-[0.18em] text-muted">مساحة المؤسسة</p>
        <h1 className="mt-2 text-3xl font-semibold tracking-tight text-ink">
          {overview.organization.name}
        </h1>
        <p className="mt-2 text-[13px] leading-7 text-muted">
          دورك: {ROLE_LABELS_AR[context.role]} · المعرّف العام للمؤسسة:{" "}
          <span className="ltr text-muted/80">{overview.organization.slug}</span>
        </p>
      </section>

      <section className="grid gap-4 sm:grid-cols-3">
        <div className="rounded-2xl border border-line bg-surface/70 p-5">
          <p className="text-[11px] tracking-[0.15em] text-muted">الأعضاء</p>
          <p className="mt-2 text-2xl font-semibold text-ink">
            {overview.memberCount === null ? "—" : overview.memberCount}
          </p>
          <p className="mt-1 text-[11px] text-muted">
            {overview.memberCount === null
              ? "لا تملك صلاحية عرض الأعضاء"
              : "أعضاء نشطون في المؤسسة"}
          </p>
        </div>

        <div className="rounded-2xl border border-line bg-surface/70 p-5">
          <p className="text-[11px] tracking-[0.15em] text-muted">المتاجر الداخلية</p>
          <p className="mt-2 text-2xl font-semibold text-ink">{overview.stores.length}</p>
          <p className="mt-1 text-[11px] text-muted">سجلات داخلية فقط، غير متصلة بأي منصة</p>
        </div>

        <div className="rounded-2xl border border-line bg-surface/70 p-5">
          <p className="text-[11px] tracking-[0.15em] text-muted">اتصال Salla</p>
          <p className="mt-2 text-sm font-semibold text-gold-soft">Not Connected</p>
          <p className="mt-1 text-[11px] text-muted">متاح في المرحلة القادمة — لا بيانات</p>
        </div>
      </section>

      <section className="rounded-3xl border border-line bg-surface/70 p-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-sm font-semibold text-ink">المتاجر</h2>
          <Link
            href="/app/stores"
            className="text-[12px] font-medium text-gold-soft transition-colors hover:text-gold"
          >
            إدارة المتاجر
          </Link>
        </div>

        {overview.stores.length === 0 ? (
          <p className="mt-4 rounded-xl border border-line/70 bg-canvas/40 px-4 py-3 text-[12px] leading-6 text-muted">
            لا يوجد متجر داخلي بعد. يمكنك إنشاء سجل متجر اختياري لتنظيم العمل، لكنه لن يتصل بـ{" "}
            <span className="ltr">Salla</span> في هذه المرحلة.
          </p>
        ) : (
          <ul className="mt-4 space-y-3">
            {overview.stores.map((store) => (
              <li
                key={store.id}
                className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-line/70 bg-canvas/40 px-4 py-3"
              >
                <div>
                  <p className="text-[13px] font-medium text-ink">{store.name}</p>
                  <p className="ltr text-[11px] text-muted">
                    {store.platform} · {store.status}
                  </p>
                </div>
                <StatusPill tone="amber">غير متصل — لا بيانات</StatusPill>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="rounded-2xl border border-gold/20 bg-gold/[0.06] p-5">
        <p className="flex items-center gap-2 text-xs font-semibold text-gold-soft">
          <span aria-hidden="true" className="h-1.5 w-1.5 rounded-full bg-gold" />
          ما لا تجده هنا مقصود
        </p>
        <p className="mt-2 text-[12px] leading-6 text-muted">
          لا مبيعات، ولا منتجات، ولا تحليلات، ولا توصيات ذكاء اصطناعي. هذه المرحلة تبني الهوية
          والعزل فقط، وأي رقم تجاري هنا سيكون وهميًا.
        </p>
      </section>
    </div>
  );
}
