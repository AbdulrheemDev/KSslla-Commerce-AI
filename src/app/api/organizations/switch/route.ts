import { getDb } from "@/db/client";
import { AppError } from "@/lib/errors";
import { loadMembershipForUser } from "@/modules/identity/application/auth-service";
import { setSessionOrganization } from "@/modules/identity/infrastructure/repositories";
import { findOrganizationById } from "@/modules/organizations/infrastructure/repositories";
import { apiSuccess, withApi } from "@/server/api";
import { assertCsrf } from "@/server/csrf";
import { switchOrganizationSchema } from "@/server/schemas";
import { requireAuth } from "@/server/session";
import { parseJson } from "@/server/validation";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * Switches the active organization for the current session.
 *
 * The requested id is only a request: it is validated against the caller's
 * active memberships, and a non-member organization resolves to 404 so
 * organization existence is not revealed.
 */
export const POST = withApi(async (request) => {
  assertCsrf(request);
  const auth = await requireAuth(request);
  const input = await parseJson(request, switchOrganizationSchema);

  const membership = await loadMembershipForUser(getDb(), auth.user.id, input.organizationId);

  if (!membership || membership.status !== "active") {
    throw new AppError({ code: "NOT_FOUND", message: "Organization not found." });
  }

  const organization = await findOrganizationById(getDb(), input.organizationId);

  await setSessionOrganization(getDb(), auth.session.id, input.organizationId);

  return apiSuccess({
    organization: organization
      ? { id: organization.id, name: organization.name, slug: organization.slug }
      : null,
    role: membership.role,
  });
});
