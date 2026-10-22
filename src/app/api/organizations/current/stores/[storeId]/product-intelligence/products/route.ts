import { getDb } from "@/db/client";
import { getProductCatalog } from "@/modules/product-intelligence/application/product-intelligence-service";
import { catalogQueryFromSearch } from "@/modules/product-intelligence/application/query";
import { apiSuccess, withApi } from "@/server/api";
import { requireOrganizationAccess } from "@/server/session";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

interface RouteContext {
  params: Promise<{ storeId: string }>;
}

/**
 * Paged product health, worst first (severity, then lowest content score).
 * Query parameters: `page`, `pageSize` (≤ 100), `q` (name or SKU), `filter`.
 */
export const GET = withApi<RouteContext>(async (request, { params }) => {
  const { storeId } = await params;
  const context = await requireOrganizationAccess(request);
  const search = new URL(request.url).searchParams;

  const result = await getProductCatalog(getDb(), context, storeId, catalogQueryFromSearch(search));

  return apiSuccess(result);
});
