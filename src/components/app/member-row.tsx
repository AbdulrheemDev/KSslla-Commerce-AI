"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { apiRequest } from "@/lib/client/api";
import { ROLE_LABELS_AR, type MembershipRole } from "@/modules/identity/domain/permissions";

export function MemberRow({
  membershipId,
  name,
  email,
  role,
  assignableRoles,
  canManage,
}: {
  membershipId: string;
  name: string;
  email: string;
  role: MembershipRole;
  assignableRoles: MembershipRole[];
  canManage: boolean;
}) {
  const router = useRouter();
  const [currentRole, setCurrentRole] = useState<MembershipRole>(role);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function changeRole(nextRole: MembershipRole) {
    const previous = currentRole;
    setCurrentRole(nextRole);
    setPending(true);
    setError(null);

    try {
      await apiRequest(`/api/organizations/current/members/${membershipId}`, {
        method: "PATCH",
        body: { role: nextRole },
      });
      router.refresh();
    } catch (caught) {
      setCurrentRole(previous);
      setError(caught instanceof Error ? caught.message : "تعذّر تحديث الدور.");
    } finally {
      setPending(false);
    }
  }

  async function remove() {
    if (pending) return;
    if (!window.confirm(`إزالة ${name} من المؤسسة؟ سيفقد الوصول فورًا.`)) return;

    setPending(true);
    setError(null);

    try {
      await apiRequest(`/api/organizations/current/members/${membershipId}`, {
        method: "DELETE",
      });
      router.refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "تعذّر إزالة العضو.");
    } finally {
      setPending(false);
    }
  }

  const options = assignableRoles.includes(currentRole)
    ? assignableRoles
    : [currentRole, ...assignableRoles];

  return (
    <li className="rounded-xl border border-line/70 bg-canvas/40 px-4 py-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate text-[13px] font-medium text-ink">{name}</p>
          <p className="ltr truncate text-[11px] text-muted">{email}</p>
        </div>

        <div className="flex items-center gap-2">
          {canManage ? (
            <>
              <select
                aria-label={`دور ${name}`}
                value={currentRole}
                disabled={pending}
                onChange={(event) => void changeRole(event.target.value as MembershipRole)}
                className="rounded-lg border border-line bg-surface-2 px-2.5 py-1.5 text-[11.5px] text-ink disabled:opacity-60"
              >
                {options.map((option) => (
                  <option key={option} value={option}>
                    {ROLE_LABELS_AR[option]}
                  </option>
                ))}
              </select>

              <button
                type="button"
                onClick={() => void remove()}
                disabled={pending}
                className="rounded-lg border border-rose/30 bg-rose/10 px-2.5 py-1.5 text-[11.5px] text-rose transition-colors hover:bg-rose/20 disabled:opacity-60"
              >
                إزالة
              </button>
            </>
          ) : (
            <span className="rounded-lg border border-line bg-surface-2 px-2.5 py-1.5 text-[11.5px] text-muted">
              {ROLE_LABELS_AR[currentRole]}
            </span>
          )}
        </div>
      </div>

      {error ? (
        <p role="alert" className="mt-2 text-[11px] text-rose">
          {error}
        </p>
      ) : null}
    </li>
  );
}
