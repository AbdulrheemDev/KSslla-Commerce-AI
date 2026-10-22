import { z } from "zod";

import type { SallaConfig } from "@/modules/integrations/salla/config";
import {
  invalidGrantError,
  invalidResponseError,
  tokenRejectedError,
} from "@/modules/integrations/salla/domain/errors";
import { joinScopes, normalizeScopes } from "@/modules/integrations/salla/domain/scopes";
import {
  computeAccessTokenExpiry,
  computeRefreshTokenExpiry,
} from "@/modules/integrations/salla/domain/tokens";
import { isRecord, requestJson } from "@/modules/integrations/salla/infrastructure/http";

/**
 * Salla OAuth 2.0 protocol client.
 *
 * Verified facts (docs.salla.dev/doc-421118, see docs/salla-reference.md §8):
 * - Authorization endpoint: https://accounts.salla.sa/oauth2/auth
 * - Token endpoint (exchange and refresh): https://accounts.salla.sa/oauth2/token
 * - Parameters: client_id, client_secret, grant_type, code, redirect_uri, scope, state
 * - Token requests are POSTs; RFC 6749 §4.1.3 defines a form-urlencoded body,
 *   which is also what Salla's official client sends.
 *
 * The raw response is never logged, returned, or persisted. Only the parsed
 * token material leaves this module.
 */

const tokenResponseSchema = z
  .object({
    access_token: z.string().min(1),
    token_type: z.string().optional(),
    refresh_token: z.string().min(1).optional(),
    expires_in: z.union([z.number(), z.string()]).optional(),
    expires: z.union([z.number(), z.string()]).optional(),
    scope: z.string().optional(),
  })
  .passthrough();

const merchantUserSchema = z
  .object({
    data: z
      .object({
        id: z.union([z.string(), z.number()]),
        name: z.string().nullish(),
        email: z.string().nullish(),
        role: z.string().nullish(),
        merchant: z
          .object({
            id: z.union([z.string(), z.number()]),
            username: z.string().nullish(),
            name: z.string().nullish(),
            domain: z.string().nullish(),
            status: z.string().nullish(),
          })
          .passthrough(),
      })
      .passthrough(),
  })
  .passthrough();

export interface SallaTokenSet {
  accessToken: string;
  refreshToken: string | null;
  accessTokenExpiresAt: Date;
  refreshTokenExpiresAt: Date | null;
  scopes: string[];
  tokenType: string;
}

export interface SallaMerchantIdentity {
  /** Numeric `merchant.id` from the official user-info payload. Identity key. */
  externalStoreId: string;
  /** The authorizing Salla user; may be a team member of the merchant. */
  externalUserId: string;
  externalStoreName: string | null;
}

export function buildAuthorizationUrl(
  config: SallaConfig,
  state: string,
  scopes: readonly string[] = config.scopes,
): string {
  const url = new URL(config.endpoints.authorizationUrl);
  url.searchParams.set("client_id", config.clientId);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("redirect_uri", config.redirectUri);
  url.searchParams.set("scope", joinScopes(scopes));
  url.searchParams.set("state", state);
  return url.toString();
}

/**
 * Salla documents errors as `{error, error_description}`; the official PHP
 * client also tolerates `error.message`. Both are read, neither is surfaced.
 */
function errorCodeOf(body: unknown): string | null {
  if (!isRecord(body)) return null;

  const raw = body.error;
  if (typeof raw === "string") return raw;
  if (isRecord(raw) && typeof raw.message === "string") return raw.message;

  return null;
}

function parseTokenSet(body: unknown, config: SallaConfig, now: Date): SallaTokenSet {
  const envelope = isRecord(body) && isRecord(body.data) ? body.data : body;
  const parsed = tokenResponseSchema.safeParse(envelope);

  if (!parsed.success) {
    throw invalidResponseError("token_payload");
  }

  const value = parsed.data;
  const accessTokenExpiresAt = computeAccessTokenExpiry({
    now,
    expiresIn: value.expires_in,
    expiresAtEpoch: value.expires,
  });

  return {
    accessToken: value.access_token,
    refreshToken: value.refresh_token ?? null,
    accessTokenExpiresAt,
    refreshTokenExpiresAt: computeRefreshTokenExpiry(now, value.refresh_token ?? null),
    scopes: value.scope ? normalizeScopes(value.scope) : [...config.scopes],
    tokenType: value.token_type ?? "Bearer",
  };
}

function formBody(fields: Record<string, string>): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(fields)) params.set(key, value);
  return params.toString();
}

export interface TokenRequestOptions {
  now?: Date;
}

function resolveNow(options: Date | TokenRequestOptions): Date {
  return options instanceof Date ? options : (options.now ?? new Date());
}

/** Exchanges a one-time authorization code. Never retried by this layer. */
export async function exchangeAuthorizationCode(
  config: SallaConfig,
  code: string,
  options: Date | TokenRequestOptions = {},
): Promise<SallaTokenSet> {
  const response = await requestJson(config.endpoints.tokenUrl, {
    method: "POST",
    headers: {
      "content-type": "application/x-www-form-urlencoded",
      accept: "application/json",
    },
    body: formBody({
      grant_type: "authorization_code",
      code,
      redirect_uri: config.redirectUri,
      client_id: config.clientId,
      client_secret: config.clientSecret,
    }),
  });

  if (response.status < 200 || response.status >= 300) {
    const code = errorCodeOf(response.body);
    if (code === "invalid_grant") throw invalidGrantError();
    throw tokenRejectedError();
  }

  return parseTokenSet(response.body, config, resolveNow(options));
}

/**
 * Rotates the refresh token.
 *
 * Salla invalidates the presented refresh token on success, so this function
 * must be called at most once per token. Concurrency is handled by the
 * store-level lease in the token manager, not here.
 */
export async function refreshAccessToken(
  config: SallaConfig,
  refreshToken: string,
  options: Date | TokenRequestOptions = {},
): Promise<SallaTokenSet> {
  const response = await requestJson(config.endpoints.tokenUrl, {
    method: "POST",
    headers: {
      "content-type": "application/x-www-form-urlencoded",
      accept: "application/json",
    },
    body: formBody({
      grant_type: "refresh_token",
      refresh_token: refreshToken,
      client_id: config.clientId,
      client_secret: config.clientSecret,
    }),
  });

  if (response.status < 200 || response.status >= 300) {
    const code = errorCodeOf(response.body);
    // `invalid_grant` is permanent: reusing a spent token, revoked app, expired
    // refresh, or a mismatched client. Never retried.
    if (
      code === "invalid_grant" ||
      response.status === 400 ||
      response.status === 401 ||
      response.status === 403
    ) {
      throw invalidGrantError();
    }
    throw tokenRejectedError();
  }

  const tokens = parseTokenSet(response.body, config, resolveNow(options));

  // Salla rotates refresh tokens. A response without one means the grant can no
  // longer be refreshed and the merchant must reconnect.
  if (!tokens.refreshToken) throw invalidGrantError();

  return tokens;
}

/** Reads the merchant identity with the access token. Server-side only. */
export async function fetchMerchantIdentity(
  config: SallaConfig,
  accessToken: string,
): Promise<SallaMerchantIdentity> {
  const response = await requestJson(config.endpoints.userInfoUrl, {
    method: "GET",
    headers: {
      authorization: `Bearer ${accessToken}`,
      accept: "application/json",
    },
  });

  if (response.status === 401 || response.status === 403) {
    throw invalidGrantError();
  }

  if (response.status < 200 || response.status >= 300) {
    throw invalidResponseError("user_info_status");
  }

  const parsed = merchantUserSchema.safeParse(response.body);
  if (!parsed.success) throw invalidResponseError("user_info");

  const { data } = parsed.data;

  return {
    externalStoreId: String(data.merchant.id),
    externalUserId: String(data.id),
    externalStoreName: data.merchant.name ?? data.name ?? null,
  };
}
