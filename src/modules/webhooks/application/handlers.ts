import type { Database } from "@/db/client";
import { AppError } from "@/lib/errors";
import { withTenantTransaction } from "@/db/tenant";
import type { WebhookEvent } from "@/db/schema";
import { recordAudit } from "@/modules/audit/infrastructure/audit-repository";
import { classifyEvent, findEventDefinition } from "@/modules/webhooks/domain/events";
import {
  disconnectConnection,
  findConnectionByStore,
} from "@/modules/integrations/salla/infrastructure/connection-repository";
import { updateStoreStatus } from "@/modules/stores/infrastructure/store-repository";
import { runResourceSync } from "@/modules/sync/application/sync-engine";

/**
 * Event → action.
 *
 * Handlers never trust the webhook body for domain state: an order event does
 * not carry a half-parsed order into the database, it triggers a refresh
 * through the same sync services the manual buttons use. That keeps ordering
 * irrelevant — the last run always reflects current provider state — and keeps
 * the Phase 05 allowlist as the only way order data is written.
 */

export interface HandlerContext {
  db: Database;
  event: WebhookEvent;
  organizationId: string;
  storeId: string;
}

export interface HandlerOutcome {
  action: string;
  detail?: Record<string, unknown>;
}

export async function handleWebhookEvent(context: HandlerContext): Promise<HandlerOutcome> {
  const { db, event, organizationId, storeId } = context;
  const decision = classifyEvent(event.eventName);
  // Kept next to the outcome so a deprecated event is visibly deprecated in the
  // audit trail instead of passing for a current one (ADR-052).
  const definition = findEventDefinition(event.eventName);

  switch (decision.kind) {
    case "sync": {
      const resources = [decision.resource, ...(decision.also ?? [])];
      const performed: Array<Record<string, unknown>> = [];

      for (const resource of resources) {
        const outcome = await runResourceSync({
          db,
          organizationId,
          storeId,
          resource,
          meta: { ipHash: null, userAgent: "salla-webhook", requestId: event.id },
          notBefore: event.receivedAt,
          trigger: "webhook",
        });

        if (outcome.action === "covered") {
          performed.push({ resource, covered: true, since: outcome.since });
          continue;
        }

        // A failed provider call is a failure of the event, not a partial
        // success: surfaces through the retry policy instead of a false `processed`.
        if (outcome.run.status === "failed") {
          throw new AppError({
            code: "INTEGRATION_ERROR",
            message: `Sync of ${resource} failed.`,
            details: { resource, runId: outcome.run.runId },
          });
        }

        performed.push({
          resource,
          runId: outcome.run.runId,
          items: outcome.run.items,
          pages: outcome.run.pages,
        });
      }

      return {
        action: "synced",
        detail: {
          resources: performed,
          lifecycle: definition?.lifecycle ?? "unknown",
          ...(definition?.deprecationNote ? { deprecationNote: definition.deprecationNote } : {}),
        },
      };
    }

    case "revoke_connection": {
      const result = await withTenantTransaction(db, { organizationId }, async (tx) => {
        const connection = await findConnectionByStore(tx, storeId);

        if (!connection) {
          return { action: "ignored", detail: { reason: "no_connection" } } as HandlerOutcome;
        }

        if (connection.status === "disconnected" || connection.status === "revoked") {
          return {
            action: "ignored",
            detail: { reason: "already_disconnected", status: connection.status },
          } as HandlerOutcome;
        }

        await disconnectConnection(tx, connection.id, new Date());
        await updateStoreStatus(tx, storeId, "not_connected");

        await recordAudit(tx, {
          organizationId,
          actorUserId: null,
          action: "salla.app.uninstalled",
          entityType: "store_connection",
          entityId: connection.id,
          metadata: {
            provider: "salla",
            source: "webhook",
            webhookEventId: event.id,
            // Historical rows are intentionally kept (ADR-050).
            dataRetained: true,
          },
        });

        return {
          action: "connection_revoked",
          detail: { connectionId: connection.id },
        } as HandlerOutcome;
      });

      return result;
    }

    case "record_authorization": {
      const scope = scopeFromEvent(event);

      await withTenantTransaction(db, { organizationId }, (tx) =>
        recordAudit(tx, {
          organizationId,
          actorUserId: null,
          action: "salla.app.authorized",
          entityType: "store",
          entityId: storeId,
          metadata: {
            provider: "salla",
            source: "webhook",
            webhookEventId: event.id,
            scope,
            // The OAuth callback remains the only writer of tokens; this event
            // is recorded, never applied (ADR-051).
            tokensApplied: false,
          },
        }),
      );

      return { action: "authorization_recorded", detail: { scope } };
    }

    case "record_app_update": {
      await withTenantTransaction(db, { organizationId }, (tx) =>
        recordAudit(tx, {
          organizationId,
          actorUserId: null,
          action: "salla.app.updated",
          entityType: "store",
          entityId: storeId,
          metadata: { provider: "salla", source: "webhook", webhookEventId: event.id },
        }),
      );

      return { action: "app_update_recorded" };
    }

    case "ignore":
    default:
      return {
        action: "ignored",
        detail: { reason: decision.kind === "ignore" ? decision.reason : "unknown_event" },
      };
  }
}

function scopeFromEvent(event: WebhookEvent): string | null {
  const data = event.payload?.data;
  if (!data || typeof data !== "object") return null;
  const scope = (data as Record<string, unknown>).scope;
  return typeof scope === "string" ? scope : null;
}
