import { getDb } from "@/db/client";
import { getInventoryRecommendations } from "@/modules/inventory-intelligence/application/inventory-intelligence-service";
import { apiSuccess, withApi } from "@/server/api";
import { requireOrganizationAccess } from "@/server/session";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

interface RouteContext {
  params: Promise<{ storeId: string }>;
}

/**
 * Advisory recommendations derived from the issues. `advisoryOnly` is structural:
 * nothing here executes an inventory change, and no write route exists.
 */
export const GET = withApi<RouteContext>(async (request, { params }) => {
  const { storeId } = await params;
  const context = await requireOrganizationAccess(request);

  const result = await getInventoryRecommendations(getDb(), context, storeId);

  return apiSuccess(result);
});
