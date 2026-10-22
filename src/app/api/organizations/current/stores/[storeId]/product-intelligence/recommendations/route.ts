import { getDb } from "@/db/client";
import { getRecommendations } from "@/modules/product-intelligence/application/product-intelligence-service";
import { apiSuccess, withApi } from "@/server/api";
import { requireOrganizationAccess } from "@/server/session";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

interface RouteContext {
  params: Promise<{ storeId: string }>;
}

/**
 * Rule-based, advisory-only recommendations. No AI, no write path: each item
 * carries the rule that fired, the affected count, and example products.
 */
export const GET = withApi<RouteContext>(async (request, { params }) => {
  const { storeId } = await params;
  const context = await requireOrganizationAccess(request);

  const result = await getRecommendations(getDb(), context, storeId);

  return apiSuccess(result);
});
