import { getDb } from "@/db/client";
import { getInventoryOverview } from "@/modules/inventory-intelligence/application/inventory-intelligence-service";
import { apiSuccess, withApi } from "@/server/api";
import { requireOrganizationAccess } from "@/server/session";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

interface RouteContext {
  params: Promise<{ storeId: string }>;
}

/**
 * Inventory overview for one store: coverage, stock counts, health score, the
 * ranked issues, and the metrics that are deliberately unavailable.
 *
 * Read-only. Tenant resolution is session → organization → membership → store:
 * the URL's id is verified against the caller's organization inside the service,
 * so a foreign store is a 404 rather than an empty dashboard.
 */
export const GET = withApi<RouteContext>(async (request, { params }) => {
  const { storeId } = await params;
  const context = await requireOrganizationAccess(request);

  const result = await getInventoryOverview(getDb(), context, storeId);

  return apiSuccess(result);
});
