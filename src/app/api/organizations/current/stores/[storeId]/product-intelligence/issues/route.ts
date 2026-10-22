import { getDb } from "@/db/client";
import { getIssueRanking } from "@/modules/product-intelligence/application/product-intelligence-service";
import { apiSuccess, withApi } from "@/server/api";
import { requireOrganizationAccess } from "@/server/session";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

interface RouteContext {
  params: Promise<{ storeId: string }>;
}

/** Issues ranked by `affectedCount × severity weight`, with the rule and evidence. */
export const GET = withApi<RouteContext>(async (request, { params }) => {
  const { storeId } = await params;
  const context = await requireOrganizationAccess(request);

  const result = await getIssueRanking(getDb(), context, storeId);

  return apiSuccess(result);
});
