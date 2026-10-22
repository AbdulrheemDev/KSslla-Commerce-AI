import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

import { getServerEnv } from "@/lib/env";
import { AppError } from "@/lib/errors";

/**
 * Authenticated symmetric encryption for stored provider secrets.
 *
 * AES-256-GCM with a fresh 12-byte IV per value and a 16-byte tag. The
 * additional authenticated data binds the ciphertext to its tenant, so a row
 * copied to another store or organization fails to decrypt.
 *
 * Format: `v1.<iv>.<tag>.<ciphertext>` (base64url).
 */

const VERSION = "v1";
const IV_BYTES = 12;
const TAG_BYTES = 16;

export function parseEncryptionKey(value: string): Buffer {
  if (!/^[0-9a-fA-F]{64}$/.test(value)) {
    throw new AppError({
      code: "CONFIG_INVALID",
      message: "ENCRYPTION_KEY must be 32 bytes encoded as 64 hexadecimal characters.",
    });
  }
  return Buffer.from(value, "hex");
}

function encryptionKey(): Buffer {
  const configured = getServerEnv().ENCRYPTION_KEY;

  if (!configured) {
    // No fallback key: a missing key is a configuration failure, never a
    // silently weaker default.
    throw new AppError({
      code: "CONFIG_INVALID",
      message: "ENCRYPTION_KEY is not configured.",
    });
  }

  return parseEncryptionKey(configured);
}

export interface EncryptionOptions {
  /** Overrides the environment key. Tests only. */
  key?: Buffer;
}

export function encryptSecret(
  plaintext: string,
  aad: string,
  options: EncryptionOptions = {},
): string {
  if (!plaintext) {
    throw new AppError({ code: "INTERNAL", message: "Cannot encrypt an empty secret." });
  }

  const key = options.key ?? encryptionKey();
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  cipher.setAAD(Buffer.from(aad, "utf8"));

  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();

  return [
    VERSION,
    iv.toString("base64url"),
    tag.toString("base64url"),
    ciphertext.toString("base64url"),
  ].join(".");
}

export function decryptSecret(
  payload: string,
  aad: string,
  options: EncryptionOptions = {},
): string {
  const parts = payload.split(".");
  if (parts.length !== 4 || parts[0] !== VERSION) {
    throw decryptError();
  }

  const [, ivPart, tagPart, dataPart] = parts;
  if (!ivPart || !tagPart || !dataPart) throw decryptError();

  const iv = Buffer.from(ivPart, "base64url");
  const tag = Buffer.from(tagPart, "base64url");
  const data = Buffer.from(dataPart, "base64url");

  if (iv.length !== IV_BYTES || tag.length !== TAG_BYTES) throw decryptError();

  try {
    const decipher = createDecipheriv("aes-256-gcm", options.key ?? encryptionKey(), iv);
    decipher.setAAD(Buffer.from(aad, "utf8"));
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(data), decipher.final()]).toString("utf8");
  } catch {
    // Tampered ciphertext, wrong key, or wrong AAD. Never echo the input.
    throw decryptError("Secret authentication failed.");
  }
}

function decryptError(message = "Stored secret is malformed."): AppError {
  return new AppError({ code: "INTERNAL", message });
}

/** Stable AAD for a provider connection. Never includes the token itself. */
export function connectionAad(input: {
  provider: string;
  organizationId: string;
  storeId: string;
}): string {
  return `provider=${input.provider};org=${input.organizationId};store=${input.storeId}`;
}
