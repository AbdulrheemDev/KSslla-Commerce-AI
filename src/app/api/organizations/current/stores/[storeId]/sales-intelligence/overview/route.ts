import { getDb } from "@/db/client";
import { periodRequestFromSearch } from "@/modules/intelligence/application/intelligence-service";
import { getSalesOverview } from "@/modules/sales-intelligence/application/sales-intelligence-service";
import { apiSuccess, withApi } from "@/server/api";
import { requireOrganizationAccess } from "@/server/session";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

interface RouteContext {
  params: Promise<{ storeId: string }>;
}

/**
 * Sales overview for the requested window.
 *
 * Read-only. Tenant resolution is session → organization → membership → store:
 * the URL's id is verified against the caller's organization inside the service,
 * so a foreign store is a 404 rather than an empty dashboard.
 */
export const GET = withApi<RouteContext>(async (request, { params }) => {
  const { storeId } = await params;
  const context = await requireOrganizationAccess(request);
  const search = new URL(request.url).searchParams;

  const result = await getSalesOverview(getDb(), context, storeId, periodRequestFromSearch(search));

  return apiSuccess(result);
});
