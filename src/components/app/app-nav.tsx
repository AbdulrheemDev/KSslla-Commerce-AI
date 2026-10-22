import Link from "next/link";

import { LogoutButton } from "@/components/auth/logout-button";
import { BrandMark } from "@/components/brand-mark";
import { PRODUCT } from "@/config/product";
import { StatusPill } from "@/components/status-pill";
import {
  ROLE_LABELS_AR,
  type MembershipRole,
  type Permission,
} from "@/modules/identity/domain/permissions";

/**
 * Organization shell navigation. Links are hidden when the role lacks the
 * permission, but the pages themselves still enforce authorization.
 */
export function AppNav({
  organizationName,
  role,
  permissions,
}: {
  organizationName: string;
  role: MembershipRole;
  permissions: Permission[];
}) {
  const links = [
    { href: "/app", label: "نظرة عامة" },
    ...(permissions.includes("member:read") ? [{ href: "/app/members", label: "الأعضاء" }] : []),
    { href: "/app/stores", label: "المتاجر" },
  ];

  return (
    <header className="border-b border-line bg-canvas/80 backdrop-blur">
      <div className="mx-auto flex max-w-5xl flex-wrap items-center justify-between gap-4 px-6 py-4">
        <Link href="/app" className="flex items-center gap-3">
          <BrandMark />
          <span>
            <span className="block text-sm font-semibold text-ink">{organizationName}</span>
            <span className="block text-[11px] text-muted">
              KSHakha Commerce AI · <span className="ltr">Phase {PRODUCT.phase.label}</span>
            </span>
          </span>
        </Link>

        <div className="flex flex-wrap items-center gap-3">
          <nav aria-label="التنقل داخل المؤسسة">
            <ul className="flex items-center gap-1">
              {links.map((link) => (
                <li key={link.href}>
                  <Link
                    href={link.href}
                    className="rounded-lg px-3 py-1.5 text-[12px] text-muted transition-colors hover:bg-surface-2 hover:text-ink"
                  >
                    {link.label}
                  </Link>
                </li>
              ))}
            </ul>
          </nav>

          <StatusPill tone="gold">{ROLE_LABELS_AR[role]}</StatusPill>
          <LogoutButton />
        </div>
      </div>
    </header>
  );
}
