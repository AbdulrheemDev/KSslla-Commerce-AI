import { getDb } from "@/db/client";
import { periodRequestFromSearch } from "@/modules/intelligence/application/intelligence-service";
import { getSalesAnomalies } from "@/modules/sales-intelligence/application/sales-intelligence-service";
import { apiSuccess, withApi } from "@/server/api";
import { requireOrganizationAccess } from "@/server/session";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

interface RouteContext {
  params: Promise<{ storeId: string }>;
}

/**
 * Deterministic anomalies plus the advisory alerts derived from them.
 *
 * Every item carries the observed value, the baseline, the threshold that fired,
 * and the evidence rows — no model, no narrative generated at request time.
 */
export const GET = withApi<RouteContext>(async (request, { params }) => {
  const { storeId } = await params;
  const context = await requireOrganizationAccess(request);
  const search = new URL(request.url).searchParams;

  const result = await getSalesAnomalies(
    getDb(),
    context,
    storeId,
    periodRequestFromSearch(search),
  );

  return apiSuccess(result);
});
