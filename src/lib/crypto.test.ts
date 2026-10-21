import { describe, expect, it } from "vitest";

import { connectionAad, decryptSecret, encryptSecret, parseEncryptionKey } from "@/lib/crypto";

const KEY_HEX = "a".repeat(64);
const KEY = parseEncryptionKey(KEY_HEX);
const OTHER_KEY = parseEncryptionKey("b".repeat(64));
const AAD = connectionAad({ provider: "salla", organizationId: "org-1", storeId: "store-1" });

describe("secret encryption", () => {
  it("round-trips a token", () => {
    const ciphertext = encryptSecret("access-token-value", AAD, { key: KEY });

    expect(ciphertext).not.toContain("access-token-value");
    expect(ciphertext.startsWith("v1.")).toBe(true);
    expect(decryptSecret(ciphertext, AAD, { key: KEY })).toBe("access-token-value");
  });

  it("uses a fresh nonce for every value", () => {
    const first = encryptSecret("same-token", AAD, { key: KEY });
    const second = encryptSecret("same-token", AAD, { key: KEY });

    expect(first).not.toBe(second);
    expect(decryptSecret(first, AAD, { key: KEY })).toBe("same-token");
    expect(decryptSecret(second, AAD, { key: KEY })).toBe("same-token");
  });

  it("rejects a tampered ciphertext payload", () => {
    const ciphertext = encryptSecret("token", AAD, { key: KEY });
    const parts = ciphertext.split(".");
    const data = parts[3]!;
    const tampered = [...parts.slice(0, 3), data.slice(0, -2) + (data.endsWith("A") ? "BB" : "AA")];

    expect(() => decryptSecret(tampered.join("."), AAD, { key: KEY })).toThrowError(
      /Stored secret|authentication/i,
    );
  });

  it("rejects a swapped authentication tag", () => {
    const a = encryptSecret("token-a", AAD, { key: KEY }).split(".");
    const b = encryptSecret("token-b", AAD, { key: KEY }).split(".");

    expect(() => decryptSecret([a[0], a[1], b[2], a[3]].join("."), AAD, { key: KEY })).toThrow();
  });

  it("binds the ciphertext to the tenant through the AAD", () => {
    const ciphertext = encryptSecret("tenant-token", AAD, { key: KEY });
    const otherStore = connectionAad({
      provider: "salla",
      organizationId: "org-1",
      storeId: "store-2",
    });

    expect(() => decryptSecret(ciphertext, otherStore, { key: KEY })).toThrow();
  });

  it("rejects a different key", () => {
    const ciphertext = encryptSecret("token", AAD, { key: KEY });
    expect(() => decryptSecret(ciphertext, AAD, { key: OTHER_KEY })).toThrow();
  });

  it("rejects malformed payloads without echoing them", () => {
    for (const payload of ["", "v1.abc", "v2.a.b.c", "v1....", "plain-token"]) {
      expect(() => decryptSecret(payload, AAD, { key: KEY })).toThrowError(/Stored secret/);
    }
  });

  it("requires a 32-byte hex key and never invents one", () => {
    expect(() => parseEncryptionKey("too-short")).toThrow();
    expect(() => parseEncryptionKey("z".repeat(64))).toThrow();
    expect(parseEncryptionKey(KEY_HEX)).toHaveLength(32);
  });

  it("refuses to encrypt an empty secret", () => {
    expect(() => encryptSecret("", AAD, { key: KEY })).toThrow();
  });

  it("produces an AAD that identifies the tenant, not the token", () => {
    expect(AAD).toBe("provider=salla;org=org-1;store=store-1");
  });
});
