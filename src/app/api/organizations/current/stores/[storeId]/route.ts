import { getDb } from "@/db/client";
import { getStoreConnection } from "@/modules/integrations/salla/application/connection-service";
import { apiSuccess, withApi } from "@/server/api";
import { requireOrganizationAccess } from "@/server/session";
import { requireStoreAccess } from "@/modules/stores/application/store-service";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

interface RouteContext {
  params: Promise<{ storeId: string }>;
}

/**
 * The `storeId` is a request, never proof: it is resolved against the active
 * organization and a foreign id returns 404.
 */
export const GET = withApi<RouteContext>(async (request, { params }) => {
  const { storeId } = await params;
  const context = await requireOrganizationAccess(request);
  const db = getDb();
  const store = await requireStoreAccess(db, context, storeId);
  const connection = await getStoreConnection(db, context, storeId);

  return apiSuccess({
    store: {
      id: store.id,
      name: store.name,
      platform: store.platform,
      status: store.status,
    },
    connection,
  });
});
