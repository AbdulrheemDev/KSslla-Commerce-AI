import { z } from "zod";

import { getDb } from "@/db/client";
import { AppError } from "@/lib/errors";
import { getCommerceOverview } from "@/modules/catalog/application/catalog-service";
import { syncStore } from "@/modules/catalog/application/sync-service";
import { apiSuccess, withApi } from "@/server/api";
import { assertCsrf } from "@/server/csrf";
import { enforceRateLimit } from "@/server/rate-limit";
import { requestMeta } from "@/server/request-meta";
import { requireOrganizationAccess, requirePermission } from "@/server/session";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 300;

interface RouteContext {
  params: Promise<{ storeId: string }>;
}

const syncRequestSchema = z.object({
  resource: z.enum(["all", "products", "categories"]).default("all"),
});

/**
 * Manual sync trigger.
 *
 * The body can only choose *what* to sync; *which* store is resolved from the
 * session's organization. `store:sync` is enforced server-side, so a Viewing
 * role cannot start a run.
 */
export const POST = withApi<RouteContext>(async (request, { params }) => {
  assertCsrf(request);
  const { storeId } = await params;
  const context = await requirePermission(request, "store:sync");

  enforceRateLimit("catalog:sync", `${context.organizationId}:${storeId}`, 6, 10 * 60 * 1000);

  const payload = syncRequestSchema.safeParse(await request.json().catch(() => ({})));
  if (!payload.success) {
    // A malformed body is a client error, never a success envelope.
    throw new AppError({
      code: "VALIDATION_FAILED",
      message: "The requested sync resource is not supported.",
      details: { field: "resource" },
    });
  }

  const result = await syncStore(
    getDb(),
    context,
    { storeId, resource: payload.data.resource },
    requestMeta(request),
  );

  return apiSuccess(result);
});

/** Current catalogue state for the store (counts + last runs). */
export const GET = withApi<RouteContext>(async (request, { params }) => {
  const { storeId } = await params;
  const context = await requireOrganizationAccess(request);
  const overview = await getCommerceOverview(getDb(), context, storeId);

  return apiSuccess(overview);
});
