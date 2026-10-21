import { BrandMark } from "@/components/brand-mark";
import { ModuleCard } from "@/components/module-card";
import { SectionHeading } from "@/components/section-heading";
import { StatusPill } from "@/components/status-pill";
import {
  CURRENT_CAPABILITIES,
  DATA_STATE,
  DOCUMENTS,
  PHASE_02_SCOPE,
  PLANNED_MODULES,
  PRINCIPLES,
  PRODUCT,
} from "@/config/product";

const COMPLETED_ARTIFACTS = [
  "فحص المشروع وتوثيق الحالة الحالية",
  "معمارية البيانات والأمان وتعدد المستأجرين",
  "عقد طبقة ذكاء اصطناعي مستقل عن المزوّد",
  "خارطة طريق وقرارات معمارية موثّقة",
] as const;

const HERO_CHIPS = [
  "Multi-tenant",
  "Approval-gated",
  "Provider-agnostic AI",
  "Arabic-first",
] as const;

export default function HomePage() {
  return (
    <div className="relative min-h-screen overflow-hidden">
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:absolute focus:right-4 focus:top-4 focus:z-50 focus:rounded-lg focus:bg-gold focus:px-4 focus:py-2 focus:text-sm focus:font-semibold focus:text-canvas"
      >
        تخطَّ إلى المحتوى
      </a>

      <div
        aria-hidden="true"
        className="backdrop-grid pointer-events-none absolute inset-x-0 top-0 h-[560px]"
      />
      <div
        aria-hidden="true"
        className="pointer-events-none absolute -top-32 right-1/4 h-72 w-72 rounded-full bg-gold/[0.06] blur-3xl"
      />

      <header className="relative mx-auto flex max-w-6xl items-center justify-between gap-4 px-6 py-6">
        <div className="flex items-center gap-3">
          <BrandMark />
          <div>
            <p className="text-sm font-semibold tracking-tight text-ink">{PRODUCT.nameAr}</p>
            <p className="text-[11px] text-muted">{PRODUCT.taglineAr}</p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <div className="hidden sm:block">
            <StatusPill tone="gold">
              <span className="ltr">Phase {PRODUCT.phase.label}</span>
              <span aria-hidden="true">·</span>
              <span>{PRODUCT.phase.titleAr}</span>
            </StatusPill>
          </div>
          <span className="ltr rounded-full border border-line bg-surface/70 px-3 py-1 text-[11px] text-muted">
            v{PRODUCT.version}
          </span>
        </div>
      </header>

      <main id="main" className="relative mx-auto max-w-6xl px-6 pb-24">
        <section className="grid gap-10 pt-8 lg:grid-cols-[1.15fr_0.85fr] lg:items-start lg:pt-14">
          <div>
            <div className="mb-6 flex flex-wrap items-center gap-2">
              <StatusPill tone="teal">مرحلة التأسيس والمعمارية</StatusPill>
              <StatusPill tone="muted">
                <span className="ltr">Foundation &amp; Architecture</span>
              </StatusPill>
            </div>

            <h1 className="text-balance text-4xl font-semibold leading-[1.15] tracking-tight text-ink sm:text-5xl lg:text-6xl">
              {PRODUCT.nameAr}
            </h1>
            <p className="mt-3 text-lg font-medium text-gold-soft/90">{PRODUCT.taglineAr}</p>
            <p className="mt-5 max-w-xl text-[15px] leading-8 text-muted">
              {PRODUCT.descriptionAr}
            </p>

            <ul className="mt-6 flex flex-wrap gap-2">
              {HERO_CHIPS.map((chip) => (
                <li
                  key={chip}
                  className="ltr rounded-full border border-line bg-surface/60 px-3 py-1 text-[11px] text-muted"
                >
                  {chip}
                </li>
              ))}
            </ul>

            <p className="mt-7 max-w-xl rounded-xl border border-line bg-surface/50 p-4 text-[12.5px] leading-6 text-muted">
              <span className="font-semibold text-ink">نطاق هذه المرحلة:</span> فحص وتوثيق وبناء
              أساس تقني فقط — لا اتصال بـ <span className="ltr">Salla</span>، ولا عرض بيانات متجر،
              ولا تنفيذ أي إجراء.
            </p>
          </div>

          <aside className="rounded-3xl border border-line bg-surface/80 p-6 shadow-[0_40px_120px_-80px_rgba(216,180,106,0.75)] backdrop-blur">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-[11px] tracking-[0.2em] text-muted">حالة المرحلة</p>
                <p className="mt-1 text-sm font-semibold text-ink">{PRODUCT.phase.titleAr}</p>
              </div>
              <StatusPill tone="teal">مكتملة للمراجعة</StatusPill>
            </div>

            <ul className="mt-6 space-y-3">
              {COMPLETED_ARTIFACTS.map((artifact) => (
                <li
                  key={artifact}
                  className="flex items-start gap-2.5 text-[12.5px] leading-6 text-muted"
                >
                  <span
                    aria-hidden="true"
                    className="mt-0.5 inline-flex h-4 w-4 shrink-0 items-center justify-center rounded-full border border-teal/25 bg-teal/10 text-[9px] text-teal"
                  >
                    ✓
                  </span>
                  <span>{artifact}</span>
                </li>
              ))}
            </ul>

            <div className="mt-6 h-px bg-line" />

            <div className="mt-6 rounded-2xl border border-gold/20 bg-gold/[0.06] p-4">
              <p className="flex items-center gap-2 text-xs font-semibold text-gold-soft">
                <span aria-hidden="true" className="h-1.5 w-1.5 rounded-full bg-gold" />
                لا اتصال بمتجر في هذه المرحلة
              </p>
              <p className="mt-2 text-[12px] leading-6 text-muted">
                لا تُقرأ بيانات من <span className="ltr">Salla</span> ولا تُكتب، ولا يوجد مزوّد ذكاء
                اصطناعي مهيأ. هذه الواجهة تعرض حالة المشروع فقط.
              </p>
            </div>

            <div className="mt-5 flex items-center justify-between gap-3 rounded-xl border border-line/70 bg-canvas/40 px-3.5 py-3">
              <span className="text-[11px] text-muted">المرحلة التالية</span>
              <span className="text-[12px] font-medium text-ink">
                <span className="ltr text-gold">Phase 02</span> · المصادقة وتعدد المستأجرين
              </span>
            </div>
          </aside>
        </section>

        <section className="mt-20" aria-labelledby="principles-heading">
          <SectionHeading
            id="principles-heading"
            index="01"
            title="مبادئ لا تُفاوض"
            description="قواعد معمارية تسبق أي ميزة. أي وحدة مستقبلية يجب أن تلتزم بها، وإلا لا تُدمج في النظام."
          />

          <div className="grid gap-4 sm:grid-cols-2">
            {PRINCIPLES.map((principle, index) => (
              <article
                key={principle.titleAr}
                className="rounded-2xl border border-line bg-surface/60 p-5 transition-colors hover:border-line-strong"
              >
                <span className="ltr text-[10px] font-semibold tracking-[0.2em] text-gold/80">
                  {String(index + 1).padStart(2, "0")}
                </span>
                <h3 className="mt-2 text-[15px] font-semibold leading-7 text-ink">
                  {principle.titleAr}
                </h3>
                <p className="mt-2 text-[12.5px] leading-6 text-muted">{principle.bodyAr}</p>
              </article>
            ))}
          </div>
        </section>

        <section className="mt-20" aria-labelledby="modules-heading">
          <SectionHeading
            id="modules-heading"
            index="02"
            title="الوحدات القادمة"
            description="المعمارية مصمّمة لاستيعاب هذه الوحدات تدريجيًا. كل وحدة تحمل مستوى العمليات المسموح لها به من اليوم الأول."
          />

          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {PLANNED_MODULES.map((module) => (
              <ModuleCard key={module.key} module={module} />
            ))}
          </div>

          <p className="mt-5 text-[11.5px] leading-6 text-muted/80">
            جميع الوحدات أعلاه مخطّطة ولم تُنفَّذ بعد. الأرقام تشير إلى المرحلة المخصّصة لها في{" "}
            <span className="ltr">docs/roadmap.md</span>.
          </p>
        </section>

        <section className="mt-20" aria-labelledby="state-heading">
          <SectionHeading
            id="state-heading"
            index="03"
            title="ما هو موجود فعليًا"
            description="حالة صريحة بلا بيانات وهمية: الأساس التقني والوثائقي جاهز، أما التكاملات فلم تبدأ بعد."
          />

          <div className="grid gap-6 lg:grid-cols-[1.4fr_1fr]">
            <div className="grid gap-3 sm:grid-cols-2">
              {CURRENT_CAPABILITIES.map((capability) => (
                <article
                  key={capability.labelAr}
                  className="flex h-full flex-col rounded-2xl border border-line bg-surface/60 p-4"
                >
                  <div className="flex items-center gap-2">
                    <span aria-hidden="true" className="text-xs text-teal">
                      ✓
                    </span>
                    <h3 className="text-[13px] font-semibold text-ink">{capability.labelAr}</h3>
                  </div>
                  <p className="mt-2 text-[12px] leading-6 text-muted">{capability.detailAr}</p>
                </article>
              ))}
            </div>

            <div className="rounded-2xl border border-line bg-surface/70 p-5">
              <h3 className="text-sm font-semibold text-ink">حالة البيانات والتكاملات</h3>
              <ul className="mt-3 divide-y divide-line">
                {DATA_STATE.map((item) => (
                  <li
                    key={item.componentAr}
                    className="flex items-center justify-between gap-3 py-3"
                  >
                    <span className="text-[12px] text-muted">{item.componentAr}</span>
                    <StatusPill tone={item.tone === "off" ? "rose" : "amber"}>
                      {item.stateAr}
                    </StatusPill>
                  </li>
                ))}
              </ul>
              <p className="mt-4 text-[11px] leading-6 text-muted/80">
                هذه الحالة مقصودة في المرحلة 01. أي ظهور لبيانات متجر قبل ربط{" "}
                <span className="ltr">Salla</span> بشكل موثّق يُعدّ خللًا.
              </p>
            </div>
          </div>
        </section>

        <section className="mt-20" aria-labelledby="next-heading">
          <SectionHeading
            id="next-heading"
            index="04"
            title="المرحلة التالية"
            description="لا يبدأ التنفيذ قبل اعتماد هذه المرحلة. النطاق أدناه هو الحد الأدنى القابل للاختبار."
          />

          <div className="grid gap-6 lg:grid-cols-[1.05fr_0.95fr]">
            <div className="rounded-3xl border border-gold/20 bg-gradient-to-br from-gold/[0.07] via-surface/60 to-transparent p-6">
              <div className="flex items-center justify-between gap-3">
                <span className="ltr text-[11px] font-semibold tracking-[0.2em] text-gold">
                  Phase 02
                </span>
                <StatusPill tone="gold">التالي</StatusPill>
              </div>
              <h3 className="mt-3 text-xl font-semibold text-ink">المصادقة وتعدد المستأجرين</h3>
              <ul className="mt-5 space-y-3">
                {PHASE_02_SCOPE.map((item, index) => (
                  <li
                    key={item}
                    className="flex items-start gap-3 text-[12.5px] leading-6 text-muted"
                  >
                    <span
                      aria-hidden="true"
                      className="ltr mt-0.5 inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full border border-gold/25 bg-gold/10 text-[10px] text-gold-soft"
                    >
                      {String(index + 1).padStart(2, "0")}
                    </span>
                    <span>{item}</span>
                  </li>
                ))}
              </ul>
              <p className="mt-5 text-[11px] text-muted/70">
                التفاصيل الكاملة في <span className="ltr">docs/phase-02.md</span>.
              </p>
            </div>

            <div className="rounded-3xl border border-line bg-surface/70 p-6">
              <h3 className="text-sm font-semibold text-ink">الوثائق المرجعية</h3>
              <p className="mt-1 text-[11.5px] leading-6 text-muted">
                كل قرار معماري موثّق مع سببه وبدائله، وكل معلومة عن{" "}
                <span className="ltr">Salla</span> مرتبطة بمصدرها الرسمي.
              </p>
              <ul className="mt-4 space-y-2">
                {DOCUMENTS.map((document) => (
                  <li
                    key={document.file}
                    className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-line/70 bg-canvas/40 px-3 py-2.5"
                  >
                    <span className="text-[12px] text-muted">{document.labelAr}</span>
                    <code className="ltr text-[10px] text-gold/80">{document.file}</code>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </section>
      </main>

      <footer className="relative mx-auto max-w-6xl px-6 pb-10">
        <div className="flex flex-col gap-4 border-t border-line pt-6 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-2.5">
            <BrandMark size="sm" />
            <div>
              <p className="text-[12px] font-medium text-ink">
                {PRODUCT.name} <span className="ltr text-muted">· v{PRODUCT.version}</span>
              </p>
              <p className="text-[10.5px] text-muted">
                شريك التصميم الأول: {PRODUCT.designPartnerAr}
              </p>
            </div>
          </div>
          <p className="text-[10.5px] leading-5 text-muted">
            <span className="ltr">Phase 01 — Foundation &amp; Architecture</span>
            <span aria-hidden="true"> · </span>
            لا بيانات متجر معروضة
          </p>
        </div>
      </footer>
    </div>
  );
}
