"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";

import { apiRequest } from "@/lib/client/api";
import { ROLE_LABELS_AR, type MembershipRole } from "@/modules/identity/domain/permissions";

const inputClass =
  "w-full rounded-xl border border-line bg-canvas/60 px-3.5 py-2.5 text-[13px] text-ink outline-none transition-colors placeholder:text-muted/60 focus:border-gold/60";

export function InviteForm({ assignableRoles }: { assignableRoles: MembershipRole[] }) {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<MembershipRole>(
    assignableRoles[assignableRoles.length - 1] ?? "viewer",
  );
  const [error, setError] = useState<string | null>(null);
  const [invitePath, setInvitePath] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending) return;

    setPending(true);
    setError(null);
    setInvitePath(null);

    try {
      const result = await apiRequest<{ invitePath: string }>(
        "/api/organizations/current/members",
        { method: "POST", body: { email, role } },
      );
      setInvitePath(result.invitePath);
      setEmail("");
      router.refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "تعذّر إنشاء الدعوة.");
    } finally {
      setPending(false);
    }
  }

  const absoluteLink =
    invitePath && typeof window !== "undefined"
      ? new URL(invitePath, window.location.origin).toString()
      : invitePath;

  return (
    <div>
      <form onSubmit={onSubmit} className="grid gap-3 sm:grid-cols-[1fr_auto_auto] sm:items-end">
        <div>
          <label htmlFor="invite-email" className="mb-1.5 block text-[12px] font-medium text-ink">
            بريد العضو
          </label>
          <input
            id="invite-email"
            type="email"
            required
            dir="ltr"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            className={inputClass}
          />
        </div>

        <div>
          <label htmlFor="invite-role" className="mb-1.5 block text-[12px] font-medium text-ink">
            الدور
          </label>
          <select
            id="invite-role"
            value={role}
            onChange={(event) => setRole(event.target.value as MembershipRole)}
            className={inputClass}
          >
            {assignableRoles.map((option) => (
              <option key={option} value={option}>
                {ROLE_LABELS_AR[option]}
              </option>
            ))}
          </select>
        </div>

        <button
          type="submit"
          disabled={pending}
          className="rounded-xl bg-gold px-4 py-2.5 text-[13px] font-semibold text-canvas transition-colors hover:bg-gold-soft disabled:opacity-60"
        >
          {pending ? "جارٍ الإرسال…" : "إنشاء دعوة"}
        </button>
      </form>

      {error ? (
        <p
          role="alert"
          className="mt-3 rounded-xl border border-rose/30 bg-rose/10 px-3.5 py-2.5 text-[12px] text-rose"
        >
          {error}
        </p>
      ) : null}

      {invitePath ? (
        <div className="mt-3 rounded-xl border border-teal/25 bg-teal/[0.07] p-3.5">
          <p className="text-[12px] font-medium text-teal">
            تم إنشاء الدعوة. الرابط يظهر مرة واحدة:
          </p>
          <p className="ltr mt-2 break-all rounded-lg bg-canvas/60 px-3 py-2 text-[11px] text-ink">
            {absoluteLink}
          </p>
          <p className="mt-2 text-[11px] leading-6 text-muted">
            لا يوجد مزوّد بريد في هذه المرحلة؛ شارك الرابط مع العضو مباشرة. تنتهي الدعوة بعد 7 أيام
            وتُستخدم مرة واحدة.
          </p>
        </div>
      ) : null}
    </div>
  );
}
