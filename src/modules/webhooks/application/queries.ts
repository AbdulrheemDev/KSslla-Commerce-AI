import type { Database } from "@/db/client";
import { withTenantTransaction } from "@/db/tenant";
import type { TenantContext } from "@/modules/identity/application/types";
import { requireStoreAccess } from "@/modules/stores/application/store-service";
import {
  countEventsByStatus,
  listEvents,
} from "@/modules/webhooks/infrastructure/event-repository";
import type { WebhookEventStatus } from "@/modules/webhooks/domain/status";

/**
 * Read side of the inbox.
 *
 * Store access is checked first, and the query itself runs under RLS, so a
 * caller cannot see events of a store they cannot read even if they guess an id.
 */

export interface WebhookEventView {
  id: string;
  eventName: string;
  status: WebhookEventStatus;
  attemptCount: number;
  receivedAt: string;
  processedAt: string | null;
  lastErrorCode: string | null;
  lastErrorMessage: string | null;
  action: string | null;
  storeId: string | null;
}

export interface WebhookOverview {
  counts: Record<WebhookEventStatus, number>;
  total: number;
  events: WebhookEventView[];
  lastReceivedAt: string | null;
}

const ZERO_COUNTS: Record<WebhookEventStatus, number> = {
  received: 0,
  processing: 0,
  processed: 0,
  failed: 0,
  dead_letter: 0,
  unmatched: 0,
  ignored: 0,
};

export async function getWebhookOverview(
  db: Database,
  context: TenantContext,
  storeId: string,
  options: { limit?: number } = {},
): Promise<WebhookOverview> {
  await requireStoreAccess(db, context, storeId);

  return withTenantTransaction(
    db,
    { userId: context.userId, organizationId: context.organizationId },
    async (tx) => {
      const [counts, rows] = await Promise.all([
        countEventsByStatus(tx, storeId),
        listEvents(tx, { storeId, limit: Math.min(Math.max(options.limit ?? 25, 1), 100) }),
      ]);

      const countsByStatus = { ...ZERO_COUNTS };
      for (const row of counts) countsByStatus[row.status] = row.total;

      const total = rows.length;
      const events = rows.map((row) => ({
        id: row.id,
        eventName: row.eventName,
        status: row.status as WebhookEventStatus,
        attemptCount: row.attemptCount,
        receivedAt: row.receivedAt.toISOString(),
        processedAt: row.processedAt ? row.processedAt.toISOString() : null,
        lastErrorCode: row.lastErrorCode,
        lastErrorMessage: row.lastErrorMessage,
        action: typeof row.result?.action === "string" ? row.result.action : null,
        storeId: row.storeId,
      }));

      return {
        counts: countsByStatus,
        total,
        events,
        lastReceivedAt: events[0]?.receivedAt ?? null,
      };
    },
  );
}
