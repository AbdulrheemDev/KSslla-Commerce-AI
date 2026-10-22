import { after } from "next/server";
import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

import { getDb } from "@/db/client";
import { logger } from "@/lib/logger";
import { ingestSallaWebhook } from "@/modules/webhooks/application/ingest";
import { drainWebhookEventsSafely } from "@/modules/webhooks/application/worker";
import { requestMeta } from "@/server/request-meta";

export const dynamic = "force-dynamic";

/**
 * Schedules the inbox drain for after the response.
 *
 * `after()` only exists inside a Next request scope. When this handler is
 * invoked directly (integration tests do exactly that, with no HTTP server),
 * there is no scope to attach to, so the drain is skipped instead of running
 * inside the request — the worker is then driven explicitly by the caller.
 * Production traffic always arrives through Next and therefore always has a
 * scope.
 */
function scheduleDrain(): void {
  try {
    after(() => drainWebhookEventsSafely(getDb(), { limit: 10 }));
  } catch {
    logger.warn({ event: "webhook.drain_not_scheduled" }, "no request scope available for after()");
  }
}
export const runtime = "nodejs";

/** Orders can be large; still bounded so a bad actor cannot stream a payload. */
const MAX_BODY_BYTES = 256 * 1024;

const NO_STORE = { "Cache-Control": "no-store" } as const;

function failure(status: number, code: string, message: string) {
  return NextResponse.json({ error: { code, message } }, { status, headers: NO_STORE });
}

/**
 * Salla webhook endpoint.
 *
 * Public by design: no session, no cookie, no CSRF token, and **no tenant
 * identifier from the client**. Trust comes only from the signature over the raw
 * body; the store is resolved server-side from the verified payload's merchant
 * id through `store_connections`.
 *
 * The handler does exactly four things — read the raw body, verify, persist,
 * acknowledge — and schedules the worker after the response. A slow sync here
 * would make Salla time out and redeliver (docs/salla-reference §14.5).
 */
export async function POST(request: NextRequest): Promise<NextResponse> {
  const startedAt = Date.now();
  const meta = requestMeta(request);

  // Cheap rejection before reading anything: declared length first.
  const declaredLength = Number(request.headers.get("content-length") ?? "0");
  if (Number.isFinite(declaredLength) && declaredLength > MAX_BODY_BYTES) {
    logger.warn({ event: "webhook.rejected", reason: "body_too_large", requestId: meta.requestId });
    return failure(413, "WEBHOOK_PAYLOAD_TOO_LARGE", "Webhook payload is too large.");
  }

  const contentType = request.headers.get("content-type") ?? "";
  if (!contentType.toLowerCase().includes("application/json")) {
    logger.warn({ event: "webhook.rejected", reason: "unsupported_media_type" });
    return failure(415, "WEBHOOK_UNSUPPORTED_MEDIA_TYPE", "Webhook payload must be JSON.");
  }

  // The raw text is what the signature covers. Never `request.json()` here:
  // parsing first and re-serialising afterwards would verify a different body.
  const rawBody = await request.text();

  if (Buffer.byteLength(rawBody, "utf8") > MAX_BODY_BYTES) {
    logger.warn({ event: "webhook.rejected", reason: "body_too_large" });
    return failure(413, "WEBHOOK_PAYLOAD_TOO_LARGE", "Webhook payload is too large.");
  }

  try {
    const outcome = await ingestSallaWebhook(getDb(), {
      rawBody,
      headers: request.headers,
    });

    if (outcome.status === "rejected") {
      if (outcome.reason === "not_configured") {
        // Honest: without a secret we cannot accept anything, and pretending
        // otherwise would mean trusting an unverified body.
        return failure(
          503,
          "WEBHOOK_NOT_CONFIGURED",
          "Webhook receiving is not configured on this deployment.",
        );
      }

      // The signature verified, so the caller is authentic; the body is simply
      // not a Salla envelope. 400 is the honest answer and leaks nothing about
      // which field failed.
      if (outcome.reason === "invalid_payload") {
        return failure(400, "WEBHOOK_INVALID_PAYLOAD", "Webhook payload is invalid.");
      }

      return failure(401, "WEBHOOK_UNAUTHORIZED", "Unauthorized webhook.");
    }

    // Processing happens after the response, in the worker.
    scheduleDrain();

    logger.info(
      {
        event: "webhook.acknowledged",
        webhookEventId: outcome.eventId,
        eventName: outcome.eventName,
        duplicate: outcome.duplicate,
        tracked: outcome.tracked,
        status: 200,
        durationMs: Date.now() - startedAt,
        requestId: meta.requestId,
      },
      "salla webhook acknowledged",
    );

    return NextResponse.json(
      { received: true, duplicate: outcome.duplicate },
      { status: 200, headers: NO_STORE },
    );
  } catch (error) {
    // A storage failure is ours, not Salla's payload's: 500 makes Salla retry,
    // which is the correct behaviour for a transient database problem.
    logger.error(
      {
        event: "webhook.ingest_failed",
        errorName: error instanceof Error ? error.name : "Unknown",
        durationMs: Date.now() - startedAt,
      },
      "salla webhook could not be persisted",
    );

    return failure(500, "WEBHOOK_FAILED", "Webhook could not be processed.");
  }
}
