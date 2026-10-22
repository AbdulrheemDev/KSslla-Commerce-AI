import { z } from "zod";

import { getDb } from "@/db/client";
import { AppError } from "@/lib/errors";
import {
  getStoreDataOverview,
  syncStoreData,
} from "@/modules/sync/application/store-data-sync-service";
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
  resource: z.enum(["all", "customers", "orders", "inventory"]).default("all"),
});

/**
 * Manual read sync for orders, customers, and inventory.
 *
 * The body chooses *what* to sync; *which* store is resolved from the session's
 * organization, never from the request. `store:sync` is enforced server-side, so
 * a read-only role cannot start a run. Every call is read-only towards Salla.
 */
export const POST = withApi<RouteContext>(async (request, { params }) => {
  assertCsrf(request);
  const { storeId } = await params;
  const context = await requirePermission(request, "store:sync");

  enforceRateLimit("data:sync", `${context.organizationId}:${storeId}`, 6, 10 * 60 * 1000);

  const payload = syncRequestSchema.safeParse(await request.json().catch(() => ({})));
  if (!payload.success) {
    throw new AppError({
      code: "VALIDATION_FAILED",
      message: "The requested sync resource is not supported.",
      details: { field: "resource" },
    });
  }

  const result = await syncStoreData(
    getDb(),
    context,
    { storeId, resource: payload.data.resource },
    requestMeta(request),
  );

  return apiSuccess(result);
});

/** Real counts and the five sync states for this store. */
export const GET = withApi<RouteContext>(async (request, { params }) => {
  const { storeId } = await params;
  const context = await requireOrganizationAccess(request);
  const overview = await getStoreDataOverview(getDb(), context, storeId);

  return apiSuccess(overview);
});
