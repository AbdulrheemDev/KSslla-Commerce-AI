import { getDb } from "@/db/client";
import { getProductOverview } from "@/modules/product-intelligence/application/product-intelligence-service";
import { apiSuccess, withApi } from "@/server/api";
import { requireOrganizationAccess } from "@/server/session";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

interface RouteContext {
  params: Promise<{ storeId: string }>;
}

/**
 * Catalogue-level product intelligence for one store.
 *
 * Read-only. Tenant resolution is session → organization → membership → store:
 * the URL's id is verified against the caller's organization inside the service,
 * so a foreign store is a 404 rather than an empty dashboard.
 */
export const GET = withApi<RouteContext>(async (request, { params }) => {
  const { storeId } = await params;
  const context = await requireOrganizationAccess(request);

  const result = await getProductOverview(getDb(), context, storeId);

  return apiSuccess(result);
});
