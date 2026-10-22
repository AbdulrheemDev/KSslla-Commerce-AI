import { NextRequest } from "next/server";

import { resetServerEnvCache } from "@/lib/env";
import { BASE_URL } from "@/test/integration/helpers";

/**
 * Points the application at the local mock Salla endpoints and clears the
 * configuration cache, so no test can ever reach the real Salla hosts.
 */
export function configureMockSalla(url: string): void {
  process.env.SALLA_CLIENT_ID = "test-client-id";
  process.env.SALLA_CLIENT_SECRET = "test-client-secret-value";
  process.env.SALLA_REDIRECT_URI = `${BASE_URL}/api/integrations/salla/callback`;
  process.env.SALLA_OAUTH_MODE = "custom";
  process.env.SALLA_AUTH_URL = `${url}/oauth2/auth`;
  process.env.SALLA_TOKEN_URL = `${url}/oauth2/token`;
  process.env.SALLA_USERINFO_URL = `${url}/oauth2/user/info`;
  process.env.SALLA_API_URL = `${url}/admin/v2`;
  resetServerEnvCache();
}

export function clearMockSalla(): void {
  for (const key of [
    "SALLA_CLIENT_ID",
    "SALLA_CLIENT_SECRET",
    "SALLA_REDIRECT_URI",
    "SALLA_OAUTH_MODE",
    "SALLA_AUTH_URL",
    "SALLA_TOKEN_URL",
    "SALLA_USERINFO_URL",
    "SALLA_API_URL",
  ]) {
    delete process.env[key];
  }
  resetServerEnvCache();
}

export function buildCallbackRequest(
  query: Record<string, string>,
  cookies: Map<string, string>,
): NextRequest {
  const url = new URL("/api/integrations/salla/callback", BASE_URL);
  for (const [key, value] of Object.entries(query)) url.searchParams.set(key, value);

  const headers = new Headers({ host: "localhost:3000" });
  if (cookies.size > 0) {
    headers.set(
      "cookie",
      [...cookies.entries()].map(([name, value]) => `${name}=${value}`).join("; "),
    );
  }

  return new NextRequest(url, { method: "GET", headers });
}

/** Extracts the `state` parameter from a Salla authorization URL. */
export function stateFromAuthorizationUrl(authorizationUrl: string): string {
  const state = new URL(authorizationUrl).searchParams.get("state");
  if (!state) throw new Error("authorization URL has no state");
  return state;
}
