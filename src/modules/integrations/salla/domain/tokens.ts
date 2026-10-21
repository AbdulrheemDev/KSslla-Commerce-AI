/**
 * Token lifetime arithmetic.
 *
 * Documented facts (docs.salla.dev/doc-421118):
 * - Access tokens live 14 days.
 * - Refresh tokens live 1 month and are single-use with rotation.
 * - The token response expresses access lifetime as `expires` (seconds
 *   timestamp). Some responses use `expires_in`; both are accepted.
 *
 * The numbers here are the fallback only when Salla omits the field. They are
 * never used to extend a token beyond what the provider said.
 */

export const ACCESS_TOKEN_TTL_MS = 14 * 24 * 60 * 60 * 1000;
/** Alias used in documentation and tests. */
export const ACCESS_TOKEN_FALLBACK_MS = ACCESS_TOKEN_TTL_MS;
export const REFRESH_TOKEN_TTL_MS = 30 * 24 * 60 * 60 * 1000;

/** Refresh this long before expiry to avoid a request racing the deadline. */
export const ACCESS_TOKEN_SKEW_MS = 60 * 1000;

/** A refresh in progress is restarted only after this long. */
export const REFRESH_LEASE_MS = 30 * 1000;
/** Lease length in seconds, as stored in the connection row. */
export const REFRESH_LEASE_SECONDS = REFRESH_LEASE_MS / 1000;

export interface AccessExpiryInput {
  now: Date;
  expiresIn?: number | string | null;
  expiresAtEpoch?: number | string | null;
}

function toFiniteNumber(value: number | string | null | undefined): number | null {
  if (value === null || value === undefined || value === "") return null;
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

/**
 * Resolves the access-token expiry.
 *
 * `expires_in` is seconds from now. `expires` is documented as a seconds
 * timestamp; a millisecond timestamp is tolerated for robustness. An invalid
 * value never produces `Infinity` or `Invalid Date` — it falls back to the
 * documented lifetime, which only shortens nothing and is never persisted as a
 * silent extension.
 */
export function computeAccessTokenExpiry(input: AccessExpiryInput): Date {
  const nowMs = input.now.getTime();

  const expiresIn = toFiniteNumber(input.expiresIn);
  if (expiresIn !== null && expiresIn > 0) {
    return new Date(nowMs + expiresIn * 1000);
  }

  const epoch = toFiniteNumber(input.expiresAtEpoch);
  if (epoch !== null && epoch > 0) {
    return new Date(epoch > 1e12 ? epoch : epoch * 1000);
  }

  return new Date(nowMs + ACCESS_TOKEN_TTL_MS);
}

export function computeRefreshTokenExpiry(now: Date, refreshToken?: string | null): Date | null {
  // No refresh token means nothing to expire; Salla issues one only when
  // `offline_access` was requested and granted.
  if (refreshToken === null) return null;
  return new Date(now.getTime() + REFRESH_TOKEN_TTL_MS);
}

export function isAccessTokenUsable(expiresAt: Date | null, now: Date = new Date()): boolean {
  if (!expiresAt) return false;
  return expiresAt.getTime() - ACCESS_TOKEN_SKEW_MS > now.getTime();
}

export function isExpired(expiresAt: Date | null, now: Date = new Date()): boolean {
  return expiresAt !== null && expiresAt.getTime() <= now.getTime();
}

/**
 * States in which a stored access token may be used. `refreshing` is included
 * because a concurrent worker may be holding the lease while the current token
 * is still valid.
 */
export function isConnectionUsable(status: string): boolean {
  return status === "connected" || status === "refreshing";
}
