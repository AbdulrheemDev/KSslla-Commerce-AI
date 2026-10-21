"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { StatusPill, type PillTone } from "@/components/status-pill";
import type { ConnectionView } from "@/modules/integrations/salla/application/connection-service";
import { CONNECTION_STATUS_LABELS_AR } from "@/modules/integrations/salla/domain/messages";
import { apiRequest } from "@/lib/client/api";

/**
 * Salla connection card.
 *
 * Receives only a safe projection: no tokens, no ciphertext, no client secret.
 * The Connect button asks the server for an authorization URL and navigates to
 * Salla; the server owns every trust decision.
 */

const STATUS_TONE: Record<ConnectionView["status"], PillTone> = {
  authorizing: "amber",
  connected: "teal",
  refreshing: "amber",
  reauth_required: "rose",
  revoked: "muted",
  error: "rose",
  disconnected: "muted",
};

function formatDate(value: string | null): string {
  if (!value) return "—";
  const date = new Date(value);
  return new Intl.DateTimeFormat("ar-SA", {
    dateStyle: "medium",
    timeStyle: "short",
    calendar: "gregory",
    numberingSystem: "latn",
  }).format(date);
}

export function SallaConnectionCard({
  storeId,
  connection,
  canConnect,
  canDisconnect,
  sallaState,
  initialError,
}: {
  storeId: string;
  connection: ConnectionView;
  canConnect: boolean;
  canDisconnect: boolean;
  sallaState: "ready" | "easy_mode_pending" | "not_configured";
  initialError: string | null;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(initialError);

  const isConnected = connection.status === "connected";
  const needsReauth = connection.status === "reauth_required";

  async function connect() {
    if (busy) return;
    setBusy(true);
    setError(null);

    try {
      const result = await apiRequest<{ authorizationUrl: string }>(
        `/api/organizations/current/stores/${storeId}/salla/authorize`,
        { method: "POST" },
      );
      window.location.assign(result.authorizationUrl);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "تعذّر بدء التفويض.");
      setBusy(false);
    }
  }

  async function disconnect() {
    if (busy) return;
    setBusy(true);
    setError(null);

    try {
      await apiRequest(`/api/organizations/current/stores/${storeId}/salla/connection`, {
        method: "DELETE",
      });
      startTransition(() => router.refresh());
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "تعذّر فصل الربط.");
    } finally {
      setBusy(false);
    }
  }

  const disabled = busy || pending;

  return (
    <section className="rounded-3xl border border-gold/20 bg-gold/[0.06] p-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold text-gold-soft">ربط Salla</h2>
          <p className="mt-1 text-[11.5px] leading-6 text-muted">
            تفويض رسمي عبر <span className="ltr">OAuth 2.0</span>. تُخزَّن الرموز مشفّرة على الخادم
            ولا تظهر في المتصفح إطلاقًا.
          </p>
        </div>
        <StatusPill tone={STATUS_TONE[connection.status]}>
          <span className="ltr">{CONNECTION_STATUS_LABELS_AR[connection.status]}</span>
        </StatusPill>
      </div>

      <dl className="mt-5 grid gap-3 text-[12px] sm:grid-cols-2">
        <div>
          <dt className="text-[11px] text-muted">معرّف متجر Salla</dt>
          <dd className="ltr mt-1 break-all text-ink">{connection.externalStoreId ?? "—"}</dd>
        </div>
        <div>
          <dt className="text-[11px] text-muted">اسم المتجر في Salla</dt>
          <dd className="mt-1 text-ink">{connection.externalStoreName ?? "—"}</dd>
        </div>
        <div>
          <dt className="text-[11px] text-muted">تاريخ الربط</dt>
          <dd className="mt-1 text-ink">{formatDate(connection.connectedAt)}</dd>
        </div>
        <div>
          <dt className="text-[11px] text-muted">انتهاء رمز الوصول</dt>
          <dd className="mt-1 text-ink">{formatDate(connection.accessTokenExpiresAt)}</dd>
        </div>
        <div className="sm:col-span-2">
          <dt className="text-[11px] text-muted">الصلاحيات الممنوحة</dt>
          <dd className="mt-1 flex flex-wrap gap-1.5">
            {connection.scopes.length > 0 ? (
              connection.scopes.map((scope) => (
                <span
                  key={scope}
                  className="ltr rounded-md border border-line bg-surface-2 px-1.5 py-0.5 text-[10.5px] text-muted"
                >
                  {scope}
                </span>
              ))
            ) : (
              <span className="text-muted">—</span>
            )}
          </dd>
        </div>
      </dl>

      {needsReauth ? (
        <p className="mt-4 rounded-xl border border-rose/25 bg-rose/10 px-3 py-2 text-[12px] leading-6 text-rose">
          رفضت Salla التفويض السابق. أعد الربط من زر «إعادة الربط» لاستعادة الاتصال.
        </p>
      ) : null}

      {sallaState === "not_configured" ? (
        <p className="mt-4 rounded-xl border border-amber-400/25 bg-amber-400/10 px-3 py-2 text-[12px] leading-6 text-amber-200">
          تكامل Salla غير مهيأ على هذا الخادم بعد. يلزم ضبط مفاتيح التطبيق ليصبح الربط متاحًا.
        </p>
      ) : null}

      {sallaState === "easy_mode_pending" ? (
        <p className="mt-4 rounded-xl border border-amber-400/25 bg-amber-400/10 px-3 py-2 text-[12px] leading-6 text-amber-200">
          وضع <span className="ltr">Easy Mode</span> مُختار، ولكن الحصول على الرموز فيه يتم عبر
          Webhook خارج نطاق هذه المرحلة. الربط غير مفعّل في هذا الوضع.
        </p>
      ) : null}

      {error ? (
        <p role="alert" className="mt-4 text-[12px] text-rose">
          {error}
        </p>
      ) : null}

      <div className="mt-5 flex flex-wrap gap-2">
        {canConnect ? (
          <button
            type="button"
            onClick={connect}
            disabled={disabled || sallaState !== "ready" || connection.status === "authorizing"}
            className="rounded-xl bg-gold px-4 py-2.5 text-[12.5px] font-semibold text-canvas transition-colors hover:bg-gold-soft disabled:cursor-not-allowed disabled:opacity-60"
          >
            {busy
              ? "جارٍ التحويل…"
              : isConnected
                ? "إعادة الربط"
                : needsReauth
                  ? "إعادة الربط"
                  : "ربط Salla"}
          </button>
        ) : null}

        {canDisconnect && (isConnected || needsReauth) ? (
          <button
            type="button"
            onClick={disconnect}
            disabled={disabled}
            className="rounded-xl border border-line bg-surface-2 px-4 py-2.5 text-[12.5px] text-ink transition-colors hover:border-rose/40 hover:text-rose disabled:cursor-not-allowed disabled:opacity-60"
          >
            فصل الربط
          </button>
        ) : null}
      </div>

      <p className="mt-3 text-[10.5px] leading-5 text-muted">
        فصل الربط هنا يحذف الرموز من خوادمنا فقط، ولا يزيل التطبيق من متجرك في Salla.
      </p>
    </section>
  );
}
