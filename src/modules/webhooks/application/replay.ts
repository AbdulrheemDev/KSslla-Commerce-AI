import type { Database } from "@/db/client";
import { withTenantTransaction } from "@/db/tenant";
import { AppError } from "@/lib/errors";
import type { TenantContext } from "@/modules/identity/application/types";
import { recordAudit } from "@/modules/audit/infrastructure/audit-repository";
import {
  findEventById,
  resetEventForReplay,
} from "@/modules/webhooks/infrastructure/event-repository";
import { REPLAYABLE_STATUSES, type WebhookEventStatus } from "@/modules/webhooks/domain/status";

/**
 * Manual replay.
 *
 * Tenant-scoped by construction: the row is read inside the caller's tenant
 * transaction, so an event that belongs to another organization is simply "not
 * found" — the same answer as a nonexistent id (ADR-045).
 *
 * A replay is an explicit operator action, so it is the only path that resets a
 * terminal row, and it is audited with the acting user.
 */
export async function replayWebhookEvent(
  db: Database,
  context: TenantContext,
  eventId: string,
  meta: { ipHash?: string | null; userAgent?: string | null; requestId?: string | null },
): Promise<{ eventId: string; status: WebhookEventStatus }> {
  if (!context.permissions.includes("store:sync")) {
    throw new AppError({
      code: "FORBIDDEN",
      message: "You do not have permission to replay webhook events.",
      details: { permission: "store:sync" },
    });
  }

  return withTenantTransaction(
    db,
    { userId: context.userId, organizationId: context.organizationId },
    async (tx) => {
      const event = await findEventById(tx, eventId);

      if (!event) {
        throw new AppError({ code: "NOT_FOUND", message: "Webhook event not found." });
      }

      if (!REPLAYABLE_STATUSES.includes(event.status as WebhookEventStatus)) {
        throw new AppError({
          code: "CONFLICT",
          message: "This webhook event cannot be replayed in its current state.",
          details: { status: event.status },
        });
      }

      if (event.status === "processing") {
        throw new AppError({
          code: "CONFLICT",
          message: "This webhook event is being processed right now.",
          details: { status: event.status },
        });
      }

      await resetEventForReplay(tx, event.id, new Date());

      await recordAudit(tx, {
        organizationId: context.organizationId,
        actorUserId: context.userId,
        action: "webhook.replayed",
        entityType: "webhook_event",
        entityId: event.id,
        metadata: {
          eventName: event.eventName,
          previousStatus: event.status,
          previousAttempts: event.attemptCount,
        },
        ipHash: meta.ipHash ?? null,
        userAgent: meta.userAgent ?? null,
        requestId: meta.requestId ?? null,
      });

      return { eventId: event.id, status: "received" as const };
    },
  );
}
