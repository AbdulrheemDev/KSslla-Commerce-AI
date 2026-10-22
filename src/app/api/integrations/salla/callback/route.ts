import { NextResponse, type NextRequest } from "next/server";

import { getDb } from "@/db/client";
import { getServerEnv } from "@/lib/env";
import { logger } from "@/lib/logger";
import { completeSallaAuthorization } from "@/modules/integrations/salla/application/connection-service";
import { requestMeta } from "@/server/request-meta";
import { optionalAuth } from "@/server/session";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * Salla OAuth redirect target.
 *
 * The `state` value is the only trust anchor: it is hashed, looked up in the
 * database, checked against the current session, and consumed exactly once.
 * The authorization `code` is exchanged server-side and never stored or
 * echoed. Provider error text is never shown to the user.
 */
export async function GET(request: NextRequest) {
  const url = request.nextUrl;
  // Redirects are built from APP_URL, never from the request Host header, so a
  // forged Host cannot turn the callback into an open redirect.
  const base = new URL(getServerEnv().APP_URL);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const providerError = url.searchParams.get("error");

  const redirectBase = new URL("/app/stores", base);

  if (!state || state.length > 512) {
    return NextResponse.redirect(withError(redirectBase, "invalid_state"));
  }

  const auth = await optionalAuth(request).catch(() => null);

  if (!auth) {
    // Preserve the callback for after sign-in; the state remains unconsumed.
    const next = `${url.pathname}${url.search}`;
    const login = new URL("/login", base);
    login.searchParams.set("next", next);
    return NextResponse.redirect(login);
  }

  try {
    const result = await completeSallaAuthorization(getDb(), {
      rawState: state,
      code,
      providerError,
      sessionUserId: auth.user.id,
      meta: requestMeta(request),
    });

    if (!result.ok) {
      const target = result.storeId ? new URL(`/app/stores/${result.storeId}`, base) : redirectBase;
      return NextResponse.redirect(withError(target, result.reason));
    }

    const target = new URL(`/app/stores/${result.storeId}`, base);
    target.searchParams.set("connected", "1");
    return NextResponse.redirect(target);
  } catch (error) {
    logger.error(
      { errorName: error instanceof Error ? error.name : "Unknown" },
      "salla callback failed",
    );
    return NextResponse.redirect(withError(redirectBase, "failed"));
  }
}

function withError(target: URL, reason: string): URL {
  const url = new URL(target.toString());
  url.searchParams.set("salla_error", reason);
  return url;
}
