import { getDb } from "@/db/client";
import { getOrganizationOverview } from "@/modules/organizations/application/organization-service";
import { apiSuccess, withApi } from "@/server/api";
import { requireOrganizationAccess } from "@/server/session";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export const GET = withApi(async (request) => {
  const context = await requireOrganizationAccess(request);
  const overview = await getOrganizationOverview(getDb(), context);
  return apiSuccess(overview);
});
