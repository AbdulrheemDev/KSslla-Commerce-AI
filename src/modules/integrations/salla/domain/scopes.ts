/**
 * Salla scopes.
 *
 * Phase 03 requests the absolute minimum: `offline_access` is the documented
 * prerequisite for a refresh token. Store identity is read from
 * `GET /oauth2/user/info`, whose documented payload already includes
 * `merchant.id`, so no merchant-data scope is requested "for later".
 *
 * Source: https://docs.salla.dev/doc-421118 (see docs/salla-reference.md §8).
 */
export const SALLA_REQUIRED_SCOPES = ["offline_access"] as const;

export type SallaScope = (typeof SALLA_REQUIRED_SCOPES)[number];

/**
 * Normalizes the scopes Salla reports back. The authorization docs show a
 * space-delimited list; the official PHP client uses commas. Accept both and
 * never invent a scope that was not granted.
 */
export function normalizeScopes(input: string | readonly string[] | null | undefined): string[] {
  if (!input) return [];

  const parts = Array.isArray(input) ? input : String(input).split(/[\s,]+/);
  const seen = new Set<string>();
  const result: string[] = [];

  for (const part of parts) {
    const scope = part.trim();
    if (!scope || seen.has(scope)) continue;
    seen.add(scope);
    result.push(scope);
  }

  return result;
}

/** Scope list as sent on the authorization URL (RFC 6749 §3.3, space-delimited). */
export function joinScopes(scopes: readonly string[]): string {
  return normalizeScopes(scopes).join(" ");
}

/** Alias kept for readability in the OAuth client and tests. */
export function serializeScopes(scopes: readonly string[]): string {
  return joinScopes(scopes);
}

/** True when Salla granted a refresh-capable authorization. */
export function hasOfflineAccess(scopes: readonly string[]): boolean {
  return scopes.includes("offline_access");
}
