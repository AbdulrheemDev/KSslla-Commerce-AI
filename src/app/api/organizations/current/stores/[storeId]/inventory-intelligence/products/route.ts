import { getDb } from "@/db/client";
import { getInventoryProducts } from "@/modules/inventory-intelligence/application/inventory-intelligence-service";
import { inventoryQueryFromSearch } from "@/modules/inventory-intelligence/application/query";
import { apiSuccess, withApi } from "@/server/api";
import { requireOrganizationAccess } from "@/server/session";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

interface RouteContext {
  params: Promise<{ storeId: string }>;
}

/**
 * Paged per-product inventory, most urgent first (severity, then out of stock,
 * low stock, unknown, in stock, unlimited, then lowest quantity).
 * Query parameters: `page`, `pageSize` (≤ 100), `q` (name or SKU), `filter`.
 */
export const GET = withApi<RouteContext>(async (request, { params }) => {
  const { storeId } = await params;
  const context = await requireOrganizationAccess(request);
  const search = new URL(request.url).searchParams;

  const result = await getInventoryProducts(
    getDb(),
    context,
    storeId,
    inventoryQueryFromSearch(search),
  );

  return apiSuccess(result);
});
