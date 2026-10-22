import { describe, expect, it } from "vitest";

import {
  PASSWORD_MAX_LENGTH,
  PASSWORD_MIN_LENGTH,
  getDummyPasswordHash,
  hashPassword,
  verifyPassword,
} from "@/modules/identity/domain/password";
import { AppError } from "@/lib/errors";

describe("password hashing", () => {
  it("stores scrypt parameters and a random salt, never the password", async () => {
    const password = "correct horse battery staple";
    const hash = await hashPassword(password);

    expect(hash.startsWith("scrypt$16384$8$1$")).toBe(true);
    expect(hash).not.toContain(password);

    const parts = hash.split("$");
    expect(parts).toHaveLength(6);
    expect(Buffer.from(parts[4]!, "base64")).toHaveLength(16);
    expect(Buffer.from(parts[5]!, "base64")).toHaveLength(64);
  });

  it("produces a different hash for every call", async () => {
    const first = await hashPassword("same password value");
    const second = await hashPassword("same password value");
    expect(first).not.toBe(second);
    expect(await verifyPassword("same password value", first)).toBe(true);
    expect(await verifyPassword("same password value", second)).toBe(true);
  });

  it("verifies only the correct password", async () => {
    const hash = await hashPassword("a-very-long-password");
    expect(await verifyPassword("a-very-long-password", hash)).toBe(true);
    expect(await verifyPassword("a-very-long-passworD", hash)).toBe(false);
    expect(await verifyPassword("", hash)).toBe(false);
  });

  it("returns false for malformed or hostile hashes instead of throwing", async () => {
    expect(await verifyPassword("x", "")).toBe(false);
    expect(await verifyPassword("x", "bcrypt$whatever")).toBe(false);
    expect(await verifyPassword("x", "scrypt$notanumber$8$1$c2FsdA==$aGFzaA==")).toBe(false);
    // Absurd parameters must not turn verification into a DoS.
    expect(await verifyPassword("x", "scrypt$1073741824$8$1$c2FsdHNhbHQ=$aGFzaGhhc2hoYXNo")).toBe(
      false,
    );
  });

  it("enforces the documented length policy", async () => {
    await expect(hashPassword("short")).rejects.toBeInstanceOf(AppError);
    await expect(hashPassword("a".repeat(PASSWORD_MAX_LENGTH + 1))).rejects.toBeInstanceOf(
      AppError,
    );

    const hash = await hashPassword("b".repeat(PASSWORD_MIN_LENGTH));
    expect(hash.startsWith("scrypt$")).toBe(true);
  });

  it("exposes a dummy hash for timing-equalized failures", async () => {
    const hash = await getDummyPasswordHash();
    expect(hash.startsWith("scrypt$")).toBe(true);
    expect(await verifyPassword("anything", hash)).toBe(false);
    expect(await getDummyPasswordHash()).toBe(hash);
  });
});
