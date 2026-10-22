import { and, count, desc, eq, inArray, sql } from "drizzle-orm";

import type { DbExecutor } from "@/db/executor";
import { webhookEvents, type WebhookEvent } from "@/db/schema";
import type { WebhookEventStatus } from "@/modules/webhooks/domain/status";

/**
 * Inbox persistence.
 *
 * Every function takes the executor it is given — a tenant transaction for
 * tenant-scoped work, a worker transaction for claims — so RLS decides what is
 * visible instead of this layer trusting a caller-supplied filter.
 */

export interface InsertEventInput {
  organizationId: string | null;
  storeId: string | null;
  eventName: string;
  eventVersion: number | null;
  externalStoreId: string;
  signatureStrategy: string;
  payloadHash: string;
  payload: Record<string, unknown>;
  status: WebhookEventStatus;
}

export interface InsertEventResult {
  /** `null` only when a duplicate body exists but is not visible in this scope. */
  id: string | null;
  duplicate: boolean;
}

/**
 * Inserts a delivery, or returns the existing row for the same body.
 *
 * The unique `(provider, payload_hash)` index is the idempotency guarantee;
 * the `on conflict do nothing` + select pair keeps the call race-safe when two
 * identical deliveries arrive at the same time.
 */
export async function insertEvent(
  db: DbExecutor,
  input: InsertEventInput,
): Promise<InsertEventResult> {
  const [inserted] = await db
    .insert(webhookEvents)
    .values({
      organizationId: input.organizationId,
      storeId: input.storeId,
      provider: "salla",
      eventName: input.eventName,
      eventVersion: input.eventVersion,
      externalStoreId: input.externalStoreId,
      signatureStrategy: input.signatureStrategy,
      payloadHash: input.payloadHash,
      payload: input.payload,
      status: input.status,
    })
    .onConflictDoNothing({ target: [webhookEvents.provider, webhookEvents.payloadHash] })
    .returning({ id: webhookEvents.id });

  if (inserted) return { id: inserted.id, duplicate: false };

  const [existing] = await db
    .select({ id: webhookEvents.id })
    .from(webhookEvents)
    .where(
      and(eq(webhookEvents.provider, "salla"), eq(webhookEvents.payloadHash, input.payloadHash)),
    )
    .limit(1);

  // A conflicting row can legitimately be invisible here: the first delivery
  // may have been stored unresolved (`organization_id IS NULL`) and this one
  // resolved, or vice versa. It is still the same body, so it is a duplicate.
  return { id: existing?.id ?? null, duplicate: true };
}

export async function findEventById(db: DbExecutor, id: string): Promise<WebhookEvent | undefined> {
  const [row] = await db.select().from(webhookEvents).where(eq(webhookEvents.id, id)).limit(1);
  return row;
}

export async function markProcessingEventProcessed(
  db: DbExecutor,
  id: string,
  result: Record<string, unknown>,
  at: Date,
): Promise<void> {
  await db
    .update(webhookEvents)
    .set({
      status: "processed",
      processedAt: at,
      processingStartedAt: null,
      lastErrorCode: null,
      lastErrorMessage: null,
      result,
      updatedAt: at,
    })
    .where(eq(webhookEvents.id, id));
}

export async function markEventIgnored(
  db: DbExecutor,
  id: string,
  reason: string,
  at: Date,
): Promise<void> {
  await db
    .update(webhookEvents)
    .set({
      status: "ignored",
      processedAt: at,
      processingStartedAt: null,
      result: { action: "ignored", reason },
      updatedAt: at,
    })
    .where(eq(webhookEvents.id, id));
}

export async function markEventFailed(
  db: DbExecutor,
  id: string,
  input: { code: string; message: string; availableAt: Date },
  at: Date,
): Promise<void> {
  await db
    .update(webhookEvents)
    .set({
      status: "failed",
      failedAt: at,
      processingStartedAt: null,
      availableAt: input.availableAt,
      lastErrorCode: input.code,
      lastErrorMessage: input.message,
      updatedAt: at,
    })
    .where(eq(webhookEvents.id, id));
}

export async function markEventDeadLettered(
  db: DbExecutor,
  id: string,
  input: { code: string; message: string },
  at: Date,
): Promise<void> {
  await db
    .update(webhookEvents)
    .set({
      status: "dead_letter",
      failedAt: at,
      processingStartedAt: null,
      lastErrorCode: input.code,
      lastErrorMessage: input.message,
      updatedAt: at,
    })
    .where(eq(webhookEvents.id, id));
}

/**
 * Re-opens a terminal row for an explicit replay.
 *
 * `attemptCount` is reset because a replay starts a new attempt series; the
 * audit entry is written by the caller, so the reset is never anonymous.
 */
export async function resetEventForReplay(db: DbExecutor, id: string, at: Date): Promise<void> {
  await db
    .update(webhookEvents)
    .set({
      status: "received",
      attemptCount: 0,
      availableAt: at,
      processingStartedAt: null,
      processedAt: null,
      failedAt: null,
      lastErrorCode: null,
      lastErrorMessage: null,
      result: null,
      updatedAt: at,
    })
    .where(eq(webhookEvents.id, id));
}

export interface EventListFilters {
  storeId?: string | null;
  status?: WebhookEventStatus[];
  limit: number;
}

export async function listEvents(db: DbExecutor, filters: EventListFilters) {
  const conditions = [];
  if (filters.storeId) conditions.push(eq(webhookEvents.storeId, filters.storeId));
  if (filters.status && filters.status.length > 0) {
    conditions.push(inArray(webhookEvents.status, filters.status));
  }

  return db
    .select()
    .from(webhookEvents)
    .where(conditions.length > 0 ? and(...conditions) : undefined)
    .orderBy(desc(webhookEvents.receivedAt))
    .limit(filters.limit);
}

export interface StatusCountRow {
  status: WebhookEventStatus;
  total: number;
}

export async function countEventsByStatus(
  db: DbExecutor,
  storeId: string | null,
): Promise<StatusCountRow[]> {
  const rows = await db
    .select({ status: webhookEvents.status, total: count() })
    .from(webhookEvents)
    .where(storeId ? eq(webhookEvents.storeId, storeId) : undefined)
    .groupBy(webhookEvents.status);

  return rows.map((row) => ({
    status: row.status as WebhookEventStatus,
    total: Number(row.total),
  }));
}

export async function countEventsForStore(db: DbExecutor, storeId: string): Promise<number> {
  const [row] = await db
    .select({ total: count() })
    .from(webhookEvents)
    .where(eq(webhookEvents.storeId, storeId));

  return Number(row?.total ?? 0);
}

/** Claim query: `FOR UPDATE SKIP LOCKED` so two workers never take the same row. */
export async function claimEvents(
  db: DbExecutor,
  input: { limit: number; leaseSeconds: number },
): Promise<Array<{ id: string; organizationId: string }>> {
  const rows = await db.execute(sql`
    with claimable as (
      select e.id
        from webhook_events e
       where e.organization_id is not null
         and (
           (e.status in ('received', 'failed') and e.available_at <= now())
           or (
             e.status = 'processing'
             and e.processing_started_at < now() - make_interval(secs => ${input.leaseSeconds})
           )
         )
       order by e.available_at asc
       limit ${input.limit}
       for update skip locked
    )
    update webhook_events e
       set status = 'processing',
           processing_started_at = now(),
           attempt_count = e.attempt_count + 1,
           updated_at = now()
      from claimable c
     where e.id = c.id
    returning e.id as id, e.organization_id as organization_id
  `);

  const rowsTyped = rows as unknown as Array<{ id: string; organization_id: string }>;
  return rowsTyped
    .filter((row) => typeof row.organization_id === "string")
    .map((row) => ({ id: row.id, organizationId: row.organization_id }));
}
