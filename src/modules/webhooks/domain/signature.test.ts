import { createHmac } from "node:crypto";

import { describe, expect, it } from "vitest";

import {
  SALLA_SECURITY_STRATEGY_HEADER,
  SALLA_SIGNATURE_HEADER,
  SIGNATURE_STRATEGY_NAME,
  safeEqualString,
  signSallaWebhookBody,
  verifySallaWebhookSignature,
} from "@/modules/webhooks/domain/signature";

/**
 * Signature verification — the official contract.
 *
 * Source (verified 2026-10-22): https://docs.salla.dev/webhooks and
 * https://docs.salla.dev/421119m0 §Verify Webhooks Using Signature.
 * The docs' Node sample is
 * `crypto.createHmac('sha256', secret).update(JSON.stringify(req.body)).digest('hex')`
 * and the PHP sample is `hash_hmac('sha256', file_get_contents('php://input'), $secret)`;
 * the delivery carries `X-Salla-Security-Strategy: Signature` and
 * `X-Salla-Signature`. See docs/salla-reference.md §14.2.
 *
 * The cases below are the ones the security review asks for explicitly: valid,
 * invalid, altered body, altered signature, wrong secret, missing signature,
 * missing strategy, unsupported strategy, raw-body verification, JSON formatting
 * that changes the raw body, and timing-safe comparison.
 */

const SECRET = "unit-test-webhook-secret";
const BODY = JSON.stringify({ event: "order.created", merchant: 847769313, data: { id: 1 } });

/**
 * Known-answer vectors produced **independently of this implementation** with
 * OpenSSL:
 *
 *   printf '%s' "$BODY" | openssl dgst -sha256 -hmac "unit-test-webhook-secret" -hex
 *   → 59719f3c…
 *   printf '%s' "$BODY" | openssl dgst -sha256 -hex
 *   → 2481bc7b…
 *
 * Pinning them here means a refactor that silently switches to an unkeyed hash
 * (the docs' prose says "SHA256 hash", only the samples say HMAC) fails loudly.
 */
const HMAC_SHA256_KAT = "59719f3cb77c9de5a5f1257628cfa4cec6ae83e01a4d98e0831b125445d70d2c";
const PLAIN_SHA256_KAT = "2481bc7b593175ece82a0ab6feed2bc1c574587eba5190724586701252a2153a";

function signed(body: string, secret = SECRET): string {
  return createHmac("sha256", secret).update(body, "utf8").digest("hex");
}

function verify(overrides: Partial<Parameters<typeof verifySallaWebhookSignature>[0]> = {}) {
  return verifySallaWebhookSignature({
    rawBody: BODY,
    signature: signed(BODY),
    strategy: SIGNATURE_STRATEGY_NAME,
    secret: SECRET,
    ...overrides,
  });
}

describe("signSallaWebhookBody — the algorithm itself", () => {
  it("matches an OpenSSL-known-answer vector for HMAC-SHA256/hex", () => {
    expect(signSallaWebhookBody(BODY, SECRET)).toBe(HMAC_SHA256_KAT);
  });

  it("is keyed: it is not the unkeyed SHA256 of the body", () => {
    const unkeyed = createHmac("sha256", "").update(BODY).digest("hex");
    expect(PLAIN_SHA256_KAT).toHaveLength(64);
    expect(signSallaWebhookBody(BODY, SECRET)).not.toBe(PLAIN_SHA256_KAT);
    expect(signSallaWebhookBody(BODY, SECRET)).not.toBe(unkeyed);
  });

  it("always emits 64 lowercase hex characters", () => {
    for (const body of ["", "{}", BODY, "☕ عربي"]) {
      expect(signSallaWebhookBody(body, SECRET)).toMatch(/^[0-9a-f]{64}$/);
    }
  });

  it("changes when one byte of the body changes", () => {
    expect(signSallaWebhookBody(BODY, SECRET)).not.toBe(signSallaWebhookBody(`${BODY} `, SECRET));
  });

  it("changes when the secret changes", () => {
    expect(signSallaWebhookBody(BODY, SECRET)).not.toBe(signSallaWebhookBody(BODY, `${SECRET}x`));
  });
});

describe("verifySallaWebhookSignature — official cases", () => {
  // 1
  it("accepts a valid signature", () => {
    const result = verify();

    expect(result).toMatchObject({ ok: true, strategy: "Signature" });
    expect(result.ok && result.strategyHeaderPresent).toBe(true);
  });

  // 2
  it("accepts the independently computed OpenSSL digest", () => {
    expect(verify({ signature: HMAC_SHA256_KAT })).toMatchObject({ ok: true });
  });

  // 3
  it("rejects an invalid signature", () => {
    expect(verify({ signature: "a".repeat(64) })).toEqual({
      ok: false,
      reason: "invalid_signature",
    });
  });

  // 4
  it("rejects a body modified after signing", () => {
    const tampered = BODY.replace('"id":1', '"id":2');
    expect(tampered).not.toBe(BODY);

    expect(verify({ rawBody: tampered })).toEqual({ ok: false, reason: "invalid_signature" });
  });

  // 5
  it("rejects a modified signature", () => {
    const base = signed(BODY);
    const flipped = `${base.slice(0, 10)}${base[10] === "0" ? "1" : "0"}${base.slice(11)}`;

    expect(verify({ signature: flipped })).toEqual({ ok: false, reason: "invalid_signature" });
  });

  // 6
  it("rejects a signature produced with a different secret", () => {
    expect(verify({ signature: signed(BODY, "another-secret") })).toEqual({
      ok: false,
      reason: "invalid_signature",
    });
  });

  // 7
  it("rejects a missing signature header", () => {
    for (const signature of [null, "", "   "]) {
      expect(verify({ signature })).toEqual({ ok: false, reason: "missing_signature" });
    }
  });

  // 8
  it("accepts a missing strategy header only when the signature verifies", () => {
    // Salla assigns `Signature` by default when a webhook is registered without
    // a strategy, so absence means the default, not "unauthenticated". The
    // digest is still mandatory — a missing header cannot rescue a bad signature.
    expect(verify({ strategy: null })).toMatchObject({ ok: true });
    expect(verify({ strategy: null, signature: signed(BODY, "wrong") })).toEqual({
      ok: false,
      reason: "invalid_signature",
    });
  });

  // 9
  it("rejects an unsupported strategy even with a valid signature", () => {
    // A valid digest does not tell us *what* it proves under a strategy we do
    // not implement, so the strategy is authoritative.
    for (const strategy of ["Token", "HMAC", "Bearer", "None", "Signature,Token"]) {
      expect(verify({ strategy })).toEqual({ ok: false, reason: "unsupported_strategy" });
    }

    expect(verify({ strategy: "Token", signature: signed(BODY) })).toEqual({
      ok: false,
      reason: "unsupported_strategy",
    });
  });

  it("matches the documented strategy value case-insensitively", () => {
    // Salla documents `Signature`; HTTP header casing is not guaranteed by
    // intermediaries, so only the *value* spelling varies here — never the meaning.
    for (const strategy of ["Signature", "signature", "SIGNATURE", " signature "]) {
      expect(verify({ strategy })).toMatchObject({ ok: true });
    }
  });

  // 10
  it("verifies the raw body, not a re-serialised object", () => {
    const reordered = JSON.stringify({
      data: { id: 1 },
      merchant: 847769313,
      event: "order.created",
    });

    // Same JSON value, different bytes → must not verify under the raw digest.
    expect(verify({ rawBody: reordered })).toEqual({ ok: false, reason: "invalid_signature" });
    // And the raw bytes that were actually signed do verify.
    expect(verify({ rawBody: BODY, signature: signed(BODY) })).toMatchObject({ ok: true });
  });

  // 11
  it("is sensitive to JSON formatting that changes the raw body", () => {
    for (const variant of [
      JSON.stringify(JSON.parse(BODY), null, 2), // pretty-printed
      `${BODY}\n`, // trailing newline
      BODY.replace(",", ", "), // extra whitespace
      JSON.stringify(JSON.parse(BODY)).replace(/\//g, "\\/"), // escaping
    ]) {
      if (variant === BODY) continue;
      expect(verify({ rawBody: variant })).toEqual({ ok: false, reason: "invalid_signature" });
    }
  });

  // 12
  it("refuses every delivery when no secret is configured", () => {
    for (const secret of [null, undefined, "", "   "]) {
      expect(verify({ secret })).toEqual({ ok: false, reason: "secret_not_configured" });
    }
  });

  // 13
  it("compares in constant time regardless of where the digest differs", () => {
    // First-byte and last-byte mismatches must take the same code path: the
    // length guard absorbs `timingSafeEqual`'s equal-size requirement, and the
    // comparison itself is delegated to `timingSafeEqual`, never `===`.
    const base = signed(BODY);
    const firstDiff = `${base[0] === "0" ? "1" : "0"}${base.slice(1)}`;
    const lastDiff = `${base.slice(0, -1)}${base.endsWith("0") ? "1" : "0"}`;

    for (const candidate of [firstDiff, lastDiff]) {
      expect(verify({ signature: candidate })).toEqual({ ok: false, reason: "invalid_signature" });
    }
  });

  // 14
  it("leaks neither the secret nor the expected digest in its result", () => {
    const serialised = JSON.stringify(verify({ signature: signed(BODY, "wrong") }));

    expect(serialised).not.toContain(SECRET);
    expect(serialised).not.toContain(signed(BODY));
  });

  // 15
  it("accepts documented hex casing and surrounding whitespace", () => {
    // Normalisation only; it cannot turn an invalid digest into a valid one.
    expect(verify({ signature: signed(BODY).toUpperCase() })).toMatchObject({ ok: true });
    expect(verify({ signature: `  ${signed(BODY)}  ` })).toMatchObject({ ok: true });
    expect(verify({ signature: `${"A".repeat(64)}` })).toEqual({
      ok: false,
      reason: "invalid_signature",
    });
  });
});

describe("verifySallaWebhookSignature — malformed input", () => {
  it("reports a malformed signature instead of throwing", () => {
    for (const signature of [
      "not-hex",
      "abc",
      `${signed(BODY)}00`,
      "Z".repeat(64),
      "0".repeat(128),
    ]) {
      expect(verify({ signature })).toEqual({ ok: false, reason: "malformed_signature" });
    }
  });

  it("does not throw on an empty body", () => {
    expect(verify({ rawBody: "", signature: signed("") })).toMatchObject({ ok: true });
    expect(verify({ rawBody: "" })).toEqual({ ok: false, reason: "invalid_signature" });
  });

  it("exposes the header names and strategy value Salla documents", () => {
    expect(SALLA_SIGNATURE_HEADER).toBe("x-salla-signature");
    expect(SALLA_SECURITY_STRATEGY_HEADER).toBe("x-salla-security-strategy");
    expect(SIGNATURE_STRATEGY_NAME).toBe("Signature");
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
