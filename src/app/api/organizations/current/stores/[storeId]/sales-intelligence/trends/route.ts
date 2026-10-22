import { getDb } from "@/db/client";
import { periodRequestFromSearch } from "@/modules/intelligence/application/intelligence-service";
import { granularityFromSearch } from "@/modules/sales-intelligence/application/query";
import { getSalesTrends } from "@/modules/sales-intelligence/application/sales-intelligence-service";
import { apiSuccess, withApi } from "@/server/api";
import { requireOrganizationAccess } from "@/server/session";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

interface RouteContext {
  params: Promise<{ storeId: string }>;
}

/**
 * Chartable sales series: `?granularity=day|week|month`.
 *
 * Buckets are UTC-aligned. A bucket that predates the stored history reports
 * `unavailable` with a reason instead of a zero, so the chart can break the line
 * rather than draw a fall that never happened.
 */
export const GET = withApi<RouteContext>(async (request, { params }) => {
  const { storeId } = await params;
  const context = await requireOrganizationAccess(request);
  const search = new URL(request.url).searchParams;

  const result = await getSalesTrends(
    getDb(),
    context,
    storeId,
    periodRequestFromSearch(search),
    granularityFromSearch(search),
  );

  return apiSuccess(result);
});
