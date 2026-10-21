import type { Metadata } from "next";

import { InviteForm } from "@/components/app/invite-form";
import { MemberRow } from "@/components/app/member-row";
import { StatusPill } from "@/components/status-pill";
import { getDb } from "@/db/client";
import { canAssignRole, canManageRole } from "@/modules/identity/application/authorization";
import {
  MEMBERSHIP_ROLES,
  ROLE_LABELS_AR,
  type MembershipRole,
} from "@/modules/identity/domain/permissions";
import {
  listInvitations,
  listMembers,
} from "@/modules/organizations/application/membership-service";
import { requirePageTenant } from "@/server/pages";

export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "الأعضاء" };

export default async function MembersPage() {
  const { context } = await requirePageTenant();

  if (!context.permissions.includes("member:read")) {
    return (
      <section className="rounded-2xl border border-line bg-surface/70 p-6">
        <h1 className="text-lg font-semibold text-ink">الأعضاء</h1>
        <p className="mt-2 text-[13px] leading-7 text-muted">
          دورك الحالي ({ROLE_LABELS_AR[context.role]}) لا يسمح بعرض قائمة الأعضاء.
        </p>
      </section>
    );
  }

  const db = getDb();
  const [members, invitations] = await Promise.all([
    listMembers(db, context),
    listInvitations(db, context),
  ]);

  const assignableRoles = MEMBERSHIP_ROLES.filter((role) =>
    canAssignRole(context.role, role),
  ) as MembershipRole[];

  return (
    <div className="space-y-8">
      <section>
        <h1 className="text-2xl font-semibold tracking-tight text-ink">الأعضاء والصلاحيات</h1>
        <p className="mt-2 text-[13px] leading-7 text-muted">
          الأدوار تُفحص في الخادم عند كل طلب. تغيير دورك أو ترقية نفسك غير ممكن.
        </p>
      </section>

      {context.permissions.includes("member:invite") && assignableRoles.length > 0 ? (
        <section className="rounded-2xl border border-line bg-surface/70 p-5">
          <h2 className="text-sm font-semibold text-ink">دعوة عضو</h2>
          <p className="mt-1 text-[11.5px] leading-6 text-muted">
            لا يمكن دعوة مالك مباشرة، ولا منح دور مساوٍ لدورك أو أعلى منه.
          </p>
          <div className="mt-4">
            <InviteForm assignableRoles={assignableRoles} />
          </div>
        </section>
      ) : null}

      <section className="rounded-2xl border border-line bg-surface/70 p-5">
        <div className="flex items-center justify-between gap-3">
          <h2 className="text-sm font-semibold text-ink">الأعضاء النشطون</h2>
          <StatusPill tone="muted">{members.length}</StatusPill>
        </div>

        <ul className="mt-4 space-y-3">
          {members.map((member) => (
            <MemberRow
              key={member.membershipId}
              membershipId={member.membershipId}
              name={member.name}
              email={member.email}
              role={member.role}
              canManage={
                context.permissions.includes("role:update") &&
                canManageRole(context.role, member.role) &&
                member.userId !== context.userId
              }
              assignableRoles={assignableRoles}
            />
          ))}
        </ul>
      </section>

      <section className="rounded-2xl border border-line bg-surface/70 p-5">
        <div className="flex items-center justify-between gap-3">
          <h2 className="text-sm font-semibold text-ink">دعوات معلّقة</h2>
          <StatusPill tone="muted">{invitations.length}</StatusPill>
        </div>

        {invitations.length === 0 ? (
          <p className="mt-3 text-[12px] leading-6 text-muted">لا توجد دعوات معلّقة.</p>
        ) : (
          <ul className="mt-4 space-y-3">
            {invitations.map((invitation) => (
              <li
                key={invitation.id}
                className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-line/70 bg-canvas/40 px-4 py-3"
              >
                <div>
                  <p className="ltr text-[12px] text-ink">{invitation.email}</p>
                  <p className="mt-0.5 text-[11px] text-muted">
                    تنتهي في {new Date(invitation.expiresAt).toLocaleDateString("ar")}
                  </p>
                </div>
                <StatusPill tone="amber">{ROLE_LABELS_AR[invitation.role]}</StatusPill>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
