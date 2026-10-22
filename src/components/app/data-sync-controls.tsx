"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { apiRequest } from "@/lib/client/api";

/**
 * Manual sync controls for orders, customers, and inventory.
 *
 * Every run is read-only towards Salla. The buttons are hidden without
 * `store:sync`, but the route enforces the permission again — hiding a control
 * is presentation, never authorization.
 */

type Resource = "customers" | "orders" | "inventory" | "all";

const BUTTONS: Array<{ resource: Resource; label: string }> = [
  { resource: "customers", label: "مزامنة العملاء" },
  { resource: "orders", label: "مزامنة الطلبات" },
  { resource: "inventory", label: "مزامنة المخزون" },
  { resource: "all", label: "مزامنة الكل" },
];

function formatCount(value: number): string {
  return new Intl.NumberFormat("ar-SA", { numberingSystem: "latn" }).format(value);
}

export function DataSyncControls({
  storeId,
  canSync,
  connected,
  missingScopes,
}: {
  storeId: string;
  canSync: boolean;
  connected: boolean;
  missingScopes: string[];
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [busy, setBusy] = useState<Resource | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const needsReconnect = connected && missingScopes.length > 0;

  async function run(resource: Resource) {
    if (busy) return;
    setBusy(resource);
    setError(null);
    setNotice(null);

    try {
      const result = await apiRequest<{ runs: Array<{ items: number }> }>(
        `/api/organizations/current/stores/${storeId}/data/sync`,
        { method: "POST", body: { resource } },
      );
      const total = result.runs.reduce((sum, item) => sum + item.items, 0);
      setNotice(`تمت المزامنة. عُولج ${formatCount(total)} عنصرًا.`);
      startTransition(() => router.refresh());
    } catch {
      // One neutral message: provider codes and payloads never reach the UI.
      setError("تعذّرت مزامنة البيانات حاليًا. تحقّق من الاتصال ثم أعد المحاولة.");
    } finally {
      setBusy(null);
    }
  }

  if (!connected) {
    return (
      <div className="rounded-2xl border border-amber/25 bg-amber/10 px-4 py-3 text-[12.5px] leading-6 text-amber">
        Salla غير متصل. اربط المتجر أولًا لتتمكن من جلب الطلبات والعملاء والمخزون.
      </div>
    );
  }

  return (
    <section className="rounded-2xl border border-line bg-surface/70 p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold text-ink">مزامنة بيانات المتجر</h2>
          <p className="mt-1 text-[11.5px] leading-6 text-muted">
            قراءة فقط من Salla: العملاء ثم الطلبات ثم المخزون. لا تُكتب أي بيانات إلى المتجر.
          </p>
        </div>
      </div>

      {needsReconnect ? (
        <p className="mt-3 rounded-xl border border-amber/25 bg-amber/10 px-3 py-2 text-[12px] leading-6 text-amber">
          الاتصال الحالي لا يملك الصلاحيات المطلوبة (
          <span className="ltr">{missingScopes.join(", ")}</span>
          ). أعد ربط المتجر مرة واحدة من بطاقة «ربط Salla».
        </p>
      ) : null}

      {notice ? (
        <p role="status" className="mt-3 text-[12px] text-teal">
          {notice}
        </p>
      ) : null}

      {error ? (
        <p
          role="alert"
          className="mt-3 rounded-xl border border-rose/25 bg-rose/10 px-3 py-2 text-[12px] leading-6 text-rose"
        >
          {error}
        </p>
      ) : null}

      {canSync ? (
        <div className="mt-4 flex flex-wrap items-center gap-2">
          {BUTTONS.map((button) => {
            const disabled = busy !== null || pending || needsReconnect;
            return (
              <button
                key={button.resource}
                type="button"
                onClick={() => run(button.resource)}
                disabled={disabled}
                className={
                  button.resource === "all"
                    ? "rounded-xl bg-gold px-4 py-2.5 text-[12.5px] font-semibold text-canvas transition-colors hover:bg-gold-soft disabled:cursor-not-allowed disabled:opacity-60"
                    : "rounded-xl border border-line bg-surface-2 px-4 py-2.5 text-[12.5px] text-ink transition-colors hover:border-line-strong disabled:cursor-not-allowed disabled:opacity-60"
                }
              >
                {busy === button.resource ? "جارٍ التنفيذ…" : button.label}
              </button>
            );
          })}
        </div>
      ) : (
        <p className="mt-3 text-[11px] text-muted">دورك الحالي لا يسمح ببدء المزامنة.</p>
      )}
    </section>
  );
}
