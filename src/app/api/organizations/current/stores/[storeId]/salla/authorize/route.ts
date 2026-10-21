import { getDb } from "@/db/client";
import { startSallaAuthorization } from "@/modules/integrations/salla/application/connection-service";
import { apiSuccess, withApi } from "@/server/api";
import { assertCsrf } from "@/server/csrf";
import { requestMeta } from "@/server/request-meta";
import { enforceRateLimit } from "@/server/rate-limit";
import { requirePermission } from "@/server/session";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

interface RouteContext {
  params: Promise<{ storeId: string }>;
}

/**
 * Starts the Salla authorization flow.
 *
 * The store id is resolved against the session's organization, `store:connect`
 * is enforced server-side, and the browser receives only the Salla URL. The
 * client secret and any token stay on the server.
 */
export const POST = withApi<RouteContext>(async (request, { params }) => {
  assertCsrf(request);
  const { storeId } = await params;
  const context = await requirePermission(request, "store:connect");

  enforceRateLimit("salla:authorize", `${context.organizationId}:${storeId}`, 10, 60 * 60 * 1000);

  const result = await startSallaAuthorization(getDb(), context, storeId, requestMeta(request));

  return apiSuccess({
    authorizationUrl: result.authorizationUrl,
    expiresAt: result.expiresAt.toISOString(),
  });
});
