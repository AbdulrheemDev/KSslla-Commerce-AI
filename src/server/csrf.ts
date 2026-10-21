import type { NextRequest, NextResponse } from "next/server";

import { AppError } from "@/lib/errors";
import { generateOpaqueToken, safeCompare } from "@/modules/identity/domain/tokens";
import { CSRF_COOKIE_NAME, CSRF_HEADER_NAME } from "@/modules/identity/domain/session-policy";

/**
 * CSRF defence for cookie-authenticated state changes.
 *
 * Two independent checks:
 * 1. Same-origin: `Origin` (or `Referer` as a fallback) must match the request
 *    host. This blocks classic cross-site form posts.
 * 2. Double-submit token: a random token in a readable `__Host-` cookie must
 *    equal the `x-csrf-token` header. `SameSite=Lax` alone is not treated as
 *    sufficient, and HttpOnly is explicitly not a CSRF defence.
 */

const CSRF_COOKIE_MAX_AGE_SECONDS = 60 * 60 * 8;

function reject(reason: string): never {
  throw new AppError({
    code: "FORBIDDEN",
    message: "The request could not be verified. Refresh the page and try again.",
    details: { reason },
  });
}

export function assertSameOrigin(request: NextRequest): void {
  const expectedHost = request.headers.get("host") ?? request.nextUrl.host;
  const origin = request.headers.get("origin");

  if (origin) {
    let originHost: string;
    try {
      originHost = new URL(origin).host;
    } catch {
      return reject("invalid_origin");
    }
    if (originHost !== expectedHost) reject("cross_origin");
    return;
  }

  const referer = request.headers.get("referer");
  if (!referer) return reject("missing_origin");

  try {
    if (new URL(referer).host !== expectedHost) reject("cross_origin");
  } catch {
    reject("invalid_referer");
  }
}

export function assertCsrf(request: NextRequest): void {
  assertSameOrigin(request);

  const cookieToken = request.cookies.get(CSRF_COOKIE_NAME)?.value ?? "";
  const headerToken = request.headers.get(CSRF_HEADER_NAME) ?? "";

  if (!cookieToken || !headerToken || !safeCompare(cookieToken, headerToken)) {
    reject("csrf_token_mismatch");
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
    secure: true,
    sameSite: "lax",
    path: "/",
    maxAge: CSRF_COOKIE_MAX_AGE_SECONDS,
  });
}
