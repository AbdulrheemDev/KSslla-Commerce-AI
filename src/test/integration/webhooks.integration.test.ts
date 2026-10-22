import { createHmac } from "node:crypto";

import { eq } from "drizzle-orm";
import { NextRequest } from "next/server";
import postgres from "postgres";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { webhookEvents, syncRuns, storeConnections, orders, products } from "@/db/schema";
import { getTestDb, closeTestDb, executeAsAdmin } from "@/test/db/client";
import { withTenantTransaction } from "@/db/tenant";
import { adminDatabaseUrl, TEST_DATABASE } from "@/test/db/config";
import {
  BASE_URL,
  callbackViaApi,
  registerViaApi,
  resetState,
  type RegisteredUser,
} from "@/test/integration/helpers";
import { inviteAndAccept } from "@/test/integration/fixtures";
import { MockSallaServer, type MockProduct } from "@/test/integration/mock-salla-server";
import {
  clearMockSalla,
  configureMockSalla,
  stateFromAuthorizationUrl,
} from "@/test/integration/salla-helpers";
import { drainWebhookEvents } from "@/modules/webhooks/application/worker";
import { signSallaWebhookBody } from "@/modules/webhooks/domain/signature";

/**
 * Phase 06 integration tests — webhook inbox, worker, and tenant isolation.
 *
 * Everything here runs against the real route handlers, the real services and a
 * real PostgreSQL with RLS enabled for the unprivileged app role. Salla is
 * replaced by the local protocol simulator; nothing contacts the real Salla or
 * a real store.
 *
 * The delivery helper sends bodies through `POST /api/webhooks/salla` exactly as
 * Salla would: raw JSON bytes plus the two documented headers. The worker is
 * driven explicitly instead of through `after()`, because a directly-invoked
 * route handler has no Next request scope to attach a post-response task to.
 */

const mock = new MockSallaServer();
const WEBHOOK_SECRET = process.env.SALLA_WEBHOOK_SECRET ?? "";
const MERCHANT = "847769313";

beforeAll(async () => {
  await mock.start();
});

afterAll(async () => {
  await mock.stop();
  closeTestDb();
});

beforeEach(async () => {
  await resetState();
  mock.reset();
  configureMockSalla(mock.url);
});

afterEach(() => {
  clearMockSalla();
});

interface StoreFixture extends RegisteredUser {
  storeId: string;
  connectionId: string;
}

async function ownerWithStore(email: string): Promise<RegisteredUser & { storeId: string }> {
  const owner = await registerViaApi({
    email,
    organizationName: `مؤسسة ${email}`,
    storeName: "متجر كشخة",
  });

  const list = await owner.client.get<{ stores: Array<{ id: string }> }>(
    "/api/organizations/current/stores",
  );
  const storeId = list.body.data?.stores[0]?.id;
  if (!storeId) throw new Error("store not created");

  return { ...owner, storeId };
}

async function connectStore(owner: RegisteredUser & { storeId: string }): Promise<StoreFixture> {
  const started = await owner.client.post<{ authorizationUrl: string }>(
    `/api/organizations/current/stores/${owner.storeId}/salla/authorize`,
    undefined,
  );
  const authorizationUrl = started.body.data?.authorizationUrl;
  if (!authorizationUrl) throw new Error(`authorize failed: ${JSON.stringify(started.body)}`);

  const callback = await callbackViaApi(owner.client, {
    code: "mock-code",
    state: stateFromAuthorizationUrl(authorizationUrl),
  });

  if (callback.status !== 307 || !callback.location?.includes("/app/stores/")) {
    throw new Error(`connection failed: ${callback.status} ${callback.location ?? ""}`);
  }

  const connection = await asTenant(owner.organizationId, (tx) =>
    tx
      .select({ id: storeConnections.id })
      .from(storeConnections)
      .where(eq(storeConnections.storeId, owner.storeId))
      .limit(1),
  );

  const connectionId = connection[0]?.id;
  if (!connectionId) throw new Error("connection not created");

  mock.requests.length = 0;
  return { ...owner, connectionId };
}

interface DeliveryOptions {
  signature?: string | null;
  strategy?: string | null;
  secret?: string;
  contentType?: string;
  headers?: Record<string, string>;
  query?: string;
}

async function deliver(
  rawBody: string,
  options: DeliveryOptions = {},
): Promise<{ status: number; body: Record<string, unknown> }> {
  // Only the two documented headers are sent. `x-salla-webhook-version` is a
  // registration parameter, not a delivery header, so the tests must not rely
  // on it either (docs/salla-reference.md §14.3).
  const headers = new Headers({
    host: "localhost:3000",
    "content-type": options.contentType ?? "application/json",
    ...(options.headers ?? {}),
  });

  const signature =
    options.signature === undefined
      ? signSallaWebhookBody(rawBody, options.secret ?? WEBHOOK_SECRET)
      : options.signature;

  if (signature !== null) headers.set("x-salla-signature", signature);

  const strategy = options.strategy === undefined ? "Signature" : options.strategy;
  if (strategy !== null) headers.set("x-salla-security-strategy", strategy);

  const { POST } = await import("@/app/api/webhooks/salla/route");
  const request = new NextRequest(`${BASE_URL}/api/webhooks/salla${options.query ?? ""}`, {
    method: "POST",
    headers,
    body: rawBody,
  });

  const response = await POST(request);
  return { status: response.status, body: (await response.json()) as Record<string, unknown> };
}

function body(event: string, data: unknown = { id: 1 }, merchant: string = MERCHANT): string {
  return JSON.stringify({
    event,
    merchant: Number(merchant),
    created_at: "2026-10-22 10:00:00",
    data,
  });
}

/**
 * Runs a read as the unprivileged app role inside a tenant transaction, so RLS
 * decides what is visible — the same rule production traffic is subject to.
 */
function asTenant<T>(
  organizationId: string,
  work: (
    tx: Parameters<Parameters<ReturnType<typeof getTestDb>["transaction"]>[0]>[0],
  ) => Promise<T>,
): Promise<T> {
  return withTenantTransaction(getTestDb(), { organizationId }, work);
}

async function selectEvents(organizationId: string) {
  return asTenant(organizationId, (tx) =>
    tx.select().from(webhookEvents).where(eq(webhookEvents.organizationId, organizationId)),
  );
}

/** Reads a row as the privileged role, bypassing RLS (test-only inspection). */
async function rawEvents(): Promise<
  Array<{ id: string; status: string; organization_id: string | null; attempt_count: number }>
> {
  const admin = postgres(adminDatabaseUrl().replace(/\/[^/]*$/, `/${TEST_DATABASE.name}`), {
    max: 1,
    onnotice: () => undefined,
  });

  try {
    const rows = await admin.unsafe(
      `select id, status, organization_id, attempt_count from webhook_events order by received_at asc`,
    );
    return rows as unknown as Array<{
      id: string;
      status: string;
      organization_id: string | null;
      attempt_count: number;
    }>;
  } finally {
    await admin.end({ timeout: 5 });
  }
}

const PRODUCTS: MockProduct[] = [
  {
    id: 1001,
    name: "منتج أول",
    sku: "SKU-1",
    status: "sale",
    price: { amount: "120.00", currency: "SAR" },
    quantity: "7",
    is_available: true,
    updated_at: "2026-10-20 10:00:00",
  },
];

describe("public endpoint — verification before anything else", () => {
  it("acknowledges a valid delivery and persists it without syncing", async () => {
    const owner = await connectStore(await ownerWithStore("webhook-ack@example.test"));

    const response = await deliver(body("product.created", { id: 1001 }));

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ received: true, duplicate: false });

    const [event] = await selectEvents(owner.organizationId);
    expect(event?.status).toBe("received");
    expect(event?.eventName).toBe("product.created");
    expect(event?.storeId).toBe(owner.storeId);
    expect(event?.externalStoreId).toBe(MERCHANT);
    expect(event?.attemptCount).toBe(0);

    // The ACK never waits for a sync: the provider was not called at all.
    expect(mock.requests).toHaveLength(0);
    const runs = await asTenant(owner.organizationId, (tx) =>
      tx.select().from(syncRuns).where(eq(syncRuns.organizationId, owner.organizationId)),
    );
    expect(runs).toHaveLength(0);
  });

  it("rejects an invalid signature with a generic message and stores nothing", async () => {
    await connectStore(await ownerWithStore("webhook-badsig@example.test"));

    const response = await deliver(body("product.created"), {
      signature: createHmac("sha256", "wrong-secret").update(body("product.created")).digest("hex"),
    });

    expect(response.status).toBe(401);
    expect(response.body).toEqual({
      error: { code: "WEBHOOK_UNAUTHORIZED", message: "Unauthorized webhook." },
    });
    expect(await rawEvents()).toHaveLength(0);
  });

  it("rejects a missing signature", async () => {
    await connectStore(await ownerWithStore("webhook-nosig@example.test"));

    const response = await deliver(body("order.created"), { signature: null });

    expect(response.status).toBe(401);
    expect(await rawEvents()).toHaveLength(0);
  });

  it("rejects the Token strategy instead of accepting an unverified body", async () => {
    await connectStore(await ownerWithStore("webhook-token@example.test"));

    const response = await deliver(body("order.created"), { strategy: "Token" });

    expect(response.status).toBe(401);
    expect(await rawEvents()).toHaveLength(0);
  });

  it("rejects any unsupported strategy even when the digest is correct", async () => {
    // A valid HMAC only proves "whoever sent this knows the secret". Under a
    // strategy we do not implement, it does not prove the request is the kind
    // of request we think it is, so the strategy header is authoritative.
    await connectStore(await ownerWithStore("webhook-strategy@example.test"));

    for (const strategy of ["Token", "HMAC", "None", "Signature,Token"]) {
      const response = await deliver(body("order.created", { id: 700001 }), { strategy });
      expect(response.status).toBe(401);
      expect(response.body).toEqual({
        error: { code: "WEBHOOK_UNAUTHORIZED", message: "Unauthorized webhook." },
      });
    }

    expect(await rawEvents()).toHaveLength(0);
  });

  it("treats an absent strategy header as Salla's documented Signature default", async () => {
    // Salla assigns `Signature` when a webhook is registered without a strategy.
    // Absence therefore means the default — and the digest is still mandatory.
    const owner = await connectStore(await ownerWithStore("webhook-default@example.test"));

    const accepted = await deliver(body("product.created", { id: 1001 }), { strategy: null });
    expect(accepted.status).toBe(200);

    const [event] = await selectEvents(owner.organizationId);
    expect(event?.signatureStrategy).toBe("Signature");

    const rejected = await deliver(body("product.created", { id: 1002 }), {
      strategy: null,
      secret: "wrong-secret",
    });
    expect(rejected.status).toBe(401);
    expect(await rawEvents()).toHaveLength(1);
  });

  it("rejects a well-formed-looking but non-hex signature", async () => {
    await connectStore(await ownerWithStore("webhook-nonhex@example.test"));

    for (const signature of ["Z".repeat(64), "abc", `${"a".repeat(64)}00`]) {
      const response = await deliver(body("order.created"), { signature });
      expect(response.status).toBe(401);
    }

    expect(await rawEvents()).toHaveLength(0);
  });

  it("signs the raw bytes: whitespace-only JSON changes invalidate the delivery", async () => {
    await connectStore(await ownerWithStore("webhook-rawbody@example.test"));

    const raw = body("product.created", { id: 1001 });
    const signature = signSallaWebhookBody(raw, WEBHOOK_SECRET);

    // Same JSON value, different bytes → the digest no longer matches.
    const pretty = JSON.stringify(JSON.parse(raw), null, 2);
    const reordered = JSON.stringify({
      data: { id: 1001 },
      created_at: "2026-10-22 10:00:00",
      merchant: Number(MERCHANT),
      event: "product.created",
    });

    for (const variant of [pretty, `${raw}\n`, reordered]) {
      const response = await deliver(variant, { signature });
      expect(response.status).toBe(401);
    }

    expect(await rawEvents()).toHaveLength(0);
  });

  it("verifies before parsing: a malformed body with a bad signature is still a 401", async () => {
    await connectStore(await ownerWithStore("webhook-malformed@example.test"));

    const response = await deliver("{not json", { secret: "different-secret" });

    expect(response.status).toBe(401);
    expect(await rawEvents()).toHaveLength(0);
  });

  it("rejects malformed JSON that carries a valid signature, without storing it", async () => {
    await connectStore(await ownerWithStore("webhook-badjson@example.test"));

    const response = await deliver("{not json");

    expect(response.status).toBe(400);
    expect(response.body).toMatchObject({ error: { code: "WEBHOOK_INVALID_PAYLOAD" } });
    expect(await rawEvents()).toHaveLength(0);
  });

  it("rejects a non-JSON content type", async () => {
    await connectStore(await ownerWithStore("webhook-ctype@example.test"));

    const response = await deliver(body("order.created"), { contentType: "text/plain" });

    expect(response.status).toBe(415);
    expect(await rawEvents()).toHaveLength(0);
  });

  it("rejects a body above the size cap", async () => {
    await connectStore(await ownerWithStore("webhook-large@example.test"));

    const huge = JSON.stringify({
      event: "order.created",
      merchant: Number(MERCHANT),
      data: { id: 1, padding: "x".repeat(300 * 1024) },
    });

    const response = await deliver(huge);

    expect(response.status).toBe(413);
    expect(await rawEvents()).toHaveLength(0);
  });

  it("answers 503 rather than trusting anything when no secret is configured", async () => {
    const owner = await connectStore(await ownerWithStore("webhook-nosecret@example.test"));
    const previous = process.env.SALLA_WEBHOOK_SECRET;
    delete process.env.SALLA_WEBHOOK_SECRET;
    const { resetServerEnvCache } = await import("@/lib/env");
    resetServerEnvCache();

    try {
      const response = await deliver(body("order.created"));
      expect(response.status).toBe(503);
      expect(await selectEvents(owner.organizationId)).toHaveLength(0);
    } finally {
      process.env.SALLA_WEBHOOK_SECRET = previous;
      resetServerEnvCache();
    }
  });
});

describe("ingestion — tenant resolution and idempotency", () => {
  it("resolves the tenant from the verified merchant id and ignores forged fields", async () => {
    const owner = await connectStore(await ownerWithStore("webhook-resolve@example.test"));

    const forged = JSON.stringify({
      event: "product.created",
      merchant: Number(MERCHANT),
      created_at: "2026-10-22 10:00:00",
      data: { id: 1001, organization_id: owner.organizationId, store_id: owner.storeId },
    });

    const response = await deliver(forged);
    expect(response.status).toBe(200);

    const [event] = await selectEvents(owner.organizationId);
    expect(event?.organizationId).toBe(owner.organizationId);
    expect(event?.storeId).toBe(owner.storeId);
    // The forged ids are not part of the projection, so they were never stored.
    expect(JSON.stringify(event?.payload)).not.toContain("organization_id");
    expect(JSON.stringify(event?.payload)).not.toContain("store_id");
  });

  it("cannot be steered to another organization by forged body or query identifiers", async () => {
    const ownerA = await connectStore(await ownerWithStore("webhook-tenant-a@example.test"));
    const ownerB = await ownerWithStore("webhook-tenant-b@example.test");

    const forged = JSON.stringify({
      event: "order.created",
      merchant: Number(MERCHANT),
      created_at: "2026-10-22 10:00:00",
      data: {
        id: 500002,
        organization_id: ownerB.organizationId,
        organizationId: ownerB.organizationId,
        store_id: ownerB.storeId,
        storeId: ownerB.storeId,
        user_id: ownerB.userId,
      },
    });

    const query = new URLSearchParams({
      organization_id: ownerB.organizationId,
      store_id: ownerB.storeId,
      user_id: ownerB.userId,
    }).toString();

    const response = await deliver(forged, { query: `?${query}` });
    expect(response.status).toBe(200);

    // The verified merchant resolves to Org A's binding; nothing in the request
    // can redirect that (ADR-046).
    const eventsA = await selectEvents(ownerA.organizationId);
    expect(eventsA).toHaveLength(1);
    expect(eventsA[0]?.organizationId).toBe(ownerA.organizationId);
    expect(eventsA[0]?.storeId).toBe(ownerA.storeId);

    // Org B sees nothing, and none of its identifiers were stored anywhere.
    expect(await selectEvents(ownerB.organizationId)).toHaveLength(0);
    const serialised = JSON.stringify(eventsA[0]?.payload);
    expect(serialised).not.toContain(ownerB.organizationId);
    expect(serialised).not.toContain(ownerB.storeId);
    expect(serialised).not.toContain(ownerB.userId);
  });

  it("stores an unresolvable merchant as unmatched and invisible to every tenant", async () => {
    const owner = await connectStore(await ownerWithStore("webhook-unmatched@example.test"));

    const response = await deliver(body("order.created", { id: 9 }, "999999999"));

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ received: true, duplicate: false });

    const rows = await rawEvents();
    expect(rows).toHaveLength(1);
    expect(rows[0]?.organization_id).toBeNull();
    expect(rows[0]?.status).toBe("unmatched");

    // Not visible through the tenant's own query...
    expect(await selectEvents(owner.organizationId)).toHaveLength(0);
    // ...and never claimed by the worker.
    const drained = await drainWebhookEvents(getTestDb());
    expect(drained.claimed).toBe(0);
  });

  it("treats a repeated delivery as a duplicate instead of a second event", async () => {
    const owner = await connectStore(await ownerWithStore("webhook-dup@example.test"));
    const raw = body("order.created", { id: 500001 });

    const first = await deliver(raw);
    const second = await deliver(raw);

    expect(first.body).toEqual({ received: true, duplicate: false });
    expect(second.status).toBe(200);
    expect(second.body).toEqual({ received: true, duplicate: true });

    const events = await selectEvents(owner.organizationId);
    expect(events).toHaveLength(1);
    expect(events[0]?.attemptCount).toBe(0);
  });

  it("does not create a second row when the same body arrives concurrently", async () => {
    const owner = await connectStore(await ownerWithStore("webhook-dup-race@example.test"));
    const raw = body("product.created", { id: 1001 });

    const results = await Promise.all([deliver(raw), deliver(raw), deliver(raw), deliver(raw)]);

    expect(results.every((result) => result.status === 200)).toBe(true);
    expect(await selectEvents(owner.organizationId)).toHaveLength(1);
  });

  it("stores a projection, never the body: no customer data reaches the inbox", async () => {
    const owner = await connectStore(await ownerWithStore("webhook-pii@example.test"));

    const raw = JSON.stringify({
      event: "order.created",
      merchant: Number(MERCHANT),
      created_at: "2026-10-22 10:00:00",
      data: {
        id: 500777,
        customer: {
          first_name: "سالم",
          email: "private@example.test",
          mobile: { number: 512345678, mobile_code: "966" },
        },
        shipping: { address: { street: "شارع الملك", city: "الرياض" } },
        items: [{ name: "منتج سري", quantity: 3 }],
      },
    });

    expect((await deliver(raw)).status).toBe(200);

    const [event] = await selectEvents(owner.organizationId);
    const stored = JSON.stringify(event?.payload);

    expect(stored).not.toContain("private@example.test");
    expect(stored).not.toContain("512345678");
    expect(stored).not.toContain("سالم");
    expect(stored).not.toContain("شارع الملك");
    expect(stored).not.toContain("منتج سري");
    expect(event?.payload).toEqual({
      event: "order.created",
      merchant: MERCHANT,
      created_at: "2026-10-22 10:00:00",
      data: { id: 500777 },
    });
  });
});

describe("worker — processing, retry, and dead letter", () => {
  it("processes a product event by refreshing the product, not by trusting the payload", async () => {
    const owner = await connectStore(await ownerWithStore("webhook-process-product@example.test"));
    mock.products = PRODUCTS;

    await deliver(body("product.created", { id: 1001 }));
    const drained = await drainWebhookEvents(getTestDb());

    expect(drained).toMatchObject({ claimed: 1, processed: 1, failed: 0, deadLettered: 0 });

    const [event] = await selectEvents(owner.organizationId);
    expect(event?.status).toBe("processed");
    expect(event?.attemptCount).toBe(1);
    expect(event?.processedAt).not.toBeNull();
    expect(event?.result).toMatchObject({ action: "synced" });

    const runs = await asTenant(owner.organizationId, (tx) =>
      tx.select().from(syncRuns).where(eq(syncRuns.organizationId, owner.organizationId)),
    );
    expect(runs).toHaveLength(1);
    expect(runs[0]).toMatchObject({
      resource: "products",
      trigger: "webhook",
      initiatedByUserId: null,
    });
    expect(runs[0]?.status).toBe("succeeded");
  });

  it("processes an order event through the Phase 05 read-only sync", async () => {
    const owner = await connectStore(await ownerWithStore("webhook-process-order@example.test"));
    mock.orders = [
      {
        id: 500001,
        reference_id: "REF-1",
        total: { amount: "150.00", currency: "SAR" },
        date: { date: "2026-10-01 10:00:00.000000", timezone_type: 3, timezone: "Asia/Riyadh" },
        status: { id: 1, name: "مكتمل", slug: "completed" },
        customer: {
          id: 9001,
          first_name: "عميل",
          mobile: { number: 512345678, mobile_code: "966" },
        },
      },
    ];

    await deliver(body("order.created", { id: 500001 }));
    await drainWebhookEvents(getTestDb());

    const [event] = await selectEvents(owner.organizationId);
    expect(event?.status).toBe("processed");

    const stored = await asTenant(owner.organizationId, (tx) =>
      tx
        .select({ id: orders.id, externalOrderId: orders.externalOrderId })
        .from(orders)
        .where(eq(orders.organizationId, owner.organizationId)),
    );

    expect(stored).toHaveLength(1);
    expect(stored[0]?.externalOrderId).toBe("500001");
  });

  it("marks an unknown but verified event as ignored and keeps the 2xx", async () => {
    const owner = await connectStore(await ownerWithStore("webhook-unknown@example.test"));

    const response = await deliver(body("future.event.name", { id: 1 }));
    expect(response.status).toBe(200);

    await drainWebhookEvents(getTestDb());

    const [event] = await selectEvents(owner.organizationId);
    expect(event?.status).toBe("ignored");
    expect(event?.result).toMatchObject({ reason: "unknown_event" });
    expect(mock.requests).toHaveLength(0);
  });

  it("retries a transient failure on the documented schedule, then dead-letters", async () => {
    const owner = await connectStore(await ownerWithStore("webhook-retry@example.test"));
    mock.behaviour.catalogStatus = 500;

    await deliver(body("product.created", { id: 1001 }));

    const first = await drainWebhookEvents(getTestDb());
    expect(first.failed).toBe(1);

    let [event] = await selectEvents(owner.organizationId);
    expect(event?.status).toBe("failed");
    expect(event?.attemptCount).toBe(1);
    expect(event?.lastErrorCode).toBe("INTEGRATION_ERROR");
    expect(event?.availableAt.getTime()).toBeGreaterThan(Date.now() + 30_000);

    // Second attempt: make it due again without waiting a minute.
    await executeAsAdmin(`update webhook_events set available_at = now() - interval '1 second'`);
    const second = await drainWebhookEvents(getTestDb());
    expect(second.failed).toBe(1);

    [event] = await selectEvents(owner.organizationId);
    expect(event?.attemptCount).toBe(2);
    expect(event?.availableAt.getTime()).toBeGreaterThan(Date.now() + 4 * 60_000);

    // Third attempt exhausts the budget and dead-letters.
    await executeAsAdmin(`update webhook_events set available_at = now() - interval '1 second'`);
    const third = await drainWebhookEvents(getTestDb());
    expect(third.deadLettered).toBe(1);

    [event] = await selectEvents(owner.organizationId);
    expect(event?.status).toBe("dead_letter");
    expect(event?.attemptCount).toBe(3);

    // A dead-lettered row is not claimable until someone replays it.
    expect((await drainWebhookEvents(getTestDb())).claimed).toBe(0);
  });

  it("does not process an event before it is due", async () => {
    const owner = await connectStore(await ownerWithStore("webhook-notdue@example.test"));
    mock.behaviour.catalogStatus = 500;

    await deliver(body("product.created", { id: 1001 }));
    await drainWebhookEvents(getTestDb());

    const immediate = await drainWebhookEvents(getTestDb());
    expect(immediate.claimed).toBe(0);

    const [event] = await selectEvents(owner.organizationId);
    expect(event?.status).toBe("failed");
  });

  it("coalesces a burst of product events into one refresh", async () => {
    const owner = await connectStore(await ownerWithStore("webhook-coalesce@example.test"));
    mock.products = PRODUCTS;

    await deliver(body("product.created", { id: 1001 }));
    await deliver(body("product.updated", { id: 1001 }));
    await deliver(body("product.price.updated", { id: 1001 }));

    const drained = await drainWebhookEvents(getTestDb());
    expect(drained.claimed).toBe(3);
    expect(drained.processed).toBe(3);

    const events = await selectEvents(owner.organizationId);
    expect(events.every((event) => event.status === "processed")).toBe(true);

    // One provider pass covers the whole burst; the later two are recorded as
    // covered rather than re-reading the catalogue.
    const runs = await asTenant(owner.organizationId, (tx) =>
      tx.select().from(syncRuns).where(eq(syncRuns.organizationId, owner.organizationId)),
    );
    expect(runs).toHaveLength(1);
  });

  it("processes each event exactly once when several workers drain at the same time", async () => {
    const owner = await connectStore(await ownerWithStore("webhook-concurrent@example.test"));

    for (let index = 0; index < 8; index += 1) {
      await deliver(body("future.event.name", { id: index }));
    }

    const workers = await Promise.all([
      drainWebhookEvents(getTestDb()),
      drainWebhookEvents(getTestDb()),
      drainWebhookEvents(getTestDb()),
    ]);

    const claimed = workers.reduce((sum, worker) => sum + worker.claimed, 0);
    const ignored = workers.reduce((sum, worker) => sum + worker.ignored, 0);

    expect(claimed).toBe(8);
    expect(ignored).toBe(8);

    const events = await selectEvents(owner.organizationId);
    expect(events).toHaveLength(8);
    expect(events.every((event) => event.status === "ignored")).toBe(true);
    expect(events.every((event) => event.attemptCount === 1)).toBe(true);
  });
});

describe("app lifecycle events", () => {
  it("revokes the connection on uninstall and keeps the merchant's data", async () => {
    const owner = await connectStore(await ownerWithStore("webhook-uninstall@example.test"));
    mock.products = PRODUCTS;

    // Establish some local data first.
    await deliver(body("product.created", { id: 1001 }));
    await drainWebhookEvents(getTestDb());

    const response = await deliver(body("app.uninstalled", { id: 55, app_name: "كشخة" }));
    expect(response.status).toBe(200);

    await drainWebhookEvents(getTestDb());

    const [connection] = await asTenant(owner.organizationId, (tx) =>
      tx.select().from(storeConnections).where(eq(storeConnections.id, owner.connectionId)),
    );

    // Reuses the Phase 03 disconnect: one code path, one meaning.
    expect(connection?.status).toBe("disconnected");
    expect(connection?.revokedAt).not.toBeNull();
    expect(connection?.accessTokenCiphertext).toBeNull();
    expect(connection?.refreshTokenCiphertext).toBeNull();

    // Data is retained: uninstalling ends access, not history.
    const stored = await asTenant(owner.organizationId, (tx) =>
      tx
        .select({ id: products.id })
        .from(products)
        .where(eq(products.organizationId, owner.organizationId)),
    );
    expect(stored).toHaveLength(1);
    const runs = await asTenant(owner.organizationId, (tx) =>
      tx.select().from(syncRuns).where(eq(syncRuns.organizationId, owner.organizationId)),
    );
    expect(runs.length).toBeGreaterThan(0);
  });

  it("records an app.store.authorize without touching stored tokens", async () => {
    const owner = await connectStore(await ownerWithStore("webhook-authorize@example.test"));

    const before = await asTenant(owner.organizationId, (tx) =>
      tx.select().from(storeConnections).where(eq(storeConnections.id, owner.connectionId)),
    );

    const response = await deliver(
      body("app.store.authorize", {
        access_token: "attacker-supplied-access-token",
        refresh_token: "attacker-supplied-refresh-token",
        expires: 1893456000,
        scope: "orders.read products.read",
        token_type: "bearer",
      }),
    );

    expect(response.status).toBe(200);
    await drainWebhookEvents(getTestDb());

    const after = await asTenant(owner.organizationId, (tx) =>
      tx.select().from(storeConnections).where(eq(storeConnections.id, owner.connectionId)),
    );

    expect(after[0]?.accessTokenCiphertext).toBe(before[0]?.accessTokenCiphertext);
    expect(after[0]?.refreshTokenCiphertext).toBe(before[0]?.refreshTokenCiphertext);
    expect(after[0]?.tokenVersion).toBe(before[0]?.tokenVersion);

    const [event] = await selectEvents(owner.organizationId);
    expect(event?.status).toBe("processed");
    expect(JSON.stringify(event?.payload)).not.toContain("attacker-supplied");
    expect(event?.result).toMatchObject({ action: "authorization_recorded" });
  });

  it("records an app.updated without overwriting connection state", async () => {
    const owner = await connectStore(await ownerWithStore("webhook-appupdated@example.test"));

    await deliver(body("app.updated", { id: 55, app_name: "كشخة", app_scopes: ["orders.read"] }));
    await drainWebhookEvents(getTestDb());

    const [connection] = await asTenant(owner.organizationId, (tx) =>
      tx.select().from(storeConnections).where(eq(storeConnections.id, owner.connectionId)),
    );
    expect(connection?.status).toBe("connected");

    const [event] = await selectEvents(owner.organizationId);
    expect(event?.status).toBe("processed");
    expect(event?.result).toMatchObject({ action: "app_update_recorded" });
  });
});

describe("replay and the admin surface", () => {
  it("replays from the API, re-processing a dead letter after the fault is fixed", async () => {
    const owner = await connectStore(await ownerWithStore("webhook-replay@example.test"));
    mock.behaviour.catalogStatus = 500;

    await deliver(body("product.created", { id: 1001 }));
    for (let attempt = 0; attempt < 3; attempt += 1) {
      await executeAsAdmin(`update webhook_events set available_at = now() - interval '1 second'`);
      await drainWebhookEvents(getTestDb());
    }

    const [dead] = await selectEvents(owner.organizationId);
    expect(dead?.status).toBe("dead_letter");

    mock.behaviour.catalogStatus = null;
    mock.products = PRODUCTS;

    const replay = await owner.client.request<{ eventId: string; status: string }>(
      "POST",
      `/api/organizations/current/stores/${owner.storeId}/webhooks/${dead!.id}/replay`,
      { body: {}, params: { eventId: dead!.id } },
    );

    expect(replay.status).toBe(200);
    expect(replay.body.data).toEqual({ eventId: dead!.id, status: "received" });

    await drainWebhookEvents(getTestDb());

    const [event] = await selectEvents(owner.organizationId);
    expect(event?.status).toBe("processed");
    expect(event?.attemptCount).toBe(1);
    expect(event?.lastErrorCode).toBeNull();
  });

  it("lets a reader see the log but refuses the replay (RBAC)", async () => {
    const owner = await connectStore(await ownerWithStore("webhook-replay-rbac@example.test"));

    await deliver(body("future.event.name", { id: 1 }));
    await drainWebhookEvents(getTestDb());

    const [event] = await selectEvents(owner.organizationId);
    expect(event?.status).toBe("ignored");

    const viewer = await inviteAndAccept(owner, "webhook-viewer@example.test", "viewer");

    const list = await viewer.client.get(
      `/api/organizations/current/stores/${owner.storeId}/webhooks`,
    );
    expect(list.status).toBe(200);

    const replay = await viewer.client.request(
      "POST",
      `/api/organizations/current/stores/${owner.storeId}/webhooks/${event!.id}/replay`,
      { body: {}, params: { eventId: event!.id } },
    );
    expect(replay.status).toBe(403);
    expect(replay.body.error?.code).toBe("FORBIDDEN");

    const [stillThere] = await selectEvents(owner.organizationId);
    expect(stillThere?.status).toBe("ignored");
  });

  it("lists the store's events with counts", async () => {
    const owner = await connectStore(await ownerWithStore("webhook-list@example.test"));

    await deliver(body("future.event.name", { id: 1 }));
    await deliver(body("future.event.name", { id: 2 }));
    await drainWebhookEvents(getTestDb());

    const response = await owner.client.get<{
      counts: Record<string, number>;
      events: Array<{ status: string }>;
      total: number;
    }>(`/api/organizations/current/stores/${owner.storeId}/webhooks`);

    expect(response.status).toBe(200);
    expect(response.body.data?.total).toBe(2);
    expect(response.body.data?.counts.ignored).toBe(2);
  });

  it("denies another organization: the event is simply not found (Org A / Org B)", async () => {
    const orgA = await connectStore(await ownerWithStore("webhook-org-a@example.test"));
    const orgB = await ownerWithStore("webhook-org-b@example.test");

    await deliver(body("future.event.name", { id: 1 }));
    await drainWebhookEvents(getTestDb());

    const [eventA] = await selectEvents(orgA.organizationId);
    expect(eventA).toBeDefined();

    // Org B cannot even see Org A's store.
    const listAttempt = await orgB.client.get(
      `/api/organizations/current/stores/${orgA.storeId}/webhooks`,
    );
    expect(listAttempt.status).toBe(404);

    // Nor replay Org A's event, through Org A's store id...
    const foreignStore = await orgB.client.request(
      "POST",
      `/api/organizations/current/stores/${orgA.storeId}/webhooks/${eventA!.id}/replay`,
      { body: {}, params: { eventId: eventA!.id } },
    );
    expect(foreignStore.status).toBe(404);

    // ...or through an event id presented with Org B's own store id.
    const listB = await orgB.client.get<{ stores: Array<{ id: string }> }>(
      "/api/organizations/current/stores",
    );
    const storeB = listB.body.data?.stores[0]?.id;
    expect(storeB).toBeDefined();

    const foreignEvent = await orgB.client.request(
      "POST",
      `/api/organizations/current/stores/${storeB}/webhooks/${eventA!.id}/replay`,
      { body: {}, params: { eventId: eventA!.id } },
    );
    expect(foreignEvent.status).toBe(404);

    // The row is untouched by the attempts.
    const [stillThere] = await selectEvents(orgA.organizationId);
    expect(stillThere?.status).toBe("ignored");
  });
});

describe("scheduled worker pump", () => {
  const TOKEN = "worker-token-for-integration-tests";

  async function callDrain(authorization?: string) {
    const { POST } = await import("@/app/api/internal/webhooks/drain/route");
    const headers = new Headers({ host: "localhost:3000" });
    if (authorization) headers.set("authorization", authorization);

    const response = await POST(
      new NextRequest(`${BASE_URL}/api/internal/webhooks/drain`, { method: "POST", headers }),
    );

    return { status: response.status, body: (await response.json()) as Record<string, unknown> };
  }

  async function withToken<T>(value: string | undefined, work: () => Promise<T>): Promise<T> {
    const previous = process.env.WEBHOOK_WORKER_TOKEN;
    if (value === undefined) delete process.env.WEBHOOK_WORKER_TOKEN;
    else process.env.WEBHOOK_WORKER_TOKEN = value;

    const { resetServerEnvCache } = await import("@/lib/env");
    resetServerEnvCache();

    try {
      return await work();
    } finally {
      // `process.env.X = undefined` stores the *string* "undefined", which would
      // fail validation for every later test in the file.
      if (previous === undefined) delete process.env.WEBHOOK_WORKER_TOKEN;
      else process.env.WEBHOOK_WORKER_TOKEN = previous;
      resetServerEnvCache();
    }
  }

  it("does not exist when no worker token is configured", async () => {
    await withToken(undefined, async () => {
      const response = await callDrain(`Bearer ${TOKEN}`);
      expect(response.status).toBe(404);
    });
  });

  it("rejects a missing or wrong bearer token", async () => {
    await withToken(TOKEN, async () => {
      expect((await callDrain()).status).toBe(401);
      expect((await callDrain("Bearer wrong-token-value-x")).status).toBe(401);
    });
  });

  it("drains the due queue when called with the token", async () => {
    const owner = await connectStore(await ownerWithStore("webhook-pump@example.test"));

    await deliver(body("future.event.name", { id: 1 }));
    await deliver(body("future.event.name", { id: 2 }));

    await withToken(TOKEN, async () => {
      const response = await callDrain(`Bearer ${TOKEN}`);
      expect(response.status).toBe(200);
      expect(response.body.data).toMatchObject({ claimed: 2, ignored: 2 });
    });

    const events = await selectEvents(owner.organizationId);
    expect(events.every((event) => event.status === "ignored")).toBe(true);
  });
});

describe("row-level security on the inbox", () => {
  it("shows a tenant only its own events, even when ids are known", async () => {
    const orgA = await connectStore(await ownerWithStore("webhook-rls-a@example.test"));
    const orgB = await ownerWithStore("webhook-rls-b@example.test");

    await deliver(body("future.event.name", { id: 1 }));

    const visibleToA = await selectEvents(orgA.organizationId);
    const visibleToB = await selectEvents(orgB.organizationId);

    expect(visibleToA).toHaveLength(1);
    expect(visibleToB).toHaveLength(0);

    // No tenant context at all: nothing is visible, not even with the right id.
    const anonymous = await getTestDb()
      .select({ id: webhookEvents.id })
      .from(webhookEvents)
      .where(eq(webhookEvents.id, visibleToA[0]!.id));
    expect(anonymous).toHaveLength(0);
  });

  it("refuses a cross-tenant update through the app role", async () => {
    const orgA = await connectStore(await ownerWithStore("webhook-rls-update-a@example.test"));
    const orgB = await ownerWithStore("webhook-rls-update-b@example.test");

    await deliver(body("future.event.name", { id: 1 }));
    const [eventA] = await selectEvents(orgA.organizationId);

    const changed = await asTenant(orgB.organizationId, (tx) =>
      tx
        .update(webhookEvents)
        .set({ status: "processed" })
        .where(eq(webhookEvents.id, eventA!.id))
        .returning({ id: webhookEvents.id }),
    );

    expect(changed).toHaveLength(0);
    const [unchanged] = await selectEvents(orgA.organizationId);
    expect(unchanged?.status).toBe("received");
  });
});

describe("secrets and logs", () => {
  it("never stores the webhook secret or the signature in the database", async () => {
    const owner = await connectStore(await ownerWithStore("webhook-secret@example.test"));

    const raw = body("product.created", { id: 1001 });
    const signature = signSallaWebhookBody(raw, WEBHOOK_SECRET);
    await deliver(raw, { signature });
    await drainWebhookEvents(getTestDb());

    const [event] = await selectEvents(owner.organizationId);
    const serialised = JSON.stringify(event);

    expect(serialised).not.toContain(WEBHOOK_SECRET);
    expect(serialised).not.toContain(signature);
    expect(serialised.toLowerCase()).not.toContain("secret");
  });

  it("audits the delivery and the processing without any payload content", async () => {
    const owner = await connectStore(await ownerWithStore("webhook-audit@example.test"));

    await deliver(body("future.event.name", { id: 1 }));
    await drainWebhookEvents(getTestDb());

    const admin = postgres(adminDatabaseUrl().replace(/\/[^/]*$/, `/${TEST_DATABASE.name}`), {
      max: 1,
      onnotice: () => undefined,
    });

    try {
      const rows = (await admin.unsafe(
        `select action, metadata::text as metadata from audit_logs
          where organization_id = $1 order by created_at asc`,
        [owner.organizationId],
      )) as unknown as Array<{ action: string; metadata: string }>;

      const actions = rows.map((row) => row.action);
      expect(actions).toContain("webhook.received");
      expect(actions).toContain("webhook.processed");

      const metadata = rows.map((row) => row.metadata).join(" ");
      expect(metadata).not.toContain(WEBHOOK_SECRET);
      expect(metadata.toLowerCase()).not.toContain("signature");
    } finally {
      await admin.end({ timeout: 5 });
    }
  });
});
