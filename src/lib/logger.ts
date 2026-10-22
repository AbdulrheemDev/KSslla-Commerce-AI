import "server-only";

import pino, { type DestinationStream, type Logger, type LoggerOptions } from "pino";

import { PRODUCT } from "@/config/product";
import { LOG_LEVELS } from "@/lib/env";

/**
 * Structured logging.
 *
 * Rules:
 * - JSON output only; one line per event.
 * - Never log tokens, secrets, credentials, authorization headers, or raw
 *   customer/provider payloads. Pass identifiers and counts instead.
 * - Every event carries a stable `event` name plus tenant and request context
 *   when available.
 * - Redaction below is defence in depth, not permission to log sensitive data.
 */

export const LOG_REDACTION_PATHS: readonly string[] = [
  "authorization",
  "cookie",
  "password",
  "secret",
  "access_token",
  "refresh_token",
  "client_secret",
  "api_key",
  "accessToken",
  "refreshToken",
  "clientSecret",
  "apiKey",
  "req.headers.authorization",
  "req.headers.cookie",
  "*.authorization",
  "*.cookie",
  "*.password",
  "*.secret",
  "*.access_token",
  "*.refresh_token",
  "*.client_secret",
  "*.api_key",
  "*.accessToken",
  "*.refreshToken",
  "*.clientSecret",
  "*.apiKey",
  "*.*.authorization",
  "*.*.cookie",
  "*.*.password",
  "*.*.secret",
  "*.*.access_token",
  "*.*.refresh_token",
  "*.*.client_secret",
  "*.*.api_key",
  "*.*.accessToken",
  "*.*.refreshToken",
  "*.*.clientSecret",
  "*.*.apiKey",
];

const REDACTION_CENSOR = "[REDACTED]";

export interface LogContext {
  [key: string]: unknown;
}

export interface CreateLoggerOptions {
  level?: string;
  context?: LogContext;
  destination?: DestinationStream;
}

function resolveLogLevel(explicitLevel?: string): string {
  const candidate = explicitLevel ?? process.env.LOG_LEVEL;
  if (candidate && (LOG_LEVELS as readonly string[]).includes(candidate)) {
    return candidate;
  }
  return "info";
}

export function createLogger(options: CreateLoggerOptions = {}): Logger {
  const pinoOptions: LoggerOptions = {
    level: resolveLogLevel(options.level),
    base: { service: PRODUCT.slug },
    timestamp: pino.stdTimeFunctions.isoTime,
    messageKey: "message",
    formatters: {
      level: (label) => ({ level: label }),
    },
    redact: {
      paths: [...LOG_REDACTION_PATHS],
      censor: REDACTION_CENSOR,
    },
  };

  const instance = options.destination ? pino(pinoOptions, options.destination) : pino(pinoOptions);

  return options.context ? instance.child(options.context) : instance;
}

/** Root logger. Request-scoped child loggers should add requestId/storeId. */
export const logger: Logger = createLogger();
