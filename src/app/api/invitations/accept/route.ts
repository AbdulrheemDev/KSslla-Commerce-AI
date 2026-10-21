import { getDb } from "@/db/client";
import { acceptInvitation } from "@/modules/organizations/application/membership-service";
import { setSessionOrganization } from "@/modules/identity/infrastructure/repositories";
import { apiSuccess, withApi } from "@/server/api";
import { assertCsrf } from "@/server/csrf";
import { clientKey, requestMeta } from "@/server/request-meta";
import { enforceRateLimit } from "@/server/rate-limit";
import { acceptInvitationSchema } from "@/server/schemas";
import { requireAuth } from "@/server/session";
import { parseJson } from "@/server/validation";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export const POST = withApi(async (request) => {
  assertCsrf(request);
  const auth = await requireAuth(request);

  // Bounds token probing; the token itself stays the only credential.
  enforceRateLimit("invitation:accept", clientKey(request), 20, 15 * 60 * 1000);

  const input = await parseJson(request, acceptInvitationSchema);

  const result = await acceptInvitation(
    getDb(),
    { token: input.token, userId: auth.user.id, userEmail: auth.user.email },
    requestMeta(request),
  );

  // Make the joined organization the active one for this session.
  await setSessionOrganization(getDb(), auth.session.id, result.organizationId);

  return apiSuccess({ organizationId: result.organizationId, role: result.role });
});
