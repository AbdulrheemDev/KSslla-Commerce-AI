import type { ReactNode } from "react";

import { AppNav } from "@/components/app/app-nav";
import { requirePageTenant } from "@/server/pages";

export const dynamic = "force-dynamic";

export default async function OrganizationLayout({ children }: { children: ReactNode }) {
  const { context } = await requirePageTenant();

  return (
    <div className="min-h-screen">
      <AppNav
        organizationName={context.organization.name}
        role={context.role}
        permissions={context.permissions}
      />
      <main className="mx-auto max-w-5xl px-6 py-10">{children}</main>
    </div>
  );
}
