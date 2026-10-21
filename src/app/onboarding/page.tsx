import type { Metadata } from "next";
import Link from "next/link";

import { BrandMark } from "@/components/brand-mark";
import { StatusPill } from "@/components/status-pill";
import { PRODUCT } from "@/config/product";
import { ROLE_LABELS_AR } from "@/modules/identity/domain/permissions";
import { requirePageSession } from "@/server/pages";

export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "التهيئة" };

const STEPS = [
  {
    index: "01",
    title: "إنشاء الحساب",
    description:
      "بريد إلكتروني مُطبَّع وكلمة مرور مُخزّنة بـ scrypt. لا تُخزَّن كلمة المرور نفسها.",
  },
  {
    index: "02",
    title: "إنشاء المؤسسة",
    description: "المؤسسة وعضوية المالك تُنشأ في المعاملة نفسها مع الحساب.",
  },
  {
    index: "03",
    title: "الدخول إلى مساحة المؤسسة",
    description: "الجلسة مخزّنة في الخادم وقابلة للإبطال، ومحمية بكوكي HttpOnly.",
  },
  {
    index: "04",
    title: "ربط متجر Salla",
    description: "غير متاح في هذه المرحلة. لا يوجد اتصال ولا قراءة بيانات ولا كتابة.",
    pending: true,
  },
] as const;

export default async function OnboardingPage() {
  const auth = await requirePageSession();
  const hasOrganization = Boolean(auth.membership && auth.organization);

  return (
    <div className="relative min-h-screen overflow-hidden">
      <div
        aria-hidden="true"
        className="backdrop-grid pointer-events-none absolute inset-x-0 top-0 h-[420px]"
      />

      <header className="relative mx-auto flex max-w-4xl items-center justify-between gap-4 px-6 py-6">
        <div className="flex items-center gap-3">
          <BrandMark />
          <div>
            <p className="text-sm font-semibold text-ink">{PRODUCT.nameAr}</p>
            <p className="text-[11px] text-muted">{PRODUCT.taglineAr}</p>
          </div>
        </div>
        <StatusPill tone="gold">مرحلة 02 · التهيئة</StatusPill>
      </header>

      <main className="relative mx-auto max-w-4xl px-6 pb-20">
        <h1 className="mt-6 text-3xl font-semibold tracking-tight text-ink">
          مرحبًا، {auth.user.name}
        </h1>
        <p className="mt-2 max-w-2xl text-[13.5px] leading-8 text-muted">
          هذه حالة التهيئة الفعلية لحسابك. لا تُعرض أي بيانات متجر لأن الاتصال بـ{" "}
          <span className="ltr">Salla</span> لم يُبنَ بعد.
        </p>

        <div className="mt-8 grid gap-4 sm:grid-cols-2">
          <div className="rounded-2xl border border-line bg-surface/70 p-5">
            <p className="text-[11px] tracking-[0.15em] text-muted">الحساب</p>
            <p className="mt-2 text-sm font-semibold text-ink">{auth.user.email}</p>
            <div className="mt-3">
              <StatusPill tone="teal">مُنشأ ومُتحقَّق عبر جلسة</StatusPill>
            </div>
          </div>

          <div className="rounded-2xl border border-line bg-surface/70 p-5">
            <p className="text-[11px] tracking-[0.15em] text-muted">المؤسسة</p>
            <p className="mt-2 text-sm font-semibold text-ink">
              {auth.organization ? auth.organization.name : "لم تُنشأ بعد"}
            </p>
            <div className="mt-3">
              {hasOrganization && auth.membership ? (
                <StatusPill tone="teal">دورك: {ROLE_LABELS_AR[auth.membership.role]}</StatusPill>
              ) : (
                <StatusPill tone="amber">بانتظار دعوة مؤسسة</StatusPill>
              )}
            </div>
          </div>
        </div>

        <section className="mt-8 rounded-3xl border border-line bg-surface/70 p-6">
          <h2 className="text-sm font-semibold text-ink">خطوات التهيئة</h2>
          <ol className="mt-5 space-y-4">
            {STEPS.map((step) => {
              const done =
                step.index === "01" ||
                (step.index === "02" && hasOrganization) ||
                (step.index === "03" && hasOrganization);

              return (
                <li key={step.index} className="flex items-start gap-4">
                  <span
                    className={`ltr mt-0.5 inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full border text-[10px] font-semibold ${
                      done
                        ? "border-teal/30 bg-teal/10 text-teal"
                        : "border-line bg-surface-2 text-muted"
                    }`}
                  >
                    {done ? "✓" : step.index}
                  </span>
                  <div>
                    <p className="text-[13px] font-semibold text-ink">{step.title}</p>
                    <p className="mt-1 text-[12px] leading-6 text-muted">{step.description}</p>
                  </div>
                </li>
              );
            })}
          </ol>
        </section>

        <div className="mt-8 flex flex-wrap items-center gap-3">
          <Link
            href="/app"
            className="rounded-xl bg-gold px-4 py-2.5 text-[13px] font-semibold text-canvas transition-colors hover:bg-gold-soft"
          >
            الدخول إلى مساحة المؤسسة
          </Link>
          <Link
            href="/"
            className="rounded-xl border border-line bg-surface-2 px-4 py-2.5 text-[13px] text-muted transition-colors hover:text-ink"
          >
            الرئيسية
          </Link>
          <span className="text-[11px] text-muted">
            Salla: <span className="ltr text-gold-soft">Not Connected</span> — متاح في المرحلة
            القادمة.
          </span>
        </div>
      </main>
    </div>
  );
}
