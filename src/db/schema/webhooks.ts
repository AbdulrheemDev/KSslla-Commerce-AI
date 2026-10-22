import {
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

import { organizations } from "@/db/schema/organizations";
import { stores } from "@/db/schema/stores";

/**
 * Webhook event inbox (Phase 06).
 *
 * Every verified Salla delivery becomes exactly one row here, and the row is
 * the unit of work: an HTTP request only verifies, persists, and acknowledges.
 * Processing happens afterwards, in a worker, so a slow sync can never cause
 * Salla to time out and redeliver.
 *
 * Tenant columns are nullable on purpose: an event whose `merchant` does not
 * match any connection cannot be attributed to an organization, and inventing
 * one would be a cross-tenant bug. Such rows are stored as `unmatched`, are
 * invisible to every tenant through RLS, and are never processed.
 *
 * Idempotency: Salla does not document an event id (docs/salla-reference §14.3),
 * so the deterministic key is the SHA-256 of the **raw** request body. A
 * redelivery of the same body collides on `(provider, payload_hash)` and is
 * acknowledged without a second row or a second processing pass.
 */
export const webhookEvents = pgTable(
  "webhook_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id").references(() => organizations.id, {
      onDelete: "cascade",
    }),
    storeId: uuid("store_id").references(() => stores.id, { onDelete: "cascade" }),

    provider: text("provider").notNull().default("salla"),
    eventName: text("event_name").notNull(),
    /** Provider webhook version (`1` or `2`); null when the delivery omits it. */
    eventVersion: integer("event_version"),
    /**
     * Reserved: no Salla event id is documented today. Kept so a future
     * documented id becomes a column, not a migration of the idempotency key.
     */
    externalEventId: text("external_event_id"),
    /** `merchant` from the envelope — the only identity we trust to find a store. */
    externalStoreId: text("external_store_id").notNull(),

    signatureStrategy: text("signature_strategy").notNull(),
    payloadHash: text("payload_hash").notNull(),
    /**
     * Allowlisted projection, never the raw body: `{event, merchant,
     * created_at, data:{id?}}` plus non-secret token metadata for
     * `app.store.authorize` (ADR-047). Order and customer payloads therefore
     * never put phone, e-mail, or address into this table.
     */
    payload: jsonb("payload").$type<Record<string, unknown>>().notNull(),

    status: text("status").notNull().default("received"),
    attemptCount: integer("attempt_count").notNull().default(0),
    availableAt: timestamp("available_at", { withTimezone: true }).notNull().defaultNow(),
    processingStartedAt: timestamp("processing_started_at", { withTimezone: true }),
    processedAt: timestamp("processed_at", { withTimezone: true }),
    failedAt: timestamp("failed_at", { withTimezone: true }),
    lastErrorCode: text("last_error_code"),
    lastErrorMessage: text("last_error_message"),
    /** What the handler actually did: `{action, detail}`; no payload copy. */
    result: jsonb("result").$type<Record<string, unknown>>(),

    receivedAt: timestamp("received_at", { withTimezone: true }).notNull().defaultNow(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("webhook_events_provider_hash_unique").on(table.provider, table.payloadHash),
    index("webhook_events_status_available_idx").on(table.status, table.availableAt),
    index("webhook_events_org_received_idx").on(table.organizationId, table.receivedAt),
    index("webhook_events_store_received_idx").on(table.storeId, table.receivedAt),
    index("webhook_events_event_name_idx").on(table.eventName),
    index("webhook_events_external_store_idx").on(table.externalStoreId),
  ],
);

export type WebhookEvent = typeof webhookEvents.$inferSelect;
export type NewWebhookEvent = typeof webhookEvents.$inferInsert;
