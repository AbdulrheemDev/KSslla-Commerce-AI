import { permissionsForRole } from "@/modules/identity/domain/permissions";
import { apiSuccess, withApi } from "@/server/api";
import { optionalAuth } from "@/server/session";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** Session introspection for the UI. Never exposes tokens or password hashes. */
export const GET = withApi(async (request) => {
  const auth = await optionalAuth(request);

  if (!auth) {
    return apiSuccess({ authenticated: false, user: null, organization: null });
  }

  return apiSuccess({
    authenticated: true,
    user: { id: auth.user.id, email: auth.user.email, name: auth.user.name },
    organization: auth.organization
      ? {
          id: auth.organization.id,
          name: auth.organization.name,
          slug: auth.organization.slug,
        }
      : null,
    role: auth.membership?.role ?? null,
    permissions: auth.membership ? permissionsForRole(auth.membership.role) : [],
  });
});
