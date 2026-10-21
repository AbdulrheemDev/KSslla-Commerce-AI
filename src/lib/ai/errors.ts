import { AppError } from "@/lib/errors";
import type { AiValidationIssue } from "@/lib/ai/types";

export interface AiProviderErrorOptions {
  retryable?: boolean;
  cause?: unknown;
  details?: Record<string, unknown>;
}

/**
 * Provider adapters throw this for transient failures (429, 5xx, network) with
 * `retryable: true`, and for permanent failures (401, 400) with `false`.
 */
export class AiProviderError extends AppError {
  constructor(message: string, options: AiProviderErrorOptions = {}) {
    super({
      code: "AI_PROVIDER_ERROR",
      message,
      retryable: options.retryable ?? false,
      ...(options.cause === undefined ? {} : { cause: options.cause }),
      ...(options.details === undefined ? {} : { details: options.details }),
    });
  }
}

export class AiProviderNotConfiguredError extends AppError {
  constructor(message = "No AI provider is configured for this environment.") {
    super({ code: "AI_NOT_CONFIGURED", message });
  }
}

export class AiProviderRequiredError extends AppError {
  constructor(
    message = "Multiple AI providers are registered; an explicit providerId is required.",
  ) {
    super({ code: "AI_PROVIDER_REQUIRED", message });
  }
}

export class AiTimeoutError extends AppError {
  constructor(message = "The AI provider did not respond within the allowed time.") {
    super({ code: "AI_TIMEOUT", message, retryable: true });
  }
}

export class AiInvalidOutputError extends AppError {
  readonly issues: readonly AiValidationIssue[];

  constructor(
    schemaName: string,
    issues: readonly AiValidationIssue[],
    options: { cause?: unknown } = {},
  ) {
    super({
      code: "AI_INVALID_OUTPUT",
      message: `The AI response did not match the "${schemaName}" schema.`,
      details: { schemaName, issues: issues.slice(0, 10) },
      ...(options.cause === undefined ? {} : { cause: options.cause }),
    });
    this.issues = issues;
  }
}
