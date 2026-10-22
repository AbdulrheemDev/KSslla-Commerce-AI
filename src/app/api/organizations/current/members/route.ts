import { getDb } from "@/db/client";
import {
  inviteMember,
  listInvitations,
  listMembers,
} from "@/modules/organizations/application/membership-service";
import { apiSuccess, withApi } from "@/server/api";
import { assertCsrf } from "@/server/csrf";
import { requestMeta } from "@/server/request-meta";
import { RATE_LIMITS, enforceRateLimit } from "@/server/rate-limit";
import { inviteSchema } from "@/server/schemas";
import { requireOrganizationAccess } from "@/server/session";
import { parseJson } from "@/server/validation";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export const GET = withApi(async (request) => {
  const context = await requireOrganizationAccess(request);
  const [members, invitations] = await Promise.all([
    listMembers(getDb(), context),
    listInvitations(getDb(), context),
  ]);

  return apiSuccess({ members, invitations });
});

export const POST = withApi(async (request) => {
  assertCsrf(request);
  const context = await requireOrganizationAccess(request);

  enforceRateLimit(
    "invitation:org",
    context.organizationId,
    RATE_LIMITS.invitationPerOrganization.limit,
    RATE_LIMITS.invitationPerOrganization.windowMs,
  );

  const input = await parseJson(request, inviteSchema);
  const meta = requestMeta(request);
  const invitation = await inviteMember(getDb(), context, input, meta);

  // The raw token is returned exactly once. No email provider exists in
  // Phase 02, so the owner shares the link through their own channel.
  return apiSuccess(
    {
      invitationId: invitation.invitationId,
      email: invitation.email,
      role: invitation.role,
      expiresAt: invitation.expiresAt.toISOString(),
      invitePath: `/invite/${invitation.token}`,
    },
    201,
  );
});
