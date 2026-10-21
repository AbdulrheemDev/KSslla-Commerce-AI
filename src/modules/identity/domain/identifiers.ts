import { randomBytes } from "node:crypto";

/** Emails are stored lowercase and trimmed; the schema enforces the same rule. */
export function normalizeEmail(input: string): string {
  return input.trim().toLowerCase();
}

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

export function isValidEmail(normalized: string): boolean {
  return normalized.length <= 254 && EMAIL_PATTERN.test(normalized);
}

const SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

/**
 * Derives a URL-safe slug from an organization name.
 *
 * Arabic names have no reliable ASCII transliteration, so they fall back to a
 * random suffix instead of inventing one.
 */
export function slugifyOrganizationName(name: string): string {
  const latin = name
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40)
    .replace(/-+$/g, "");

  if (latin.length >= 2 && SLUG_PATTERN.test(latin)) {
    return latin;
  }

  return `org-${randomBytes(4).toString("hex")}`;
}

export function isValidSlug(slug: string): boolean {
  return slug.length >= 2 && slug.length <= 64 && SLUG_PATTERN.test(slug);
}
