/**
 * Central error taxonomy.
 *
 * Rules:
 * - Errors are the only transport for failure information; no boolean flags.
 * - Every error crossing a module boundary is an `AppError`.
 * - Messages must be safe to show to a user and must never contain secrets,
 *   tokens, full payloads, or customer data. Details carry field names and
 *   codes only.
 */

export const APP_ERROR_CODES = [
  "CONFIG_INVALID",
  "VALIDATION_FAILED",
  "UNAUTHENTICATED",
  "FORBIDDEN",
  "NOT_FOUND",
  "CONFLICT",
  "RATE_LIMITED",
  "TENANT_ISOLATION_VIOLATION",
  "INTEGRATION_NOT_CONNECTED",
  "INTEGRATION_NOT_CONFIGURED",
  "INTEGRATION_AUTH_REQUIRED",
  "INTEGRATION_ERROR",
  "WEBHOOK_SIGNATURE_INVALID",
  "WEBHOOK_DUPLICATE",
  "AI_NOT_CONFIGURED",
  "AI_PROVIDER_REQUIRED",
  "AI_PROVIDER_ERROR",
  "AI_TIMEOUT",
  "AI_INVALID_OUTPUT",
  "INTERNAL",
] as const;

export type AppErrorCode = (typeof APP_ERROR_CODES)[number];

/**
 * HTTP mapping used by route handlers.
 *
 * `TENANT_ISOLATION_VIOLATION` deliberately maps to 404: a caller must not be
 * able to distinguish "does not exist" from "belongs to another tenant".
 */
const DEFAULT_HTTP_STATUS: Record<AppErrorCode, number> = {
  CONFIG_INVALID: 500,
  VALIDATION_FAILED: 422,
  UNAUTHENTICATED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  CONFLICT: 409,
  RATE_LIMITED: 429,
  TENANT_ISOLATION_VIOLATION: 404,
  INTEGRATION_NOT_CONNECTED: 409,
  INTEGRATION_NOT_CONFIGURED: 503,
  INTEGRATION_AUTH_REQUIRED: 409,
  INTEGRATION_ERROR: 502,
  WEBHOOK_SIGNATURE_INVALID: 401,
  WEBHOOK_DUPLICATE: 200,
  AI_NOT_CONFIGURED: 503,
  AI_PROVIDER_REQUIRED: 503,
  AI_PROVIDER_ERROR: 502,
  AI_TIMEOUT: 504,
  AI_INVALID_OUTPUT: 502,
  INTERNAL: 500,
};

/**
 * Default retryability. Integrations and AI providers opt in explicitly because
 * only the adapter knows whether a failure was transient.
 */
const RETRYABLE_CODES = new Set<AppErrorCode>(["RATE_LIMITED", "AI_TIMEOUT"]);

export interface AppErrorOptions {
  code: AppErrorCode;
  message: string;
  httpStatus?: number;
  retryable?: boolean;
  details?: Record<string, unknown>;
  cause?: unknown;
}

export class AppError extends Error {
  readonly code: AppErrorCode;
  readonly httpStatus: number;
  readonly retryable: boolean;
  readonly details?: Record<string, unknown>;

  constructor(options: AppErrorOptions) {
    super(options.message, options.cause === undefined ? undefined : { cause: options.cause });
    this.name = new.target.name;
    this.code = options.code;
    this.httpStatus = options.httpStatus ?? DEFAULT_HTTP_STATUS[options.code];
    this.retryable = options.retryable ?? RETRYABLE_CODES.has(options.code);
    if (options.details !== undefined) {
      this.details = options.details;
    }
  }

  /** Serialization used by logs and route handlers. It never includes `cause`. */
  toJSON(): {
    code: AppErrorCode;
    message: string;
    httpStatus: number;
    retryable: boolean;
    details?: Record<string, unknown>;
  } {
    return {
      code: this.code,
      message: this.message,
      httpStatus: this.httpStatus,
      retryable: this.retryable,
      ...(this.details === undefined ? {} : { details: this.details }),
    };
  }
}

export function isAppError(value: unknown): value is AppError {
  return value instanceof AppError;
}

/** Normalizes an unknown thrown value into an `AppError` without leaking it. */
export function toAppError(
  error: unknown,
  fallbackMessage = "An unexpected error occurred.",
): AppError {
  if (isAppError(error)) {
    return error;
  }

  return new AppError({
    code: "INTERNAL",
    message: fallbackMessage,
    cause: error,
  });
}

export interface PublicError {
  code: AppErrorCode;
  message: string;
  httpStatus: number;
}

/** Safe projection for HTTP responses. Details and causes are never exposed. */
export function toPublicError(error: unknown): PublicError {
  const appError = toAppError(error);

  return {
    code: appError.code,
    message: appError.message,
    httpStatus: appError.httpStatus,
  };
}
