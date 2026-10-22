import "server-only";

import { getServerEnv, type ServerEnv } from "@/lib/env";

/**
 * Cookie attributes for the two browser cookies this app sets.
 *
 * Default (development, test, production): `Secure; SameSite=Lax; Path=/` —
 * the same-origin default that has been in place since Phase 02.
 *
 * Preview mode (`PREVIEW_EMBEDDED_COOKIES=partitioned`, non-production only):
 * `Secure; SameSite=None; Partitioned`. The preview is rendered inside an
 * iframe whose top-level site is not the app, so browsers treat our cookies as
 * third-party and silently drop `SameSite=Lax` ones — the login then fails the
 * double-submit check with "the request could not be verified".
 *
 * `Partitioned` (CHIPS) keeps the cookie in a per-top-level-site jar: it is
 * still sent only to this host, and it cannot be read across different
 * embeddings. `SameSite=None` is required for a partitioned cookie to be sent
 * at all, and is harmless for the same reason. The setting is refused in
 * production by the environment schema, so a real deployment cannot opt in by
 * accident.
 */

export type CookieMode = ServerEnv["NODE_ENV"];

export interface CookiePolicy {
  secure: true;
  sameSite: "lax" | "none";
  partitioned?: boolean;
}

export const DEFAULT_COOKIE_POLICY: CookiePolicy = { secure: true, sameSite: "lax" };

export const PREVIEW_COOKIE_POLICY: CookiePolicy = {
  secure: true,
  sameSite: "none",
  partitioned: true,
};

/** Pure resolution, so the rule can be tested without touching the environment. */
export function resolveCookiePolicy(input: {
  nodeEnv: CookieMode;
  previewEmbeddedCookies?: "partitioned";
}): CookiePolicy {
  if (input.nodeEnv !== "production" && input.previewEmbeddedCookies === "partitioned") {
    return PREVIEW_COOKIE_POLICY;
  }

  return DEFAULT_COOKIE_POLICY;
}

export function cookiePolicy(): CookiePolicy {
  const env = getServerEnv();

  return resolveCookiePolicy({
    nodeEnv: env.NODE_ENV,
    previewEmbeddedCookies: env.PREVIEW_EMBEDDED_COOKIES,
  });
}
