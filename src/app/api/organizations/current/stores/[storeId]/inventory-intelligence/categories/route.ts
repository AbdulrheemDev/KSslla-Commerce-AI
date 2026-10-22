import { getDb } from "@/db/client";
import { getInventoryCategories } from "@/modules/inventory-intelligence/application/inventory-intelligence-service";
import { apiSuccess, withApi } from "@/server/api";
import { requireOrganizationAccess } from "@/server/session";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

interface RouteContext {
  params: Promise<{ storeId: string }>;
}

/**
 * Inventory health per category: counts, coverage, and shares. No category sales
 * or turnover — the source has no product-level demand.
 */
export const GET = withApi<RouteContext>(async (request, { params }) => {
  const { storeId } = await params;
  const context = await requireOrganizationAccess(request);

  const result = await getInventoryCategories(getDb(), context, storeId);

  return apiSuccess(result);
});
