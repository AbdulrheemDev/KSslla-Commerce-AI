import "server-only";

import { z } from "zod";

import { AppError } from "@/lib/errors";

/**
 * Server environment contract.
 *
 * - Secrets are read from the environment only and never from code.
 * - Validation is lazy so that `next build` does not require runtime secrets.
 * - Validation errors report the variable name and the rule, never the value.
 * - Variables marked "Phase 0x" are optional today and become required when
 *   that phase is implemented.
 */

export const LOG_LEVELS = ["fatal", "error", "warn", "info", "debug", "trace", "silent"] as const;

const optionalText = z.string().trim().min(1).optional();

export const serverEnvSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),

  // Phase 01 — application
  APP_URL: z.url({ protocol: /^https?$/ }).default("http://localhost:3000"),
  LOG_LEVEL: z.enum(LOG_LEVELS).default("info"),

  // Phase 02 — persistence and sessions
  DATABASE_URL: optionalText,
  MIGRATION_DATABASE_URL: optionalText,
  AUTH_SECRET: z.string().min(32, "AUTH_SECRET must be at least 32 characters.").optional(),
  ENCRYPTION_KEY: z
    .string()
    .regex(
      /^[0-9a-fA-F]{64}$/,
      "ENCRYPTION_KEY must be 32 bytes encoded as 64 hexadecimal characters.",
    )
    .optional(),

  // Phase 03 — Salla app (server-only)
  SALLA_CLIENT_ID: optionalText,
  SALLA_CLIENT_SECRET: optionalText,
  SALLA_REDIRECT_URI: z.url({ protocol: /^https?$/ }).optional(),
  SALLA_OAUTH_MODE: z.enum(["custom", "easy"]).default("custom"),
  // Development/test only. Rejected in production by the Salla config layer.
  SALLA_API_URL: z.url({ protocol: /^https?$/ }).optional(),
  SALLA_AUTH_URL: z.url({ protocol: /^https?$/ }).optional(),
  SALLA_TOKEN_URL: z.url({ protocol: /^https?$/ }).optional(),
  SALLA_USERINFO_URL: z.url({ protocol: /^https?$/ }).optional(),

  // Phase 06 — Salla webhooks
  SALLA_WEBHOOK_SECRET: optionalText,
  /**
   * Bearer token for the internal worker drain endpoint, which pumps retries
   * between deliveries. Unset disables the endpoint entirely (404).
   */
  WEBHOOK_WORKER_TOKEN: z
    .string()
    .trim()
    .min(16, "WEBHOOK_WORKER_TOKEN must be at least 16 characters.")
    .optional(),

  // Phase 14 — AI provider
  AI_PROVIDER: optionalText,
  AI_API_KEY: optionalText,
  AI_DEFAULT_MODEL: optionalText,
});

export type ServerEnv = z.infer<typeof serverEnvSchema>;

function formatIssues(error: z.ZodError): Array<{ variable: string; rule: string }> {
  return error.issues.map((issue) => ({
    variable: issue.path.map(String).join(".") || "(root)",
    rule: issue.message,
  }));
}

/**
 * Parses and validates a source object. Pure: no caching, no global state.
 * Throws `CONFIG_INVALID` with variable names only.
 */
export function parseServerEnv(
  source: Record<string, string | undefined> = process.env,
): ServerEnv {
  const result = serverEnvSchema.safeParse(source);

  if (!result.success) {
    throw new AppError({
      code: "CONFIG_INVALID",
      message: "Invalid server environment configuration.",
      details: { issues: formatIssues(result.error) },
    });
  }

  return result.data;
}

let cachedEnv: ServerEnv | null = null;

export function getServerEnv(): ServerEnv {
  cachedEnv ??= parseServerEnv();
  return cachedEnv;
}

/** Test helper. Never called by production code. */
export function resetServerEnvCache(): void {
  cachedEnv = null;
}

export interface SafeEnvSummary {
  environment: ServerEnv["NODE_ENV"];
  appUrl: string;
  logLevel: ServerEnv["LOG_LEVEL"];
  integrations: {
    database: "configured" | "not_configured";
    salla: "configured" | "not_configured";
    aiProvider: "configured" | "not_configured";
  };
}

/**
 * Safe-to-log environment summary. Contains no secrets and no credential
 * fragments; only presence flags.
 */
export function getSafeEnvSummary(env: ServerEnv = getServerEnv()): SafeEnvSummary {
  return {
    environment: env.NODE_ENV,
    appUrl: env.APP_URL,
    logLevel: env.LOG_LEVEL,
    integrations: {
      database: env.DATABASE_URL ? "configured" : "not_configured",
      salla:
        env.SALLA_CLIENT_ID && env.SALLA_CLIENT_SECRET && env.SALLA_REDIRECT_URI
          ? "configured"
          : "not_configured",
      aiProvider: env.AI_PROVIDER && env.AI_API_KEY ? "configured" : "not_configured",
    },
  };
}
