/**
 * Salla scopes.
 *
 * Minimum for the implemented features:
 * - `offline_access` — documented prerequisite for a refresh token (Phase 03);
 * - `products.read` — required by `GET /products` (Phase 04);
 * - `categories.read` — required by `GET /categories` (Phase 04).
 *
 * Nothing is requested "for later": orders, customers, inventory, and every
 * write scope stay out until a phase actually reads or writes them.
 *
 * Source: https://docs.salla.dev/doc-421118, https://docs.salla.dev/5394168e0,
 * https://docs.salla.dev/api-5394207 (see docs/salla-reference.md §2.2–2.3).
 */
export const SALLA_REQUIRED_SCOPES = [
  "offline_access",
  "products.read",
  "categories.read",
] as const;

export type SallaScope = (typeof SALLA_REQUIRED_SCOPES)[number];

/** Scopes the catalogue sync cannot work without. */
export const SALLA_CATALOG_SCOPES = ["products.read", "categories.read"] as const;

export function hasScopes(granted: readonly string[], required: readonly string[]): boolean {
  return required.every((scope) => granted.includes(scope));
}

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
