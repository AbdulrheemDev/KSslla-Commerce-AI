import { getDb } from "@/db/client";
import { periodRequestFromSearch } from "@/modules/intelligence/application/intelligence-service";
import { getSalesDiscounts } from "@/modules/sales-intelligence/application/sales-intelligence-service";
import { apiSuccess, withApi } from "@/server/api";
import { requireOrganizationAccess } from "@/server/session";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

interface RouteContext {
  params: Promise<{ storeId: string }>;
}

/**
 * Discount analysis — currently `unavailable` by design.
 *
 * List Orders (the mirrored endpoint) returns no discount fields, and Order
 * Details is not stored. The response names the gap (`discount_not_mirrored`)
 * together with where the real data lives, instead of deriving a percentage from
 * a price difference or returning a zero that would read as "no discounts".
 */
export const GET = withApi<RouteContext>(async (request, { params }) => {
  const { storeId } = await params;
  const context = await requireOrganizationAccess(request);
  const search = new URL(request.url).searchParams;

  const result = await getSalesDiscounts(
    getDb(),
    context,
    storeId,
    periodRequestFromSearch(search),
  );

  return apiSuccess(result);
});
