import { getDb } from "@/db/client";
import {
  changeMemberRole,
  removeMember,
} from "@/modules/organizations/application/membership-service";
import { apiSuccess, withApi } from "@/server/api";
import { assertCsrf } from "@/server/csrf";
import { requestMeta } from "@/server/request-meta";
import { changeRoleSchema } from "@/server/schemas";
import { requireOrganizationAccess } from "@/server/session";
import { parseJson } from "@/server/validation";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

interface RouteContext {
  params: Promise<{ membershipId: string }>;
}

export const PATCH = withApi<RouteContext>(async (request, { params }) => {
  assertCsrf(request);
  const { membershipId } = await params;
  const context = await requireOrganizationAccess(request);
  const input = await parseJson(request, changeRoleSchema);

  await changeMemberRole(getDb(), context, membershipId, input.role, requestMeta(request));

  return apiSuccess({ updated: true });
});

export const DELETE = withApi<RouteContext>(async (request, { params }) => {
  assertCsrf(request);
  const { membershipId } = await params;
  const context = await requireOrganizationAccess(request);

  await removeMember(getDb(), context, membershipId, requestMeta(request));

  return apiSuccess({ removed: true });
});
