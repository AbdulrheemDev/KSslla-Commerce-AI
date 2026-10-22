import { cache } from "react";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";

import { getDb } from "@/db/client";
import { authenticateSessionToken } from "@/modules/identity/application/auth-service";
import type { AuthSession } from "@/modules/identity/application/types";
import { permissionsForRole } from "@/modules/identity/domain/permissions";
import { SESSION_COOKIE_NAME } from "@/modules/identity/domain/session-policy";
import type { TenantContext } from "@/modules/identity/application/types";

/** Server-component session lookup. Never used by route handlers. */
export const readPageSession = cache(async (): Promise<AuthSession | null> => {
  const store = await cookies();
  const token = store.get(SESSION_COOKIE_NAME)?.value;
  if (!token) return null;
  return authenticateSessionToken(getDb(), token);
});

export async function requirePageSession(): Promise<AuthSession> {
  const auth = await readPageSession();
  if (!auth) redirect("/login");
  return auth;
}

export async function requirePageTenant(): Promise<{
  auth: AuthSession;
  context: TenantContext;
}> {
  const auth = await requirePageSession();

  if (!auth.membership || !auth.organization) {
    redirect("/onboarding");
  }

  const context: TenantContext = {
    userId: auth.user.id,
    organizationId: auth.membership.organizationId,
    membershipId: auth.membership.id,
    role: auth.membership.role,
    permissions: permissionsForRole(auth.membership.role),
    user: { id: auth.user.id, email: auth.user.email, name: auth.user.name },
    organization: {
      id: auth.organization.id,
      name: auth.organization.name,
      slug: auth.organization.slug,
    },
    sessionId: auth.session.id,
    requestId: null,
  };

  return { auth, context };
}
