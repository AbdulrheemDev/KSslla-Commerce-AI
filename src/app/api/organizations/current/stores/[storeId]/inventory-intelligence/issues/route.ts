import { getDb } from "@/db/client";
import { getInventoryIssues } from "@/modules/inventory-intelligence/application/inventory-intelligence-service";
import { apiSuccess, withApi } from "@/server/api";
import { requireOrganizationAccess } from "@/server/session";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

interface RouteContext {
  params: Promise<{ storeId: string }>;
}

/**
 * Every inventory issue that fired, ranked deterministically.
 */
export const GET = withApi<RouteContext>(async (request, { params }) => {
  const { storeId } = await params;
  const context = await requireOrganizationAccess(request);

  const result = await getInventoryIssues(getDb(), context, storeId);

  return apiSuccess(result);
});
