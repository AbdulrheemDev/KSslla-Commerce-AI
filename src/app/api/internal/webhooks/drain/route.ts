import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

import { getDb } from "@/db/client";
import { getServerEnv } from "@/lib/env";
import { logger } from "@/lib/logger";
import { drainWebhookEvents } from "@/modules/webhooks/application/worker";
import { safeEqualString } from "@/modules/webhooks/domain/signature";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;

const NO_STORE = { "Cache-Control": "no-store" } as const;

/**
 * Worker pump for scheduled invocations.
 *
 * A delivery acknowledges and schedules its own processing, and a retry becomes
 * due a minute or five later — long after that request has ended. Something has
 * to come back for it. This endpoint is that "something": point any external
 * cron at it and the queue drains on schedule.
 *
 * It is deliberately not part of the public webhook surface: it requires a
 * bearer token and answers 404 when none is configured, so an unconfigured
 * deployment exposes no endpoint at all rather than an open one.
 */
export async function POST(request: NextRequest): Promise<NextResponse> {
  const expected = getServerEnv().WEBHOOK_WORKER_TOKEN;

  if (!expected) {
    return NextResponse.json(
      { error: { code: "NOT_FOUND", message: "Not found." } },
      { status: 404, headers: NO_STORE },
    );
  }

  const header = request.headers.get("authorization") ?? "";
  const provided = header.toLowerCase().startsWith("bearer ") ? header.slice(7).trim() : "";

  if (!provided || !safeEqualString(expected, provided)) {
    logger.warn({ event: "webhook.drain_unauthorized" }, "worker drain rejected");
    return NextResponse.json(
      { error: { code: "UNAUTHENTICATED", message: "Unauthenticated." } },
      { status: 401, headers: NO_STORE },
    );
  }

  const result = await drainWebhookEvents(getDb(), { limit: 25 });

  logger.info({ event: "webhook.drained", ...result }, "webhook worker drained on request");

  return NextResponse.json({ data: result }, { status: 200, headers: NO_STORE });
}
