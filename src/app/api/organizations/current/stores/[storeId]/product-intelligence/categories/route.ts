import { getDb } from "@/db/client";
import { getCategoryIntelligence } from "@/modules/product-intelligence/application/product-intelligence-service";
import { apiSuccess, withApi } from "@/server/api";
import { requireOrganizationAccess } from "@/server/session";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

interface RouteContext {
  params: Promise<{ storeId: string }>;
}

/**
 * Category catalogue health. Not sales performance: no reliable product-level
 * sales attribution exists, so the sales metric is reported as unavailable.
 */
export const GET = withApi<RouteContext>(async (request, { params }) => {
  const { storeId } = await params;
  const context = await requireOrganizationAccess(request);

  const result = await getCategoryIntelligence(getDb(), context, storeId);

  return apiSuccess(result);
});
