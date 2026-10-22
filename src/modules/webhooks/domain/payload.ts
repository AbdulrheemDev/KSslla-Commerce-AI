import { createHash } from "node:crypto";

import { z } from "zod";

/**
 * Salla webhook envelope (docs/salla-reference.md §14.3).
 *
 * ```json
 * { "event": "order.created", "merchant": 1234509876,
 *   "created_at": "2022-12-31 12:31:25", "data": { ... } }
 * ```
 *
 * There is no documented event id, so `payload_hash` — the SHA-256 of the raw
 * body — is the idempotency key. Note what is *not* in the envelope: no
 * organization, no internal store id, no signature material.
 */
export const sallaWebhookEnvelopeSchema = z
  .object({
    event: z.string().trim().min(1),
    merchant: z
      .union([z.string(), z.number()])
      .transform((value) => String(value).trim())
      .refine((value) => value.length > 0, "merchant must not be empty"),
    created_at: z.string().nullish(),
    data: z.unknown().optional(),
  })
  .loose();

export type SallaWebhookEnvelope = z.infer<typeof sallaWebhookEnvelopeSchema>;

export function hashRawBody(rawBody: string): string {
  return createHash("sha256").update(rawBody, "utf8").digest("hex");
}

/** Keys that are never copied into storage, whatever the event. */
const REDACTED_KEYS = [
  "access_token",
  "refresh_token",
  "token",
  "secret",
  "password",
  "signature",
  "authorization",
] as const;

function scalarId(value: unknown): string | number | null {
  if (typeof value === "string" && value.trim().length > 0) return value.trim();
  if (typeof value === "number" && Number.isFinite(value)) return value;
  return null;
}

/**
 * Builds the stored projection — an allowlist, never the body.
 *
 * Kept: `event`, `merchant`, `created_at`, and `data.id` when the payload has
 * one. `app.store.authorize` additionally keeps the three non-secret OAuth
 * facts (`scope`, `expires`, `token_type`) that describe what was granted.
 *
 * Dropped by construction: the customer object, order lines, addresses, notes,
 * bank details, and every token. Handlers read current state from the API, so
 * nothing here needs the resource body (ADR-047).
 */
export function projectWebhookPayload(
  envelope: SallaWebhookEnvelope,
  eventName: string,
): Record<string, unknown> {
  const projected: Record<string, unknown> = {
    event: envelope.event,
    merchant: envelope.merchant,
    created_at: envelope.created_at ?? null,
  };

  const data =
    envelope.data && typeof envelope.data === "object" && !Array.isArray(envelope.data)
      ? (envelope.data as Record<string, unknown>)
      : null;

  const id = data ? scalarId(data.id) : null;
  const safeData: Record<string, unknown> = {};
  if (id !== null) safeData.id = id;

  if (eventName === "app.store.authorize" && data) {
    // Everything else in this payload is credential material.
    const scope = typeof data.scope === "string" ? data.scope : null;
    const tokenType = typeof data.token_type === "string" ? data.token_type : null;
    const expires =
      typeof data.expires === "number"
        ? data.expires
        : typeof data.expires === "string"
          ? Number(data.expires) || null
          : null;

    if (scope !== null) safeData.scope = scope;
    if (tokenType !== null) safeData.token_type = tokenType;
    if (expires !== null) safeData.expires = expires;
  }

  if (Object.keys(safeData).length > 0) projected.data = safeData;

  for (const key of REDACTED_KEYS) delete projected[key];

  return projected;
}

/** True when a projected payload contains a field we promised never to store. */
export function containsRedactedKey(payload: unknown): boolean {
  const seen = new Set<unknown>();
  const walk = (value: unknown): boolean => {
    if (!value || typeof value !== "object") return false;
    if (seen.has(value)) return false;
    seen.add(value);

    for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
      if ((REDACTED_KEYS as readonly string[]).includes(key.toLowerCase())) return true;
      if (walk(child)) return true;
    }
    return false;
  };

  return walk(payload);
}
