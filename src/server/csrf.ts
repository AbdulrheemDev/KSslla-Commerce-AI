import type { NextRequest, NextResponse } from "next/server";

import { AppError } from "@/lib/errors";
import { getServerEnv } from "@/lib/env";
import { cookiePolicy } from "@/server/cookie-policy";
import { logger } from "@/lib/logger";
import { generateOpaqueToken, safeCompare } from "@/modules/identity/domain/tokens";
import { CSRF_COOKIE_NAME, CSRF_HEADER_NAME } from "@/modules/identity/domain/session-policy";

/**
 * CSRF defence for cookie-authenticated state changes.
 *
 * Two independent checks:
 * 1. Same-origin: `Origin` (or `Referer` as a fallback) must match one of the
 *    hosts this deployment answers on. This blocks classic cross-site posts.
 * 2. Double-submit token: a random token in a readable `__Host-` cookie must
 *    equal the `x-csrf-token` header. `SameSite=Lax` alone is not treated as
 *    sufficient, and HttpOnly is explicitly not a CSRF defence.
 *
 * Host selection (ADR-041): a deployment is regularly reached through a proxy
 * that rewrites `Host` to the upstream socket, so the browser's `Origin` can
 * never equal it. The accepted set is therefore built from configuration and
 * from the proxy's documented `x-forwarded-host`, never from the request body:
 *   - the `Host` header as received;
 *   - the first `x-forwarded-host` entry (set by the terminating proxy);
 *   - the configured `APP_URL` host, which is this deployment's public origin.
 * Development previews additionally accept `*.e2b.app`, because the preview
 * proxy rotates the public host per session. The token check still applies.
 */

const CSRF_COOKIE_MAX_AGE_SECONDS = 60 * 60 * 8;

/** Preview hosts are only trusted outside production. */
const PREVIEW_HOST_SUFFIX = ".e2b.app";

export interface OriginHostsInput {
  host: string | null;
  forwardedHost: string | null;
  appUrl: string | null;
}

/** `host`, `host:port`, or a bracketed IPv6 literal. Nothing else. */
const HOST_PATTERN = /^(?:\[[0-9a-f:.]+\]|[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?)(?::\d{1,5})?$/;

function normalizeHost(value: string | null | undefined): string | null {
  if (!value) return null;

  // `x-forwarded-host` may carry a comma-separated hop list; the first entry is
  // the host the client actually asked for.
  const first = value.split(",")[0]?.trim().toLowerCase();
  if (!first || !HOST_PATTERN.test(first)) return null;

  return first;
}

function hostOfUrl(value: string | null | undefined): string | null {
  if (!value) return null;

  try {
    return normalizeHost(new URL(value).host);
  } catch {
    return null;
  }
}

/** Hosts this deployment may legitimately be addressed as. */
export function allowedOriginHosts(input: OriginHostsInput): Set<string> {
  const hosts = new Set<string>();

  for (const candidate of [
    normalizeHost(input.host),
    normalizeHost(input.forwardedHost),
    hostOfUrl(input.appUrl),
  ]) {
    if (candidate) hosts.add(candidate);
  }

  return hosts;
}

/**
 * Compares an `Origin`/`Referer` value against the accepted hosts.
 * `allowPreviewHosts` is passed explicitly so the rule stays testable.
 */
export function isAcceptedOrigin(
  value: string,
  allowed: ReadonlySet<string>,
  options: { allowPreviewHosts: boolean },
): boolean {
  let url: URL;

  try {
    url = new URL(value);
  } catch {
    return false;
  }

  if (url.protocol !== "http:" && url.protocol !== "https:") return false;
  if (allowed.has(url.host.toLowerCase())) return true;

  return (
    options.allowPreviewHosts &&
    url.protocol === "https:" &&
    url.hostname.toLowerCase().endsWith(PREVIEW_HOST_SUFFIX)
  );
}

function reject(reason: string, diagnostics: Record<string, unknown> = {}): never {
  // Names and booleans only: never the token, the cookie, or the full URL.
  logger.warn({ event: "csrf.rejected", reason, ...diagnostics }, "request rejected by CSRF");

  throw new AppError({
    code: "FORBIDDEN",
    message: "The request could not be verified. Refresh the page and try again.",
    details: { reason },
  });
}

function appUrl(): string | null {
  try {
    return getServerEnv().APP_URL;
  } catch {
    return null;
  }
}

function isProduction(): boolean {
  try {
    return getServerEnv().NODE_ENV === "production";
  } catch {
    return true;
  }
}

export function assertSameOrigin(request: NextRequest): void {
  const origin = request.headers.get("origin");
  const referer = request.headers.get("referer");
  const source = origin ?? referer;

  const host = request.headers.get("host") ?? request.nextUrl.host;
  const forwardedHost = request.headers.get("x-forwarded-host");
  const allowed = allowedOriginHosts({ host, forwardedHost, appUrl: appUrl() });
  const production = isProduction();

  if (!source) {
    reject("missing_origin", {
      host,
      forwardedHost,
      allowedHosts: [...allowed],
      path: request.nextUrl.pathname,
    });
  }

  if (!isAcceptedOrigin(source, allowed, { allowPreviewHosts: !production })) {
    reject(origin ? "cross_origin" : "cross_origin_referer", {
      host,
      forwardedHost,
      sourceHost: (() => {
        try {
          return new URL(source).host;
        } catch {
          return null;
        }
      })(),
      allowedHosts: [...allowed],
      path: request.nextUrl.pathname,
    });
  }
}

export function assertCsrf(request: NextRequest): void {
  assertSameOrigin(request);

  const cookieToken = request.cookies.get(CSRF_COOKIE_NAME)?.value ?? "";
  const headerToken = request.headers.get(CSRF_HEADER_NAME) ?? "";

  if (!cookieToken || !headerToken || !safeCompare(cookieToken, headerToken)) {
    reject("csrf_token_mismatch", {
      hasCookie: cookieToken.length > 0,
      hasHeader: headerToken.length > 0,
      path: request.nextUrl.pathname,
    });
  }
}

/** Issues a fresh double-submit token on the response. */
export function issueCsrfToken(response: NextResponse): string {
  const token = generateOpaqueToken(32);
  setCsrfCookie(response, token);
  return token;
}

/** Sets the double-submit cookie. The value is deliberately readable by scripts. */
export function setCsrfCookie(response: NextResponse, token: string): void {
  response.cookies.set(CSRF_COOKIE_NAME, token, {
    httpOnly: false,
    path: "/",
    maxAge: CSRF_COOKIE_MAX_AGE_SECONDS,
    ...cookiePolicy(),
  });
}
