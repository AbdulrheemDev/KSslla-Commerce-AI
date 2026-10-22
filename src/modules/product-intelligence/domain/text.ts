/**
 * Small, total text helpers shared by the product engines.
 *
 * "Total" matters: every function has a defined answer for `null`, an empty
 * string, and whitespace-only text, so no rule can accidentally treat
 * "missing" as "present" (or the reverse) depending on how the provider
 * serialised an empty field.
 */

/** True when the value is missing or contains no visible characters. */
export function isBlank(value: string | null | undefined): boolean {
  return value === null || value === undefined || value.trim().length === 0;
}

/** Trimmed value, or `null` when nothing is left. */
export function trimToNull(value: string | null | undefined): string | null {
  if (value === null || value === undefined) return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

/**
 * Length in Unicode code points, which is what a human counts.
 * `"👕".length` is 2 in JavaScript; this function returns 1.
 */
export function codePointLength(value: string): number {
  return Array.from(value).length;
}

/**
 * True when the value is an absolute `http(s)` URL.
 * Only the shape is checked — no request is made and no host is trusted.
 */
export function isHttpUrl(value: string | null | undefined): boolean {
  if (isBlank(value)) return false;

  try {
    const url = new URL(value as string);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

/** Whole days between two instants, floored at zero. */
export function daysBetween(from: Date, to: Date): number {
  const diff = to.getTime() - from.getTime();
  return diff <= 0 ? 0 : Math.floor(diff / 86_400_000);
}
