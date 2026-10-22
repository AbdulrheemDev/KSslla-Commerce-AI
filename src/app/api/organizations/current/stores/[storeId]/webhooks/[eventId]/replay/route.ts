import { after } from "next/server";

import { getDb } from "@/db/client";
import { logger } from "@/lib/logger";
import { drainWebhookEventsSafely } from "@/modules/webhooks/application/worker";
import { replayWebhookEvent } from "@/modules/webhooks/application/replay";
import { apiSuccess, withApi } from "@/server/api";
import { assertCsrf } from "@/server/csrf";
import { enforceRateLimit } from "@/server/rate-limit";
import { requestMeta } from "@/server/request-meta";
import { requirePermission } from "@/server/session";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 300;

interface RouteContext {
  params: Promise<{ storeId: string; eventId: string }>;
}

/**
 * Replays one webhook event.
 *
 * `store:sync` is the same permission that gates a manual sync, because a
 * replay performs exactly that work. The event must be visible in the caller's
 * tenant (RLS + the explicit lookup), so a foreign event id answers 404 rather
 * than existing.
 */
export const POST = withApi<RouteContext>(async (request, { params }) => {
  assertCsrf(request);
  const { storeId, eventId } = await params;
  const context = await requirePermission(request, "store:sync");

  enforceRateLimit("webhooks:replay", `${context.organizationId}:${storeId}`, 20, 10 * 60 * 1000);

  const result = await replayWebhookEvent(getDb(), context, eventId, requestMeta(request));

  try {
    // Same contract as the public endpoint: the replay is acknowledged first,
    // then the worker picks the re-opened row up.
    after(() => drainWebhookEventsSafely(getDb(), { limit: 5 }));
  } catch {
    logger.warn({ event: "webhook.drain_not_scheduled" }, "no request scope available for after()");
  }

  return apiSuccess(result);
});
