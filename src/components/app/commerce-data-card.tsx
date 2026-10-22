"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { StatusPill, type PillTone } from "@/components/status-pill";
import { apiRequest } from "@/lib/client/api";
import type { CommerceOverview } from "@/modules/catalog/domain/types";

/**
 * Commerce data summary.
 *
 * Every number comes from PostgreSQL for this store. Nothing is estimated, and
 * an un-synced store says so instead of showing a zero that looks like data.
 */

const STATUS_LABEL: Record<CommerceOverview["sync"]["products"]["status"], string> = {
  never: "لم تتم المزامنة",
  running: "جارٍ التنفيذ",
  succeeded: "ناجحة",
  failed: "فاشلة",
};

const STATUS_TONE: Record<CommerceOverview["sync"]["products"]["status"], PillTone> = {
  never: "muted",
  running: "amber",
  succeeded: "teal",
  failed: "rose",
};

function formatDate(value: string | null): string {
  if (!value) return "—";
  return new Intl.DateTimeFormat("ar-SA", {
    dateStyle: "medium",
    timeStyle: "short",
    calendar: "gregory",
    numberingSystem: "latn",
  }).format(new Date(value));
}

function formatCount(value: number): string {
  return new Intl.NumberFormat("ar-SA", { numberingSystem: "latn" }).format(value);
}

export function CommerceDataCard({
  storeId,
  overview,
  canSync,
  connected,
  missingScopes,
}: {
  storeId: string;
  overview: CommerceOverview;
  canSync: boolean;
  connected: boolean;
  missingScopes: string[];
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const lastRun = overview.sync.products.lastRun ?? overview.sync.categories.lastRun;
  const failed =
    overview.sync.products.status === "failed" || overview.sync.categories.status === "failed";

  async function sync() {
    if (busy) return;
    setBusy(true);
    setError(null);
    setNotice(null);

    try {
      const result = await apiRequest<{ runs: Array<{ resource: string; items: number }> }>(
        `/api/organizations/current/stores/${storeId}/catalog/sync`,
        { method: "POST", body: { resource: "all" } },
      );
      const total = result.runs.reduce((sum, run) => sum + run.items, 0);
      setNotice(`تمت المزامنة. عُولج ${formatCount(total)} عنصرًا.`);
      startTransition(() => router.refresh());
    } catch {
      // Contract: the merchant sees one neutral message. Codes and provider
      // details stay in server logs and are never rendered here.
      setError("تعذّرت مزامنة بيانات المتجر حاليًا.");
    } finally {
      setBusy(false);
    }
  }

  const needsReconnect = connected && missingScopes.length > 0;
  const disabled = busy || pending || !connected || needsReconnect;

  return (
    <section className="rounded-2xl border border-line bg-surface/70 p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold text-ink">بيانات التجارة</h2>
          <p className="mt-1 text-[11.5px] leading-6 text-muted">
            نسخة محلية للقراءة فقط من منتجات وتصنيفات Salla. لا تُكتب أي بيانات إلى Salla.
          </p>
        </div>
        <StatusPill tone={needsReconnect ? "amber" : failed ? "rose" : lastRun ? "teal" : "muted"}>
          {needsReconnect
            ? "تحتاج إعادة ربط"
            : failed
              ? "تحتاج مراجعة"
              : lastRun
                ? "مخزّنة محليًا"
                : "لم تتم المزامنة"}
        </StatusPill>
      </div>

      <dl className="mt-5 grid gap-3 sm:grid-cols-4">
        <div className="rounded-xl border border-line/70 bg-canvas/40 px-3 py-2.5">
          <dt className="text-[11px] text-muted">المنتجات</dt>
          <dd className="ltr mt-1 text-lg font-semibold text-ink">
            {formatCount(overview.products)}
          </dd>
        </div>
        <div className="rounded-xl border border-line/70 bg-canvas/40 px-3 py-2.5">
          <dt className="text-[11px] text-muted">التصنيفات</dt>
          <dd className="ltr mt-1 text-lg font-semibold text-ink">
            {formatCount(overview.categories)}
          </dd>
        </div>
        <div className="rounded-xl border border-line/70 bg-canvas/40 px-3 py-2.5">
          <dt className="text-[11px] text-muted">آخر مزامنة ناجحة</dt>
          <dd className="mt-1 text-[12px] text-ink">{formatDate(overview.lastSyncedAt)}</dd>
        </div>
        <div className="rounded-xl border border-line/70 bg-canvas/40 px-3 py-2.5">
          <dt className="text-[11px] text-muted">حالة المنتجات</dt>
          <dd className="mt-1">
            <StatusPill tone={STATUS_TONE[overview.sync.products.status]}>
              {STATUS_LABEL[overview.sync.products.status]}
            </StatusPill>
          </dd>
        </div>
      </dl>

      {needsReconnect ? (
        <p className="mt-4 rounded-xl border border-amber/25 bg-amber/10 px-4 py-3 text-[12px] leading-6 text-amber">
          الاتصال الحالي لا يملك صلاحية قراءة الكتالوج (
          <span className="ltr">{missingScopes.join(", ")}</span>). أعد ربط المتجر مرة واحدة من
          بطاقة «ربط Salla» لمنح الصلاحيات الجديدة.{" "}
          <a href="#salla-connection" className="font-semibold underline">
            الانتقال إلى الربط
          </a>
        </p>
      ) : null}

      {overview.products === 0 && overview.categories === 0 && !lastRun ? (
        <p className="mt-4 rounded-xl border border-line/70 bg-canvas/40 px-4 py-3 text-[12px] leading-6 text-muted">
          {connected
            ? "لم تتم مزامنة البيانات بعد. ابدأ مزامنة يدوية لجلب المنتجات والتصنيفات."
            : "لا يوجد متجر Salla متصل. اربط المتجر أولًا ليصبح بإمكانك جلب البيانات."}
        </p>
      ) : null}

      {lastRun?.errorCode ? (
        <p className="mt-4 rounded-xl border border-rose/25 bg-rose/10 px-3 py-2 text-[12px] leading-6 text-rose">
          آخر محاولة لم تكتمل. البيانات المعروضة هي آخر نسخة ناجحة، ويمكنك إعادة المحاولة.
        </p>
      ) : null}

      {notice ? (
        <p role="status" className="mt-4 text-[12px] text-teal">
          {notice}
        </p>
      ) : null}

      {error ? (
        <p
          role="alert"
          className="mt-4 rounded-xl border border-rose/25 bg-rose/10 px-3 py-2 text-[12px] leading-6 text-rose"
        >
          {error}
        </p>
      ) : null}

      <div className="mt-5 flex flex-wrap items-center gap-2">
        {canSync ? (
          <button
            type="button"
            onClick={sync}
            disabled={disabled}
            className="rounded-xl bg-gold px-4 py-2.5 text-[12.5px] font-semibold text-canvas transition-colors hover:bg-gold-soft disabled:cursor-not-allowed disabled:opacity-60"
          >
            {busy || pending ? "جارٍ المزامنة…" : "مزامنة الآن"}
          </button>
        ) : null}

        <Link
          href={`/app/stores/${storeId}/products`}
          className="rounded-xl border border-line bg-surface-2 px-4 py-2.5 text-[12.5px] text-ink transition-colors hover:border-line-strong"
        >
          المنتجات
        </Link>
        <Link
          href={`/app/orders?store=${storeId}`}
          className="rounded-xl border border-line bg-surface-2 px-4 py-2.5 text-[12.5px] text-ink transition-colors hover:border-line-strong"
        >
          الطلبات والعملاء والمخزون
        </Link>
        <Link
          href={`/app/stores/${storeId}/categories`}
          className="rounded-xl border border-line bg-surface-2 px-4 py-2.5 text-[12.5px] text-ink transition-colors hover:border-line-strong"
        >
          التصنيفات
        </Link>
      </div>

      {!canSync ? (
        <p className="mt-3 text-[11px] text-muted">دورك الحالي لا يسمح ببدء المزامنة.</p>
      ) : null}
    </section>
  );
}
