import { sql } from "drizzle-orm";

import { withTenantTransaction } from "@/db/tenant";
import type { Database } from "@/db/client";
import { logger } from "@/lib/logger";
import { recordAudit } from "@/modules/audit/infrastructure/audit-repository";
import {
  SALLA_SECURITY_STRATEGY_HEADER,
  SALLA_SIGNATURE_HEADER,
  SALLA_WEBHOOK_VERSION_HEADER,
  verifySallaWebhookSignature,
} from "@/modules/webhooks/domain/signature";
import {
  hashRawBody,
  projectWebhookPayload,
  sallaWebhookEnvelopeSchema,
} from "@/modules/webhooks/domain/payload";
import { classifyEvent } from "@/modules/webhooks/domain/events";
import { insertEvent } from "@/modules/webhooks/infrastructure/event-repository";
import { resolveStoreByExternalId } from "@/modules/webhooks/infrastructure/store-resolver";
import { getWebhookSecret } from "@/modules/webhooks/security/secret";

/**
 * Webhook ingestion.
 *
 * The order is fixed and load-bearing:
 *
 *   raw body → verify signature → parse JSON → validate envelope →
 *   resolve tenant → persist → (caller) acknowledge
 *
 * JSON is parsed **after** verification, and the stored row is a projection of
 * the envelope rather than the body, so a forged or oversized payload can never
 * reach storage and a customer object can never reach a column.
 */

export type IngestRejection = "not_configured" | "invalid_signature" | "invalid_payload";

export type IngestOutcome =
  | {
      status: "accepted";
      eventId: string | null;
      duplicate: boolean;
      tracked: boolean;
      eventName: string;
    }
  | { status: "rejected"; httpStatus: number; reason: IngestRejection; detail?: string };

export interface IngestInput {
  rawBody: string;
  headers: Headers;
  now?: Date;
}

function rejection(reason: IngestRejection, detail?: string): IngestOutcome {
  const httpStatus = reason === "not_configured" ? 503 : reason === "invalid_payload" ? 400 : 401;
  return { status: "rejected", httpStatus, reason, detail };
}

export async function ingestSallaWebhook(db: Database, input: IngestInput): Promise<IngestOutcome> {
  const now = input.now ?? new Date();
  const secret = getWebhookSecret();

  const verification = verifySallaWebhookSignature({
    rawBody: input.rawBody,
    signature: input.headers.get(SALLA_SIGNATURE_HEADER),
    strategy: input.headers.get(SALLA_SECURITY_STRATEGY_HEADER),
    secret,
  });

  if (!verification.ok) {
    // Reason only — never the received signature, the expected one, or the body.
    logger.warn(
      {
        event: "webhook.rejected",
        reason: verification.reason,
        hasSignature: input.headers.get(SALLA_SIGNATURE_HEADER) !== null,
        strategy: input.headers.get(SALLA_SECURITY_STRATEGY_HEADER) ?? null,
      },
      "salla webhook rejected before parsing",
    );

    if (verification.reason === "secret_not_configured") {
      return rejection("not_configured");
    }

    return rejection("invalid_signature", verification.reason);
  }

  let parsedJson: unknown;
  try {
    parsedJson = JSON.parse(input.rawBody);
  } catch {
    logger.warn(
      { event: "webhook.rejected", reason: "invalid_json" },
      "salla webhook body is not JSON",
    );
    return rejection("invalid_payload", "invalid_json");
  }

  const envelope = sallaWebhookEnvelopeSchema.safeParse(parsedJson);
  if (!envelope.success) {
    logger.warn(
      { event: "webhook.rejected", reason: "invalid_envelope" },
      "salla webhook envelope did not validate",
    );
    return rejection("invalid_payload", "invalid_envelope");
  }

  const payloadHash = hashRawBody(input.rawBody);
  const eventName = envelope.data.event;
  const externalStoreId = envelope.data.merchant;
  const versionHeader = input.headers.get(SALLA_WEBHOOK_VERSION_HEADER);
  const eventVersion = versionHeader && /^\d+$/.test(versionHeader) ? Number(versionHeader) : null;

  const action = classifyEvent(eventName);
  const resolved = await resolveStoreByExternalId(db, externalStoreId);

  // Unresolvable merchant: the delivery is genuine (the signature verified) but
  // there is no tenant to attach it to. It is stored ownerless and terminal —
  // never guessed onto an organization (ADR-046).
  if (!resolved) {
    // The narrow ingest context is what allows `insert … returning` on an
    // ownerless row; it is set only here, only after the signature verified.
    const inserted = await db.transaction(async (tx) => {
      await tx.execute(sql`select set_config('app.webhook_ingest', 'on', true)`);

      return insertEvent(tx, {
        organizationId: null,
        storeId: null,
        eventName,
        eventVersion,
        externalStoreId,
        signatureStrategy: verification.strategy,
        payloadHash,
        payload: projectWebhookPayload(envelope.data, eventName),
        status: "unmatched",
      });
    });

    await recordAudit(db, {
      organizationId: null,
      actorUserId: null,
      action: "webhook.unmatched",
      entityType: "webhook_event",
      entityId: inserted.id,
      metadata: {
        provider: "salla",
        eventName,
        externalStoreId,
        duplicate: inserted.duplicate,
      },
    });

    logger.warn(
      {
        event: "webhook.unmatched",
        eventName,
        externalStoreId,
        action: action.kind,
        duplicate: inserted.duplicate,
      },
      "verified salla webhook has no connected store",
    );

    return {
      status: "accepted",
      eventId: inserted.id,
      duplicate: inserted.duplicate,
      tracked: false,
      eventName,
    };
  }

  const outcome = await withTenantTransaction(
    db,
    { organizationId: resolved.organizationId },
    async (tx) => {
      const inserted = await insertEvent(tx, {
        organizationId: resolved.organizationId,
        storeId: resolved.storeId,
        eventName,
        eventVersion,
        externalStoreId,
        signatureStrategy: verification.strategy,
        payloadHash,
        payload: projectWebhookPayload(envelope.data, eventName),
        status: "received",
      });

      if (!inserted.duplicate) {
        await recordAudit(tx, {
          organizationId: resolved.organizationId,
          actorUserId: null,
          action: "webhook.received",
          entityType: "webhook_event",
          entityId: inserted.id,
          metadata: {
            provider: "salla",
            eventName,
            action: action.kind,
            attempt: 0,
          },
        });
      }

      return inserted;
    },
  );

  logger.info(
    {
      event: "webhook.received",
      organizationId: resolved.organizationId,
      storeId: resolved.storeId,
      webhookEventId: outcome.id,
      eventName,
      action: action.kind,
      duplicate: outcome.duplicate,
      durationMs: Date.now() - now.getTime(),
    },
    "salla webhook persisted",
  );

  return {
    status: "accepted",
    eventId: outcome.id,
    duplicate: outcome.duplicate,
    tracked: true,
    eventName,
  };
}
