import { getDb } from "@/db/client";
import {
  getCustomerIntelligence,
  periodRequestFromSearch,
} from "@/modules/intelligence/application/intelligence-service";
import { apiSuccess, withApi } from "@/server/api";
import { requireOrganizationAccess } from "@/server/session";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

interface RouteContext {
  params: Promise<{ storeId: string }>;
}

/**
 * Aggregate customer counts and repeat rate; no customer rows.
 *
 * Tenant resolution: session → organization → membership → store. The URL's
 * store id is verified against that organization; a foreign id is a 404, never
 * an empty dashboard.
 */
export const GET = withApi<RouteContext>(async (request, { params }) => {
  const { storeId } = await params;
  const context = await requireOrganizationAccess(request);
  const search = new URL(request.url).searchParams;

  const result = await getCustomerIntelligence(
    getDb(),
    context,
    storeId,
    periodRequestFromSearch(search),
  );

  return apiSuccess(result);
});
