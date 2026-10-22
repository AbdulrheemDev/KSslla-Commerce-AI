import { AppError } from "@/lib/errors";

/**
 * Salla failure taxonomy.
 *
 * Every class keeps the public error contract of Phase 01 (`code` +
 * `httpStatus`) and adds a machine-readable `sallaKind`. No Salla detail — no
 * response body, no token, no URL with a secret — is ever attached to the
 * message that reaches a client or a log.
 *
 * - `SallaAuthError`       — configuration or authorization flow cannot start.
 * - `SallaTokenError`      — the token endpoint rejected or returned junk.
 * - `SallaAuthorizationError` — needs a human: reconnect (invalid_grant).
 * - `SallaNetworkError`    — transport/TLS/abort; retryable by the caller.
 * - `SallaRateLimitError`  — documented throttling; retryable after a delay.
 * - `SallaInvalidResponseError` — schema mismatch; treated as a provider bug.
 */

export type SallaErrorKind =
  | "not_configured"
  | "authorization"
  | "token"
  | "invalid_grant"
  | "network"
  | "rate_limited"
  | "invalid_response"
  | "api";

export class SallaIntegrationError extends AppError {
  readonly sallaKind: SallaErrorKind;

  constructor(options: {
    sallaKind: SallaErrorKind;
    code: ConstructorParameters<typeof AppError>[0]["code"];
    message: string;
    httpStatus?: number;
    retryable?: boolean;
    details?: Record<string, unknown>;
    cause?: unknown;
  }) {
    super(options);
    this.sallaKind = options.sallaKind;
  }
}

export function notConfiguredError(): SallaIntegrationError {
  return new SallaIntegrationError({
    sallaKind: "not_configured",
    code: "INTEGRATION_NOT_CONFIGURED",
    message: "Salla integration is not configured.",
  });
}

export function authFlowError(reason: string): SallaIntegrationError {
  return new SallaIntegrationError({
    sallaKind: "authorization",
    code: "INTEGRATION_ERROR",
    message: "The Salla authorization could not be started.",
    details: { reason },
  });
}

export function tokenRejectedError(): SallaIntegrationError {
  return new SallaIntegrationError({
    sallaKind: "token",
    code: "INTEGRATION_ERROR",
    message: "Salla rejected the authorization code.",
  });
}

export function invalidGrantError(): SallaIntegrationError {
  return new SallaIntegrationError({
    sallaKind: "invalid_grant",
    code: "INTEGRATION_AUTH_REQUIRED",
    message: "Salla authorization has expired or was revoked. Reconnect the store.",
    details: { reconnectRequired: true },
  });
}

export function networkError(cause?: unknown): SallaIntegrationError {
  return new SallaIntegrationError({
    sallaKind: "network",
    code: "INTEGRATION_ERROR",
    message: "Could not reach Salla. Try again shortly.",
    retryable: true,
    cause,
  });
}

export function rateLimitError(retryAfterSeconds?: number): SallaIntegrationError {
  return new SallaIntegrationError({
    sallaKind: "rate_limited",
    code: "RATE_LIMITED",
    message: "Salla is rate limiting requests. Try again shortly.",
    retryable: true,
    details: retryAfterSeconds ? { retryAfterSeconds } : undefined,
  });
}

export function invalidResponseError(field: string): SallaIntegrationError {
  return new SallaIntegrationError({
    sallaKind: "invalid_response",
    code: "INTEGRATION_ERROR",
    message: "Salla returned an unexpected response.",
    details: { field },
  });
}

export function isSallaError(error: unknown): error is SallaIntegrationError {
  return error instanceof SallaIntegrationError;
}

// ── Names used by the connection/token services ──────────────────────────────

/** Missing or unusable Salla app configuration. */
export const sallaNotConfigured = notConfiguredError;

/** The provider rejected the request in a way that is not specifically a grant. */
export const sallaAuthorizationFailed = authFlowError;

/** Permanent failure: the merchant must reconnect. */
export const sallaInvalidGrant = invalidGrantError;

/** Transport failure. Retryable, and never retried by the OAuth client itself. */
export const sallaNetworkError = networkError;

/** Unexpected payload shape. */
export const sallaInvalidResponse = invalidResponseError;

export const sallaRateLimited = rateLimitError;

/** Non-2xx Merchant API response that is not a throttling signal. */
export function sallaApiError(providerStatus: number): SallaIntegrationError {
  return new SallaIntegrationError({
    sallaKind: "api",
    code: "INTEGRATION_ERROR",
    message: "Salla rejected the request.",
    retryable: providerStatus >= 500,
    details: { providerStatus },
  });
}

/** Backwards-compatible alias: the class under its shorter name. */
export { SallaIntegrationError as SallaError };
