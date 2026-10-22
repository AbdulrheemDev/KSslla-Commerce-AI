"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { apiRequest } from "@/lib/client/api";

/**
 * Replay control for one webhook event.
 *
 * Rendered only with `store:sync`; the route checks the permission again. A
 * replay re-runs the same read-only sync the manual button would, so nothing
 * here can mutate Salla.
 */
export function ReplayEventButton({
  storeId,
  eventId,
  disabled,
}: {
  storeId: string;
  eventId: string;
  disabled?: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function replay() {
    if (busy) return;
    setBusy(true);
    setError(null);

    try {
      await apiRequest(`/api/organizations/current/stores/${storeId}/webhooks/${eventId}/replay`, {
        method: "POST",
        body: {},
      });
      startTransition(() => router.refresh());
    } catch {
      setError("تعذّرت إعادة التشغيل. تحقّق من الاتصال ثم أعد المحاولة.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <button
        type="button"
        onClick={replay}
        disabled={disabled || busy || pending}
        className="rounded-lg border border-line px-2.5 py-1 text-[11.5px] text-ink transition hover:border-teal/40 disabled:cursor-not-allowed disabled:opacity-50"
      >
        {busy || pending ? "جارٍ الإرسال…" : "إعادة تشغيل"}
      </button>
      {error ? (
        <span role="alert" className="text-[11px] text-rose">
          {error}
        </span>
      ) : null}
    </div>
  );
}
