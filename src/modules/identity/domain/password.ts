import { randomBytes, scrypt as scryptCallback, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";

import { AppError } from "@/lib/errors";

/**
 * Password hashing policy (Phase 02, see docs/phase-02.md §3.1).
 *
 * scrypt is a memory-hard KDF available in Node without a native dependency.
 * Parameters are stored alongside the digest so they can be raised later and
 * old hashes upgraded on the next successful login.
 */

const scrypt = promisify(scryptCallback) as (
  password: string | Buffer,
  salt: string | Buffer,
  keylen: number,
  options: { N: number; r: number; p: number; maxmem: number },
) => Promise<Buffer>;

export const PASSWORD_MIN_LENGTH = 12;
export const PASSWORD_MAX_LENGTH = 128;

const PARAMS = {
  N: 16384,
  r: 8,
  p: 1,
  keyLength: 64,
  saltBytes: 16,
  maxmem: 64 * 1024 * 1024,
} as const;

/** Upper bounds prevent a malicious stored hash from turning verification into a DoS. */
const MAX_PARAMS = { N: 1 << 20, r: 32, p: 16 } as const;

const SCHEME = "scrypt";

export function assertPasswordPolicy(password: string): void {
  if (password.length < PASSWORD_MIN_LENGTH) {
    throw new AppError({
      code: "VALIDATION_FAILED",
      message: `Password must be at least ${PASSWORD_MIN_LENGTH} characters.`,
      details: { field: "password", rule: "min_length" },
    });
  }

  if (password.length > PASSWORD_MAX_LENGTH) {
    throw new AppError({
      code: "VALIDATION_FAILED",
      message: `Password must be at most ${PASSWORD_MAX_LENGTH} characters.`,
      details: { field: "password", rule: "max_length" },
    });
  }
}

export async function hashPassword(password: string): Promise<string> {
  assertPasswordPolicy(password);

  const salt = randomBytes(PARAMS.saltBytes);
  const derived = await scrypt(password, salt, PARAMS.keyLength, {
    N: PARAMS.N,
    r: PARAMS.r,
    p: PARAMS.p,
    maxmem: PARAMS.maxmem,
  });

  return [
    SCHEME,
    PARAMS.N,
    PARAMS.r,
    PARAMS.p,
    salt.toString("base64"),
    derived.toString("base64"),
  ].join("$");
}

interface ParsedHash {
  N: number;
  r: number;
  p: number;
  salt: Buffer;
  digest: Buffer;
}

function parseHash(stored: string): ParsedHash | null {
  const parts = stored.split("$");
  if (parts.length !== 6 || parts[0] !== SCHEME) return null;

  const N = Number(parts[1]);
  const r = Number(parts[2]);
  const p = Number(parts[3]);

  if (!Number.isInteger(N) || !Number.isInteger(r) || !Number.isInteger(p)) return null;
  if (N < 1024 || N > MAX_PARAMS.N || r < 1 || r > MAX_PARAMS.r || p < 1 || p > MAX_PARAMS.p) {
    return null;
  }

  try {
    const salt = Buffer.from(parts[4] ?? "", "base64");
    const digest = Buffer.from(parts[5] ?? "", "base64");
    if (salt.length < 8 || digest.length < 16) return null;
    return { N, r, p, salt, digest };
  } catch {
    return null;
  }
}

/**
 * Verifies a password against a stored hash.
 *
 * Returns `false` for malformed hashes instead of throwing, so callers can keep
 * a single generic failure path.
 */
export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const parsed = parseHash(stored);
  if (!parsed) return false;

  const derived = await scrypt(password, parsed.salt, parsed.digest.length, {
    N: parsed.N,
    r: parsed.r,
    p: parsed.p,
    maxmem: PARAMS.maxmem,
  });

  if (derived.length !== parsed.digest.length) return false;
  return timingSafeEqual(derived, parsed.digest);
}

let dummyHash: Promise<string> | null = null;

/**
 * Hash used when an email is unknown, so a failed login costs roughly the same
 * scrypt work as a real one. The plaintext is random and discarded.
 */
export function getDummyPasswordHash(): Promise<string> {
  dummyHash ??= hashPassword(randomBytes(24).toString("base64url"));
  return dummyHash;
}
