"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { apiRequest } from "@/lib/client/api";

export function AcceptInvite({ token }: { token: string }) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function accept() {
    if (pending) return;
    setPending(true);
    setError(null);

    try {
      await apiRequest("/api/invitations/accept", {
        method: "POST",
        body: { token },
      });
      router.push("/app");
      router.refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "تعذّر قبول الدعوة.");
    } finally {
      setPending(false);
    }
  }

  return (
    <div>
      <button
        type="button"
        onClick={() => void accept()}
        disabled={pending}
        className="rounded-xl bg-gold px-4 py-2.5 text-[13px] font-semibold text-canvas transition-colors hover:bg-gold-soft disabled:opacity-60"
      >
        {pending ? "جارٍ القبول…" : "قبول الدعوة والانضمام"}
      </button>

      {error ? (
        <p
          role="alert"
          className="mt-3 rounded-xl border border-rose/30 bg-rose/10 px-3.5 py-2.5 text-[12px] text-rose"
        >
          {error}
        </p>
      ) : null}

      <p className="mt-3 text-[11px] leading-6 text-muted">
        تُستخدم الدعوة مرة واحدة وتنتهي صلاحيتها بعد 7 أيام. يجب أن تطابق بريد حسابك.
      </p>
    </div>
  );
}
