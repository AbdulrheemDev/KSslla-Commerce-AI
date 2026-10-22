import "server-only";

import { getServerEnv, type ServerEnv } from "@/lib/env";
import { notConfiguredError } from "@/modules/integrations/salla/domain/errors";
import { SALLA_REQUIRED_SCOPES, normalizeScopes } from "@/modules/integrations/salla/domain/scopes";

/**
 * Salla OAuth configuration.
 *
 * Read from the server environment only. The client secret never leaves this
 * module except as a form field on the token request. Nothing here is exposed
 * through `NEXT_PUBLIC_*`, server-component props, API responses, or logs.
 *
 * Endpoint overrides exist for the automated protocol tests. They are ignored
 * in production: a deployed app always talks to the official Salla hosts.
 */

export const SALLA_CALLBACK_PATH = "/api/integrations/salla/callback";

export const SALLA_OFFICIAL_ENDPOINTS = {
  authorizationUrl: "https://accounts.salla.sa/oauth2/auth",
  tokenUrl: "https://accounts.salla.sa/oauth2/token",
  userInfoUrl: "https://accounts.salla.sa/oauth2/user/info",
  /** Documented base URI for every Merchant API endpoint. */
  apiBaseUrl: "https://api.salla.dev/admin/v2",
} as const;

export type SallaOAuthMode = "easy" | "custom";

export interface SallaConfig {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
  mode: SallaOAuthMode;
  /**
   * Easy Mode receives tokens through the `app.store.authorize` webhook, which
   * is out of Phase 03 scope. It is configured but not startable.
   */
  supported: boolean;
  endpoints: {
    authorizationUrl: string;
    tokenUrl: string;
    userInfoUrl: string;
    apiBaseUrl: string;
  };
  scopes: string[];
}

function endpointsFor(env: ServerEnv): SallaConfig["endpoints"] {
  if (env.NODE_ENV === "production") return { ...SALLA_OFFICIAL_ENDPOINTS };

  return {
    authorizationUrl: env.SALLA_AUTH_URL ?? SALLA_OFFICIAL_ENDPOINTS.authorizationUrl,
    tokenUrl: env.SALLA_TOKEN_URL ?? SALLA_OFFICIAL_ENDPOINTS.tokenUrl,
    userInfoUrl: env.SALLA_USERINFO_URL ?? SALLA_OFFICIAL_ENDPOINTS.userInfoUrl,
    apiBaseUrl: env.SALLA_API_URL ?? SALLA_OFFICIAL_ENDPOINTS.apiBaseUrl,
  };
}

function isProductionRedirectValid(env: ServerEnv, redirectUri: string): boolean {
  try {
    const redirect = new URL(redirectUri);
    const app = new URL(env.APP_URL);

    return (
      redirect.protocol === "https:" &&
      redirect.pathname === SALLA_CALLBACK_PATH &&
      redirect.hostname === app.hostname
    );
  } catch {
    return false;
  }
}

/**
 * Returns the configuration, or `null` when the app credentials are absent.
 *
 * A production deployment whose redirect target is not the registered https
 * callback is reported as not configured instead of redirecting anywhere else.
 */
export function readSallaConfig(env: ServerEnv = getServerEnv()): SallaConfig | null {
  const { SALLA_CLIENT_ID, SALLA_CLIENT_SECRET, SALLA_REDIRECT_URI } = env;

  if (!SALLA_CLIENT_ID || !SALLA_CLIENT_SECRET || !SALLA_REDIRECT_URI) return null;

  if (env.NODE_ENV === "production" && !isProductionRedirectValid(env, SALLA_REDIRECT_URI)) {
    return null;
  }

  return {
    clientId: SALLA_CLIENT_ID,
    clientSecret: SALLA_CLIENT_SECRET,
    redirectUri: SALLA_REDIRECT_URI,
    mode: env.SALLA_OAUTH_MODE,
    supported: env.SALLA_OAUTH_MODE === "custom",
    endpoints: endpointsFor(env),
    scopes: normalizeScopes(SALLA_REQUIRED_SCOPES),
  };
}

export function requireSallaConfig(env: ServerEnv = getServerEnv()): SallaConfig {
  const config = readSallaConfig(env);

  if (!config) throw notConfiguredError();

  if (!config.supported) {
    throw notConfiguredError();
  }

  return config;
}

/** Presence check used by health and by the connection UI. */
export function isSallaConfigured(env: ServerEnv = getServerEnv()): boolean {
  try {
    return readSallaConfig(env) !== null;
  } catch {
    return false;
  }
}

export interface SallaHealth {
  configured: boolean;
  oauthMode: SallaOAuthMode;
  implemented: boolean;
}

/** Safe subset for `/api/health`; contains no credential and no tenant data. */
export function getSallaHealth(env: ServerEnv = getServerEnv()): SallaHealth {
  const config = (() => {
    try {
      return readSallaConfig(env);
    } catch {
      return null;
    }
  })();

  return {
    configured: config !== null,
    oauthMode: env.SALLA_OAUTH_MODE,
    implemented: config?.supported ?? false,
  };
}
