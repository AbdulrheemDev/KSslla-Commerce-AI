import { createHmac } from "node:crypto";

import { describe, expect, it } from "vitest";

import {
  SALLA_SECURITY_STRATEGY_HEADER,
  SALLA_SIGNATURE_HEADER,
  safeEqualString,
  signSallaWebhookBody,
  verifySallaWebhookSignature,
} from "@/modules/webhooks/domain/signature";

/**
 * Signature verification.
 *
 * Salla signs the webhook body with HMAC-SHA256 and sends the digest as hex in
 * `X-Salla-Signature` alongside `X-Salla-Security-Strategy: Signature`
 * (docs/salla-reference.md §14.2). The tests below fix the properties we rely on:
 * the digest is over the exact bytes received, comparison is constant-time, and
 * anything that is not a Signature-strategy verification is refused.
 */

const SECRET = "unit-test-webhook-secret";
const BODY = JSON.stringify({ event: "order.created", merchant: 847769313, data: { id: 1 } });

function signed(body: string, secret = SECRET): string {
  return createHmac("sha256", secret).update(body, "utf8").digest("hex");
}

describe("signSallaWebhookBody", () => {
  it("produces the documented HMAC-SHA256 hex digest", () => {
    expect(signSallaWebhookBody(BODY, SECRET)).toBe(signed(BODY));
    expect(signSallaWebhookBody(BODY, SECRET)).toHaveLength(64);
    expect(signSallaWebhookBody(BODY, SECRET)).toMatch(/^[0-9a-f]{64}$/);
  });

  it("is sensitive to a single byte of the body", () => {
    expect(signSallaWebhookBody(BODY, SECRET)).not.toBe(signSallaWebhookBody(`${BODY} `, SECRET));
  });
});

describe("verifySallaWebhookSignature", () => {
  it("accepts a correct signature", () => {
    const result = verifySallaWebhookSignature({
      rawBody: BODY,
      signature: signed(BODY),
      strategy: "Signature",
      secret: SECRET,
    });

    expect(result).toMatchObject({ ok: true, strategy: "Signature" });
    expect(result.ok && result.strategyHeaderPresent).toBe(true);
  });

  it("accepts a correct signature when the strategy header is absent", () => {
    // The header is informational; the digest is what proves authenticity.
    const result = verifySallaWebhookSignature({
      rawBody: BODY,
      signature: signed(BODY),
      strategy: null,
      secret: SECRET,
    });

    expect(result.ok).toBe(true);
  });

  it("rejects a signature computed over a re-serialised body", () => {
    // The docs sample signs `JSON.stringify(req.body)`. We sign the raw bytes,
    // so a prettified or key-reordered body must not verify against a raw-body
    // signature — this is why parsing before verifying is forbidden.
    const reordered = JSON.stringify(JSON.parse(BODY), null, 2);
    const result = verifySallaWebhookSignature({
      rawBody: reordered,
      signature: signed(BODY),
      strategy: "Signature",
      secret: SECRET,
    });

    expect(result).toEqual({ ok: false, reason: "invalid_signature" });
  });

  it("rejects a body signed with a different secret", () => {
    const result = verifySallaWebhookSignature({
      rawBody: BODY,
      signature: signed(BODY, "another-secret"),
      strategy: "Signature",
      secret: SECRET,
    });

    expect(result).toEqual({ ok: false, reason: "invalid_signature" });
  });

  it("rejects a missing signature", () => {
    for (const signature of [null, "", "   "]) {
      expect(
        verifySallaWebhookSignature({
          rawBody: BODY,
          signature,
          strategy: "Signature",
          secret: SECRET,
        }),
      ).toEqual({ ok: false, reason: "missing_signature" });
    }
  });

  it("rejects a malformed signature without throwing", () => {
    for (const signature of [
      "not-hex",
      "abc",
      `${signed(BODY)}00`,
      signed(BODY).toUpperCase().replace(/^./, "Z"),
      "0".repeat(128),
    ]) {
      const result = verifySallaWebhookSignature({
        rawBody: BODY,
        signature,
        strategy: "Signature",
        secret: SECRET,
      });

      expect(result.ok).toBe(false);
      expect(result).toMatchObject({ reason: "invalid_signature" });
    }
  });

  it("rejects the Token strategy, which this endpoint does not implement", () => {
    const result = verifySallaWebhookSignature({
      rawBody: BODY,
      signature: signed(BODY),
      strategy: "Token",
      secret: SECRET,
    });

    expect(result).toEqual({ ok: false, reason: "unsupported_strategy" });
  });

  it("rejects an unknown strategy rather than falling back to signature mode", () => {
    const result = verifySallaWebhookSignature({
      rawBody: BODY,
      signature: signed(BODY),
      strategy: "HMAC",
      secret: SECRET,
    });

    expect(result).toEqual({ ok: false, reason: "unsupported_strategy" });
  });

  it("reports a missing secret instead of accepting anything", () => {
    const result = verifySallaWebhookSignature({
      rawBody: BODY,
      signature: signed(BODY),
      strategy: "Signature",
      secret: null,
    });

    expect(result).toEqual({ ok: false, reason: "secret_not_configured" });
  });

  it("never returns the secret or the expected digest to the caller", () => {
    const failure = verifySallaWebhookSignature({
      rawBody: BODY,
      signature: signed(BODY, "wrong"),
      strategy: "Signature",
      secret: SECRET,
    });

    const serialised = JSON.stringify(failure);
    expect(serialised).not.toContain(SECRET);
    expect(serialised).not.toContain(signed(BODY));
  });

  it("exposes the header names Salla documents", () => {
    expect(SALLA_SIGNATURE_HEADER).toBe("x-salla-signature");
    expect(SALLA_SECURITY_STRATEGY_HEADER).toBe("x-salla-security-strategy");
  });

  it("compares in constant time regardless of where the digest differs", () => {
    // A first-character mismatch and a last-character mismatch must cost the
    // same; the implementation delegates to `timingSafeEqual`, and this guards
    // the length guard in front of it (timingSafeEqual throws on unequal sizes).
    const base = signed(BODY);
    const firstDiff = `f${base.slice(1)}`;
    const lastDiff = `${base.slice(0, -1)}f`;

    for (const candidate of [firstDiff, lastDiff]) {
      expect(
        verifySallaWebhookSignature({
          rawBody: BODY,
          signature: candidate === base ? "" : candidate,
          strategy: "Signature",
          secret: SECRET,
        }).ok,
      ).toBe(false);
    }
  });
});

describe("safeEqualString", () => {
  it("accepts identical strings and rejects different ones", () => {
    expect(safeEqualString("worker-token-value", "worker-token-value")).toBe(true);
    expect(safeEqualString("worker-token-value", "worker-token-valuE")).toBe(false);
  });

  it("rejects strings of a different length instead of throwing", () => {
    // `timingSafeEqual` throws on unequal buffers; the guard must absorb that.
    expect(safeEqualString("short", "a-much-longer-value")).toBe(false);
    expect(safeEqualString("value", "")).toBe(false);
  });
});
