import type { Metadata } from "next";
import Link from "next/link";

import { CommerceStoreHeader } from "@/components/app/commerce-store-header";
import { formatCount, Stat, StorePicker } from "@/components/app/commerce-widgets";
import { ReplayEventButton } from "@/components/app/replay-event-button";
import { SimulatorNotice } from "@/components/app/simulator-notice";
import { getDb } from "@/db/client";
import { getStoreConnection } from "@/modules/integrations/salla/application/connection-service";
import { getWebhookOverview } from "@/modules/webhooks/application/queries";
import { resolveCommerceStore } from "@/server/store-selection";

export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "أحداث الويبهوك" };

const STATUS_LABELS: Record<string, string> = {
  received: "مستلَم",
  processing: "قيد المعالجة",
  processed: "تم",
  failed: "فاشل — بانتظار إعادة",
  dead_letter: "فاشل نهائيًا",
  unmatched: "غير مرتبط بمتجر",
  ignored: "متجاهَل",
};

const STATUS_TONE: Record<string, string> = {
  received: "bg-sand text-ink/70",
  processing: "bg-teal/10 text-teal",
  processed: "bg-emerald-50 text-emerald-700",
  failed: "bg-amber-50 text-amber-700",
  dead_letter: "bg-rose/10 text-rose",
  unmatched: "bg-sand text-ink/60",
  ignored: "bg-sand text-ink/50",
};

export default async function WebhooksPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const query = await searchParams;
  const requestedStore = typeof query.store === "string" ? query.store : null;
  const { context, stores, store } = await resolveCommerceStore(requestedStore);

  if (!store) {
    return (
      <StorePicker
        title="أحداث الويبهوك"
        description="لحسابك أكثر من متجر. اختر متجرًا لعرض الأحداث التي وصلت من سلّة."
        stores={stores}
        href="/app/webhooks"
      />
    );
  }

  const db = getDb();
  const [overview, connection] = await Promise.all([
    getWebhookOverview(db, context, store.id, { limit: 40 }),
    getStoreConnection(db, context, store.id),
  ]);

  const canReplay = context.permissions.includes("store:sync");
  const pending = overview.counts.failed + overview.counts.dead_letter;

  return (
    <div className="space-y-8">
      <CommerceStoreHeader
        title="أحداث الويبهوك"
        description="سجل الوارد من ويبهوك سلّة لهذا المتجر: ما وصل، وما عولج، وما فشل. يُتحقّق من التوقيع قبل أي قراءة أو حفظ."
        store={store}
        stores={stores}
        current="/app/webhooks"
      />

      <section className="grid gap-3 sm:grid-cols-4">
        <Stat label="أحداث محفوظة" value={formatCount(overview.events.length)} />
        <Stat label="تمت معالجتها" value={formatCount(overview.counts.processed)} />
        <Stat label="بانتظار إعادة" value={formatCount(overview.counts.failed)} />
        <Stat label="فاشلة نهائيًا" value={formatCount(overview.counts.dead_letter)} />
      </section>

      <SimulatorNotice />

      <section className="rounded-xl border border-line bg-white p-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="text-sm font-semibold text-ink">حالة الاستقبال</h2>
            <p className="mt-1 max-w-2xl text-xs leading-relaxed text-ink/60">
              تُثبَّت الأحداث أولًا ثم تُعالج في الخلفية عبر مزامنة للقراءة فقط، فلا يُنتظر اكتمالها
              قبل الرد على سلّة. التوقيع هو HMAC-SHA256 على الجسم الخام بمفتاح الويبهوك.
            </p>
          </div>
          <span
            className={`rounded-full px-2.5 py-1 text-[11px] ${
              connection.status === "connected"
                ? "bg-emerald-50 text-emerald-700"
                : "bg-sand text-ink/70"
            }`}
          >
            {connection.status === "connected" ? "المتجر متصل" : "المتجر غير متصل"}
          </span>
        </div>

        <dl className="mt-4 grid gap-3 text-xs sm:grid-cols-3">
          <div>
            <dt className="text-ink/50">غير مرتبط بمتجر</dt>
            <dd className="mt-1 font-medium text-ink">{formatCount(overview.counts.unmatched)}</dd>
          </div>
          <div>
            <dt className="text-ink/50">قيد المعالجة الآن</dt>
            <dd className="mt-1 font-medium text-ink">{formatCount(overview.counts.processing)}</dd>
          </div>
          <div>
            <dt className="text-ink/50">متجاهَل (غير مدعوم أو مقصود)</dt>
            <dd className="mt-1 font-medium text-ink">{formatCount(overview.counts.ignored)}</dd>
          </div>
        </dl>

        {!canReplay ? (
          <p className="mt-4 rounded-lg bg-sand/60 px-3 py-2 text-[11.5px] text-ink/60">
            إعادة التشغيل تتطلب صلاحية المزامنة. يمكنك مراجعة السجل فقط.
          </p>
        ) : null}
      </section>

      <section className="overflow-hidden rounded-xl border border-line bg-white">
        <div className="flex items-center justify-between border-b border-line px-4 py-3">
          <h2 className="text-sm font-semibold text-ink">أحدث الأحداث</h2>
          {pending > 0 ? (
            <span className="rounded-full bg-amber-50 px-2.5 py-1 text-[11px] text-amber-700">
              {formatCount(pending)} بحاجة إلى مراجعة
            </span>
          ) : null}
        </div>

        {overview.events.length === 0 ? (
          <div className="px-4 py-10 text-center text-sm text-ink/60">
            <p>لم يصل أي حدث بعد.</p>
            <p className="mt-2 text-xs text-ink/45">
              تُسجَّل الأحداث تلقائيًا عند وصولها من سلّة إلى نقطة الاستقبال.
            </p>
          </div>
        ) : (
          <ul className="divide-y divide-line">
            {overview.events.map((event) => (
              <li key={event.id} className="flex flex-wrap items-start gap-3 px-4 py-3">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <code dir="ltr" className="text-[11.5px] text-ink">
                      {event.eventName}
                    </code>
                    <span
                      className={`rounded-full px-2 py-0.5 text-[10.5px] ${
                        STATUS_TONE[event.status] ?? "bg-sand text-ink/60"
                      }`}
                    >
                      {STATUS_LABELS[event.status] ?? event.status}
                    </span>
                    {event.attemptCount > 0 ? (
                      <span className="text-[10.5px] text-ink/45">
                        محاولات: {formatCount(event.attemptCount)}
                      </span>
                    ) : null}
                  </div>

                  <p className="mt-1 text-[11px] text-ink/50">
                    وصل: {new Date(event.receivedAt).toISOString().replace("T", " ").slice(0, 19)}{" "}
                    UTC
                    {event.processedAt
                      ? ` · عولج: ${new Date(event.processedAt)
                          .toISOString()
                          .replace("T", " ")
                          .slice(0, 19)} UTC`
                      : ""}
                  </p>

                  {event.action ? (
                    <p className="mt-1 text-[11px] text-ink/50">
                      الإجراء: <span dir="ltr">{event.action}</span>
                    </p>
                  ) : null}

                  {event.lastErrorCode ? (
                    <p className="mt-1 text-[11px] text-rose">
                      <span dir="ltr">{event.lastErrorCode}</span>
                      {event.lastErrorMessage ? ` — ${event.lastErrorMessage}` : ""}
                    </p>
                  ) : null}
                </div>

                {canReplay && (event.status === "failed" || event.status === "dead_letter") ? (
                  <ReplayEventButton storeId={store.id} eventId={event.id} />
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </section>

      <p className="text-[11px] leading-relaxed text-ink/45">
        لا يُخزَّن جسم الويبهوك كما ورد. يُحفظ فقط ما تحتاجه المزامنة: اسم الحدث، معرّف المتجر
        التجاري، وبصمة الجسم. الشعارات ومحتوى العميل لا تُسجَّل.{" "}
        <Link
          href={`/app/stores/${store.id}`}
          className="text-teal underline-offset-2 hover:underline"
        >
          إعدادات المتجر
        </Link>
      </p>
    </div>
  );
}
