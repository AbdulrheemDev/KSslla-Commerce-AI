import { getDb } from "@/db/client";
import { listStoredCategories } from "@/modules/catalog/application/catalog-service";
import { apiSuccess, withApi } from "@/server/api";
import { requireOrganizationAccess } from "@/server/session";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

interface RouteContext {
  params: Promise<{ storeId: string }>;
}

/** Local list only: counts come from `product_categories`, never estimated. */
export const GET = withApi<RouteContext>(async (request, { params }) => {
  const { storeId } = await params;
  const context = await requireOrganizationAccess(request);
  const search = new URL(request.url).searchParams;

  const result = await listStoredCategories(getDb(), context, storeId, {
    page: Number(search.get("page") ?? "1"),
  });

  return apiSuccess(result);
});
