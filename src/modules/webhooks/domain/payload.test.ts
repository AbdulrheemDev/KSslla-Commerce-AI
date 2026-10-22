import { describe, expect, it } from "vitest";

import {
  containsRedactedKey,
  hashRawBody,
  projectWebhookPayload,
  sallaWebhookEnvelopeSchema,
} from "@/modules/webhooks/domain/payload";

/**
 * Envelope validation and the stored projection.
 *
 * The projection is the only thing that reaches `webhook_events.payload`, so
 * these tests are the proof behind the claim that a webhook body — with its
 * customer objects, addresses and tokens — is never persisted (ADR-047).
 */

const ORDER_BODY = JSON.stringify({
  event: "order.created",
  merchant: 847769313,
  created_at: "2026-10-22 10:00:00",
  data: {
    id: 500001,
    reference_id: "REF-1",
    customer: {
      id: 900001,
      first_name: "سالم",
      mobile: { number: 512345678, mobile_code: "966" },
      email: "customer@example.test",
    },
    shipping: { address: { street: "شارع الملك", city: "الرياض" } },
    items: [{ name: "منتج", quantity: 2 }],
  },
});

function parse(raw: string) {
  const parsed = sallaWebhookEnvelopeSchema.safeParse(JSON.parse(raw));
  if (!parsed.success) throw new Error("fixture did not validate");
  return parsed.data;
}

describe("sallaWebhookEnvelopeSchema", () => {
  it("accepts the documented envelope", () => {
    const envelope = parse(ORDER_BODY);
    expect(envelope.event).toBe("order.created");
    expect(envelope.merchant).toBe("847769313");
  });

  it("normalises a numeric merchant to the string used for store lookup", () => {
    expect(parse(JSON.stringify({ event: "order.created", merchant: 12345 })).merchant).toBe(
      "12345",
    );
    expect(parse(JSON.stringify({ event: "order.created", merchant: "12345" })).merchant).toBe(
      "12345",
    );
  });

  it("tolerates unknown top-level fields", () => {
    const parsed = sallaWebhookEnvelopeSchema.safeParse({
      event: "order.created",
      merchant: 1,
      created_at: null,
      data: {},
      something_new: { nested: true },
    });

    expect(parsed.success).toBe(true);
  });

  it("rejects a body without an event or a merchant", () => {
    expect(sallaWebhookEnvelopeSchema.safeParse({ merchant: 1 }).success).toBe(false);
    expect(sallaWebhookEnvelopeSchema.safeParse({ event: "order.created" }).success).toBe(false);
    expect(sallaWebhookEnvelopeSchema.safeParse({ event: "", merchant: 1 }).success).toBe(false);
    expect(
      sallaWebhookEnvelopeSchema.safeParse({ event: "order.created", merchant: "" }).success,
    ).toBe(false);
  });

  it("rejects a non-object body", () => {
    for (const value of [[], "text", 5, null]) {
      expect(sallaWebhookEnvelopeSchema.safeParse(value).success).toBe(false);
    }
  });
});

describe("projectWebhookPayload", () => {
  it("keeps only the envelope facts and the resource id", () => {
    const projected = projectWebhookPayload(parse(ORDER_BODY), "order.created");

    expect(projected).toEqual({
      event: "order.created",
      merchant: "847769313",
      created_at: "2026-10-22 10:00:00",
      data: { id: 500001 },
    });
  });

  it("drops the customer object, the address, and the order lines", () => {
    const serialised = JSON.stringify(projectWebhookPayload(parse(ORDER_BODY), "order.created"));

    for (const forbidden of [
      "سالم",
      "customer@example.test",
      "512345678",
      "شارع الملك",
      "الرياض",
      "REF-1",
      "items",
    ]) {
      expect(serialised).not.toContain(forbidden);
    }
  });

  it("keeps only non-secret OAuth facts for an app authorization", () => {
    const authorization = {
      event: "app.store.authorize",
      merchant: 847769313,
      created_at: "2026-10-22 10:00:00",
      data: {
        access_token: "secret-access-token-value",
        refresh_token: "secret-refresh-token-value",
        expires: 1893456000,
        scope: "orders.read products.read",
        token_type: "bearer",
      },
    };

    const projected = projectWebhookPayload(
      parse(JSON.stringify(authorization)),
      "app.store.authorize",
    );

    expect(projected).toEqual({
      event: "app.store.authorize",
      merchant: "847769313",
      created_at: "2026-10-22 10:00:00",
      data: { scope: "orders.read products.read", token_type: "bearer", expires: 1893456000 },
    });

    const serialised = JSON.stringify(projected);
    expect(serialised).not.toContain("secret-access-token-value");
    expect(serialised).not.toContain("secret-refresh-token-value");
    expect(containsRedactedKey(projected)).toBe(false);
  });

  it("does not keep OAuth facts for other events that happen to carry them", () => {
    const projected = projectWebhookPayload(
      parse(
        JSON.stringify({
          event: "order.updated",
          merchant: 1,
          data: { id: 2, scope: "orders.read", token_type: "bearer" },
        }),
      ),
      "order.updated",
    );

    expect(projected).toEqual({
      event: "order.updated",
      merchant: "1",
      created_at: null,
      data: { id: 2 },
    });
  });

  it("survives a payload with no data object", () => {
    expect(
      projectWebhookPayload(
        parse(JSON.stringify({ event: "order.deleted", merchant: 1 })),
        "order.deleted",
      ),
    ).toEqual({ event: "order.deleted", merchant: "1", created_at: null });
  });
});

describe("containsRedactedKey", () => {
  it("detects a credential key at any depth", () => {
    expect(containsRedactedKey({ data: { nested: [{ refresh_token: "x" }] } })).toBe(true);
    expect(containsRedactedKey({ data: { secret: "x" } })).toBe(true);
    expect(containsRedactedKey({ data: { id: 1 } })).toBe(false);
  });

  it("handles cycles without hanging", () => {
    const cyclic: Record<string, unknown> = { id: 1 };
    cyclic.self = cyclic;
    expect(containsRedactedKey(cyclic)).toBe(false);
  });
});

describe("hashRawBody", () => {
  it("is deterministic and 64 hex characters", () => {
    expect(hashRawBody(ORDER_BODY)).toBe(hashRawBody(ORDER_BODY));
    expect(hashRawBody(ORDER_BODY)).toMatch(/^[0-9a-f]{64}$/);
  });

  it("changes when the bytes change, even if the JSON means the same thing", () => {
    // Pretty-printing is the simplest re-serialisation; the digest must notice,
    // because that is what binds a stored row to one exact delivery.
    const pretty = JSON.stringify(JSON.parse(ORDER_BODY), null, 2);
    expect(hashRawBody(ORDER_BODY)).not.toBe(hashRawBody(pretty));
  });

  it("does not depend on receipt time", () => {
    const first = hashRawBody(ORDER_BODY);
    const second = hashRawBody(ORDER_BODY);
    expect(first).toBe(second);
  });
});
