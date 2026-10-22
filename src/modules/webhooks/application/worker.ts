import { sql } from "drizzle-orm";

import type { Database } from "@/db/client";
import { withTenantTransaction } from "@/db/tenant";
import { logger } from "@/lib/logger";
import { isAppError } from "@/lib/errors";
import { recordAudit } from "@/modules/audit/infrastructure/audit-repository";
import {
  claimEvents,
  findEventById,
  markEventDeadLettered,
  markEventFailed,
  markEventIgnored,
  markProcessingEventProcessed,
} from "@/modules/webhooks/infrastructure/event-repository";
import { decideAfterFailure, isRetryableErrorCode } from "@/modules/webhooks/domain/retry";
import { handleWebhookEvent } from "@/modules/webhooks/application/handlers";

/**
 * Webhook worker.
 *
 * The HTTP request never runs a sync. It verifies, persists, acknowledges, and
 * schedules this worker with `after()`. The worker drains the inbox with
 * `SELECT … FOR UPDATE SKIP LOCKED`, so two workers (or two server instances)
 * can run at the same time and each row is processed once (ADR-046).
 *
 * The claim runs in a dedicated connection context (`app.webhook_worker`), which
 * is the only context that can see rows across tenants. Every subsequent read
 * and write for a claimed row happens inside that row's tenant transaction, so
 * business data is still described by RLS and not by the worker's reach.
 */

export const WEBHOOK_LEASE_SECONDS = 120;

export interface DrainResult {
  claimed: number;
  processed: number;
  ignored: number;
  failed: number;
  deadLettered: number;
  skipped: number;
}

export interface DrainOptions {
  limit?: number;
  now?: Date;
  leaseSeconds?: number;
}

const EMPTY_RESULT: DrainResult = {
  claimed: 0,
  processed: 0,
  ignored: 0,
  failed: 0,
  deadLettered: 0,
  skipped: 0,
};

export async function drainWebhookEvents(
  db: Database,
  options: DrainOptions = {},
): Promise<DrainResult> {
  const limit = Math.min(Math.max(options.limit ?? 10, 1), 50);
  const now = options.now ?? new Date();
  const leaseSeconds = options.leaseSeconds ?? WEBHOOK_LEASE_SECONDS;

  const claimed = await db.transaction(async (tx) => {
    await tx.execute(sql`select set_config('app.webhook_worker', 'on', true)`);
    return claimEvents(tx, { limit, leaseSeconds });
  });

  if (claimed.length === 0) return { ...EMPTY_RESULT };

  const result: DrainResult = { ...EMPTY_RESULT, claimed: claimed.length };

  for (const claim of claimed) {
    const outcome = await processEvent(db, claim, now);

    switch (outcome) {
      case "processed":
        result.processed += 1;
        break;
      case "ignored":
        result.ignored += 1;
        break;
      case "failed":
        result.failed += 1;
        break;
      case "dead_letter":
        result.deadLettered += 1;
        break;
      default:
        result.skipped += 1;
    }
  }

  return result;
}

type ProcessOutcome = "processed" | "ignored" | "failed" | "dead_letter" | "skipped";

/**
 * Processes one claimed event.
 *
 * Three boundaries, deliberately: load (tenant tx) → act (no transaction held
 * across network calls) → record (tenant tx). An event is never marked
 * `processed` before the work it describes actually succeeded.
 */
async function processEvent(
  db: Database,
  claim: { id: string; organizationId: string },
  now: Date,
): Promise<ProcessOutcome> {
  const startedAt = Date.now();

  const event = await withTenantTransaction(db, { organizationId: claim.organizationId }, (tx) =>
    findEventById(tx, claim.id),
  );

  if (!event) {
    logger.warn(
      { webhookEventId: claim.id, organizationId: claim.organizationId },
      "claimed webhook event not visible in its tenant",
    );
    return "skipped";
  }

  if (event.status !== "processing") {
    // Someone replayed or resolved it between claim and read.
    return "skipped";
  }

  const organizationId = event.organizationId ?? claim.organizationId;
  const storeId = event.storeId;

  if (!storeId) {
    await withTenantTransaction(db, { organizationId }, (tx) =>
      markEventIgnored(tx, event.id, "no_store", now),
    );
    return "ignored";
  }

  try {
    const outcome = await handleWebhookEvent({ db, event, organizationId, storeId });

    const isIgnored = outcome.action === "ignored";

    await withTenantTransaction(db, { organizationId }, async (tx) => {
      if (isIgnored) {
        await markEventIgnored(tx, event.id, String(outcome.detail?.reason ?? "ignored"), now);
      } else {
        await markProcessingEventProcessed(tx, event.id, { ...outcome }, now);
      }

      await recordAudit(tx, {
        organizationId,
        actorUserId: null,
        action: isIgnored ? "webhook.processed" : "webhook.processed",
        entityType: "webhook_event",
        entityId: event.id,
        metadata: {
          eventName: event.eventName,
          action: outcome.action,
          attempt: event.attemptCount,
          durationMs: Date.now() - startedAt,
        },
      });
    });

    logger.info(
      {
        event: "webhook.processed",
        organizationId,
        storeId,
        webhookEventId: event.id,
        eventName: event.eventName,
        action: outcome.action,
        attempt: event.attemptCount,
        durationMs: Date.now() - startedAt,
      },
      "salla webhook processed",
    );

    return isIgnored ? "ignored" : "processed";
  } catch (error) {
    const code = isAppError(error) ? error.code : "INTERNAL";
    const message = isAppError(error) ? error.message : "Unexpected error";

    const retryable = isRetryableErrorCode(code);
    const decision = decideAfterFailure(event.attemptCount, now, retryable);

    await withTenantTransaction(db, { organizationId }, async (tx) => {
      if (decision.status === "dead_letter") {
        await markEventDeadLettered(tx, event.id, { code, message }, now);
      } else {
        await markEventFailed(
          tx,
          event.id,
          { code, message, availableAt: decision.availableAt },
          now,
        );
      }

      await recordAudit(tx, {
        organizationId,
        actorUserId: null,
        action: decision.status === "dead_letter" ? "webhook.dead_letter" : "webhook.failed",
        entityType: "webhook_event",
        entityId: event.id,
        metadata: {
          eventName: event.eventName,
          errorCode: code,
          attempt: event.attemptCount,
          retryable,
          nextAttemptAt: decision.status === "failed" ? decision.availableAt.toISOString() : null,
        },
      });
    });

    logger.warn(
      {
        event: "webhook.failed",
        organizationId,
        storeId,
        webhookEventId: event.id,
        eventName: event.eventName,
        errorCode: code,
        attempt: event.attemptCount,
        retryable,
        status: decision.status,
        durationMs: Date.now() - startedAt,
      },
      "salla webhook processing failed",
    );

    return decision.status === "dead_letter" ? "dead_letter" : "failed";
  }
}

/**
 * Fire-and-forget drain for the request path.
 *
 * Errors are swallowed after logging: a worker failure must never turn an
 * already-acknowledged delivery into a 500 that makes Salla redeliver it.
 */
export async function drainWebhookEventsSafely(
  db: Database,
  options: DrainOptions = {},
): Promise<void> {
  try {
    await drainWebhookEvents(db, options);
  } catch (error) {
    logger.error(
      {
        event: "webhook.worker_failed",
        errorName: error instanceof Error ? error.name : "Unknown",
      },
      "webhook worker drain failed",
    );
  }
}
