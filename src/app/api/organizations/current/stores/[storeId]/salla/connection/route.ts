import { getDb } from "@/db/client";
import {
  disconnectSallaConnection,
  getStoreConnection,
} from "@/modules/integrations/salla/application/connection-service";
import { apiSuccess, withApi } from "@/server/api";
import { assertCsrf } from "@/server/csrf";
import { requestMeta } from "@/server/request-meta";
import { requireOrganizationAccess } from "@/server/session";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

interface RouteContext {
  params: Promise<{ storeId: string }>;
}

export const GET = withApi<RouteContext>(async (request, { params }) => {
  const { storeId } = await params;
  const context = await requireOrganizationAccess(request);
  const connection = await getStoreConnection(getDb(), context, storeId);
  return apiSuccess({ connection });
});

/**
 * Local disconnect.
 *
 * Credentials are destroyed and the internal store is preserved. This does not
 * uninstall the app inside Salla; no documented API call for that is used here.
 */
export const DELETE = withApi<RouteContext>(async (request, { params }) => {
  assertCsrf(request);
  const { storeId } = await params;
  const context = await requireOrganizationAccess(request);

  const connection = await disconnectSallaConnection(
    getDb(),
    context,
    storeId,
    requestMeta(request),
  );

  return apiSuccess({ connection });
});
