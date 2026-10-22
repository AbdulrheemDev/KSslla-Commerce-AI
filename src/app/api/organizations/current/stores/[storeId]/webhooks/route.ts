import { getDb } from "@/db/client";
import { getWebhookOverview } from "@/modules/webhooks/application/queries";
import { apiSuccess, withApi } from "@/server/api";
import { requirePermission } from "@/server/session";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

interface RouteContext {
  params: Promise<{ storeId: string }>;
}

/**
 * Recent webhook deliveries for one store.
 *
 * Scoped by the store access check and by RLS; the store id comes from the
 * path, but only after `requireStoreAccess` proves the caller's organization
 * owns it.
 */
export const GET = withApi<RouteContext>(async (request, { params }) => {
  const { storeId } = await params;
  const context = await requirePermission(request, "store:read");
  const overview = await getWebhookOverview(getDb(), context, storeId);

  return apiSuccess(overview);
});
