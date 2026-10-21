import "server-only";

import type { Logger } from "pino";
import { z, type ZodType } from "zod";

import { AiInvalidOutputError, AiProviderError, AiTimeoutError } from "@/lib/ai/errors";
import type { AiProviderRegistry } from "@/lib/ai/registry";
import type {
  AiCallContext,
  AiCompletionRequest,
  AiGenerationMeta,
  AiMessage,
  AiProvider,
  AiProviderResponse,
  AiStructuredInput,
  AiStructuredResult,
  AiTextInput,
  AiTextResult,
  AiValidationIssue,
} from "@/lib/ai/types";
import { AppError, isAppError } from "@/lib/errors";
import { logger as rootLogger } from "@/lib/logger";

/**
 * AI Gateway.
 *
 * Responsibilities:
 * - resolve the provider and model
 * - enforce tenant scope and request validation
 * - timeouts, retries with backoff+jitter
 * - structured-output validation and a bounded repair loop
 * - metadata-only logging (never prompts, outputs, or secrets)
 *
 * Providers implement transport only; the gateway owns policy.
 */

const DEFAULT_TIMEOUT_MS = 30_000;
const DEFAULT_MAX_ATTEMPTS = 3;
const DEFAULT_BASE_DELAY_MS = 250;
const DEFAULT_MAX_DELAY_MS = 4_000;
const DEFAULT_MAX_REPAIR_ATTEMPTS = 1;
const MAX_REPORTED_ISSUES = 10;

export interface AiGatewayOptions {
  registry: AiProviderRegistry;
  logger?: Logger;
  now?: () => number;
  sleep?: (ms: number, signal?: AbortSignal) => Promise<void>;
  random?: () => number;
  maxAttempts?: number;
  baseDelayMs?: number;
  maxDelayMs?: number;
  timeoutMs?: number;
  maxRepairAttempts?: number;
}

interface InvocationResult {
  response: AiProviderResponse;
  attempts: number;
}

function validationError(message: string, details?: Record<string, unknown>): AppError {
  return new AppError({
    code: "VALIDATION_FAILED",
    message,
    ...(details === undefined ? {} : { details }),
  });
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function assertCallContext(context: AiCallContext): void {
  if (!context || typeof context !== "object") {
    throw validationError("AI call context is required.");
  }

  if (!isNonEmptyString(context.requestId)) {
    throw validationError("AI call context requires a requestId.");
  }

  if (!isNonEmptyString(context.operation)) {
    throw validationError("AI call context requires an operation name.");
  }

  if (!context.tenant || typeof context.tenant !== "object") {
    throw validationError("AI calls must be scoped to a tenant.");
  }

  if (!isNonEmptyString(context.tenant.organizationId)) {
    throw validationError("AI calls require an organizationId.");
  }

  if (!isNonEmptyString(context.tenant.storeId)) {
    throw validationError("AI calls require a storeId.");
  }

  if (
    context.timeoutMs !== undefined &&
    (!Number.isFinite(context.timeoutMs) || context.timeoutMs <= 0)
  ) {
    throw validationError("timeoutMs must be a positive number.");
  }
}

function assertCompletionRequest(request: AiCompletionRequest): void {
  if (!Array.isArray(request.messages) || request.messages.length === 0) {
    throw validationError("At least one message is required.");
  }

  for (const message of request.messages) {
    if (!message || typeof message !== "object") {
      throw validationError("Each message must be an object.");
    }

    if (!["system", "user", "assistant"].includes(message.role)) {
      throw validationError("Invalid message role.", { role: message.role });
    }

    if (!isNonEmptyString(message.content)) {
      throw validationError("Message content must be a non-empty string.");
    }
  }

  if (request.temperature !== undefined) {
    if (
      !Number.isFinite(request.temperature) ||
      request.temperature < 0 ||
      request.temperature > 2
    ) {
      throw validationError("temperature must be between 0 and 2.");
    }
  }

  if (request.maxOutputTokens !== undefined) {
    if (!Number.isInteger(request.maxOutputTokens) || request.maxOutputTokens <= 0) {
      throw validationError("maxOutputTokens must be a positive integer.");
    }
  }
}

function defaultSleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new AiProviderError("AI request was aborted.", { retryable: false }));
      return;
    }

    const onAbort = () => {
      clearTimeout(timer);
      reject(new AiProviderError("AI request was aborted.", { retryable: false }));
    };

    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);

    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

function tryToJsonSchema(schema: ZodType): unknown {
  try {
    return z.toJSONSchema(schema, { io: "output" });
  } catch {
    // Some schemas (transforms, custom refinements) have no JSON Schema
    // representation. Validation still runs on the response.
    return undefined;
  }
}

function buildStructuredInstruction(schemaName: string, schema: ZodType): string {
  const lines = [
    "Return ONLY one JSON value. Do not wrap it in Markdown fences and do not add commentary.",
    `The JSON must validate against the schema named "${schemaName}".`,
    "Do not invent fields. Omit fields you are unsure about unless the schema requires them.",
  ];

  const jsonSchema = tryToJsonSchema(schema);
  if (jsonSchema !== undefined) {
    lines.push("JSON Schema:", JSON.stringify(jsonSchema));
  }

  return lines.join("\n");
}

function buildRepairInstruction(issues: readonly AiValidationIssue[]): string {
  const lines = [
    "Your previous response failed validation.",
    "Correct only the invalid parts and return the complete corrected JSON value only.",
    "Validation errors:",
  ];

  for (const issue of issues.slice(0, MAX_REPORTED_ISSUES)) {
    lines.push(`- ${issue.path}: ${issue.message} (${issue.code})`);
  }

  return lines.join("\n");
}

type JsonParseResult = { ok: true; value: unknown } | { ok: false; message: string };

/** Extracts a JSON value from a model response, tolerating code fences. */
export function parseJsonResponse(raw: string): JsonParseResult {
  const trimmed = raw.trim();
  if (trimmed.length === 0) {
    return { ok: false, message: "The response was empty." };
  }

  const fenced = /^```(?:json)?\s*([\s\S]*?)\s*```$/i.exec(trimmed);
  const candidate = fenced?.[1]?.trim() ?? trimmed;

  const objectStart = candidate.indexOf("{");
  const arrayStart = candidate.indexOf("[");
  const starts = [objectStart, arrayStart].filter((index) => index >= 0);
  const start = starts.length > 0 ? Math.min(...starts) : -1;
  const end = Math.max(candidate.lastIndexOf("}"), candidate.lastIndexOf("]"));

  const sliced = start >= 0 && end > start ? candidate.slice(start, end + 1) : candidate;

  try {
    return { ok: true, value: JSON.parse(sliced) as unknown };
  } catch {
    return { ok: false, message: "The response was not valid JSON." };
  }
}

function toValidationIssues(error: z.ZodError): AiValidationIssue[] {
  return error.issues.map((issue) => ({
    path: issue.path.map(String).join(".") || "(root)",
    code: issue.code,
    message: issue.message,
  }));
}

function isAbortError(error: unknown): boolean {
  return (
    (error instanceof DOMException && error.name === "AbortError") ||
    (error instanceof Error && error.name === "AbortError")
  );
}

export class AiGateway {
  private readonly registry: AiProviderRegistry;
  private readonly logger: Logger;
  private readonly now: () => number;
  private readonly sleep: (ms: number, signal?: AbortSignal) => Promise<void>;
  private readonly random: () => number;
  private readonly maxAttempts: number;
  private readonly baseDelayMs: number;
  private readonly maxDelayMs: number;
  private readonly timeoutMs: number;
  private readonly maxRepairAttempts: number;

  constructor(options: AiGatewayOptions) {
    this.registry = options.registry;
    this.logger = options.logger ?? rootLogger;
    this.now = options.now ?? Date.now;
    this.sleep = options.sleep ?? defaultSleep;
    this.random = options.random ?? Math.random;
    this.maxAttempts = Math.max(1, Math.floor(options.maxAttempts ?? DEFAULT_MAX_ATTEMPTS));
    this.baseDelayMs = Math.max(0, options.baseDelayMs ?? DEFAULT_BASE_DELAY_MS);
    this.maxDelayMs = Math.max(this.baseDelayMs, options.maxDelayMs ?? DEFAULT_MAX_DELAY_MS);
    this.timeoutMs = Math.max(1, options.timeoutMs ?? DEFAULT_TIMEOUT_MS);
    this.maxRepairAttempts = Math.max(
      0,
      Math.floor(options.maxRepairAttempts ?? DEFAULT_MAX_REPAIR_ATTEMPTS),
    );
  }

  async generateText(input: AiTextInput): Promise<AiTextResult> {
    assertCallContext(input.context);
    assertCompletionRequest(input);

    if (input.context.signal?.aborted) {
      throw new AiProviderError("AI request was aborted.", { retryable: false });
    }

    const provider = this.registry.require(input.providerId);
    const model = input.model ?? provider.defaultModel;
    const startedAt = this.now();

    const { response, attempts } = await this.invoke(provider, input, model);

    const latencyMs = this.now() - startedAt;
    const meta: AiGenerationMeta = {
      providerId: provider.id,
      model: response.model || model,
      operation: input.context.operation,
      requestId: input.context.requestId,
      latencyMs,
      attempts,
      ...(input.context.promptId === undefined ? {} : { promptId: input.context.promptId }),
      ...(input.context.promptVersion === undefined
        ? {}
        : { promptVersion: input.context.promptVersion }),
      ...(response.usage === undefined ? {} : { usage: response.usage }),
      ...(response.finishReason === undefined ? {} : { finishReason: response.finishReason }),
    };

    this.logger.info(
      {
        event: "ai.generation.completed",
        mode: "text",
        ...this.logContext(input.context),
        providerId: meta.providerId,
        model: meta.model,
        latencyMs: meta.latencyMs,
        attempts: meta.attempts,
        inputTokens: response.usage?.inputTokens,
        outputTokens: response.usage?.outputTokens,
        finishReason: meta.finishReason,
      },
      "AI generation completed",
    );

    return { text: response.text, meta };
  }

  async generateStructured<T>(input: AiStructuredInput<T>): Promise<AiStructuredResult<T>> {
    assertCallContext(input.context);
    assertCompletionRequest(input);

    if (!isNonEmptyString(input.schemaName)) {
      throw validationError("schemaName is required for structured generation.");
    }

    if (!input.schema || typeof input.schema.safeParse !== "function") {
      throw validationError("A Zod schema is required for structured generation.");
    }

    const maxRepairs = Math.max(0, Math.floor(input.repairAttempts ?? this.maxRepairAttempts));
    const instruction = buildStructuredInstruction(input.schemaName, input.schema);

    let messages: AiMessage[] = [...input.messages, { role: "user", content: instruction }];
    let issues: AiValidationIssue[] = [];
    let lastMeta: AiGenerationMeta | null = null;
    let totalLatencyMs = 0;
    let totalAttempts = 0;
    let lastRaw = "";

    for (let round = 1; round <= maxRepairs + 1; round += 1) {
      const textInput: AiTextInput = {
        context: input.context,
        messages,
        ...(input.providerId === undefined ? {} : { providerId: input.providerId }),
        ...(input.model === undefined ? {} : { model: input.model }),
        ...(input.temperature === undefined ? {} : { temperature: input.temperature }),
        ...(input.maxOutputTokens === undefined ? {} : { maxOutputTokens: input.maxOutputTokens }),
      };

      const result = await this.generateText(textInput);
      lastMeta = result.meta;
      totalLatencyMs += result.meta.latencyMs;
      totalAttempts += result.meta.attempts;
      lastRaw = result.text;

      const parsed = parseJsonResponse(result.text);
      if (parsed.ok) {
        const validation = input.schema.safeParse(parsed.value);
        if (validation.success) {
          this.logger.info(
            {
              event: "ai.structured.validated",
              ...this.logContext(input.context),
              schemaName: input.schemaName,
              validationAttempts: round,
              providerId: result.meta.providerId,
              model: result.meta.model,
            },
            "AI structured output validated",
          );

          return {
            data: validation.data,
            raw: result.text,
            meta: {
              ...result.meta,
              latencyMs: totalLatencyMs,
              attempts: totalAttempts,
              validationAttempts: round,
            },
          };
        }
        issues = toValidationIssues(validation.error);
      } else {
        issues = [{ path: "(root)", code: "invalid_json", message: parsed.message }];
      }

      this.logger.warn(
        {
          event: "ai.structured.invalid",
          ...this.logContext(input.context),
          schemaName: input.schemaName,
          validationAttempts: round,
          issueCount: issues.length,
          issueCodes: issues.slice(0, 5).map((issue) => issue.code),
        },
        "AI structured output failed validation",
      );

      if (round <= maxRepairs) {
        const previous = lastRaw.length > 4_000 ? lastRaw.slice(0, 4_000) : lastRaw;
        messages = [
          ...messages,
          { role: "assistant", content: previous },
          { role: "user", content: buildRepairInstruction(issues) },
        ];
      }
    }

    if (!lastMeta) {
      throw new AppError({
        code: "INTERNAL",
        message: "Structured generation produced no result.",
      });
    }

    this.logger.error(
      {
        event: "ai.structured.failed",
        ...this.logContext(input.context),
        schemaName: input.schemaName,
        validationAttempts: maxRepairs + 1,
        issueCount: issues.length,
        issueCodes: issues.slice(0, 5).map((issue) => issue.code),
      },
      "AI structured output could not be validated",
    );

    throw new AiInvalidOutputError(input.schemaName, issues);
  }

  private async invoke(
    provider: AiProvider,
    input: AiTextInput,
    model: string,
  ): Promise<InvocationResult> {
    const request: AiCompletionRequest = {
      messages: input.messages,
      model,
      ...(input.temperature === undefined ? {} : { temperature: input.temperature }),
      ...(input.maxOutputTokens === undefined ? {} : { maxOutputTokens: input.maxOutputTokens }),
    };

    let lastError: AppError | null = null;

    for (let attempt = 1; attempt <= this.maxAttempts; attempt += 1) {
      const timeoutMs = input.context.timeoutMs ?? this.timeoutMs;
      const timeoutSignal = AbortSignal.timeout(timeoutMs);
      const signal = input.context.signal
        ? AbortSignal.any([input.context.signal, timeoutSignal])
        : timeoutSignal;

      const startedAt = this.now();

      try {
        const response = await provider.generate(request, { ...input.context, signal });

        if (!response || typeof response.text !== "string") {
          throw new AiProviderError("AI provider returned an invalid response.", {
            retryable: false,
          });
        }

        return { response, attempts: attempt };
      } catch (error) {
        const normalized = this.normalizeError(error, timeoutSignal, input.context);
        lastError = normalized;

        const canRetry = normalized.retryable && attempt < this.maxAttempts;

        if (!canRetry) {
          this.logger.error(
            {
              event: "ai.generation.failed",
              ...this.logContext(input.context),
              providerId: provider.id,
              model,
              attempt,
              latencyMs: this.now() - startedAt,
              errorCode: normalized.code,
            },
            "AI generation failed",
          );
          throw normalized;
        }

        const delayMs = this.backoffDelay(attempt);

        this.logger.warn(
          {
            event: "ai.generation.retry",
            ...this.logContext(input.context),
            providerId: provider.id,
            model,
            attempt,
            nextAttempt: attempt + 1,
            delayMs,
            errorCode: normalized.code,
          },
          "Retrying AI generation",
        );

        try {
          await this.sleep(delayMs, input.context.signal);
        } catch (sleepError) {
          throw new AiProviderError("AI request was aborted.", {
            retryable: false,
            cause: sleepError,
          });
        }
      }
    }

    throw (
      lastError ?? new AiProviderError("AI generation failed after retries.", { retryable: false })
    );
  }

  private normalizeError(
    error: unknown,
    timeoutSignal: AbortSignal,
    context: AiCallContext,
  ): AppError {
    if (timeoutSignal.aborted) {
      return new AiTimeoutError();
    }

    if (context.signal?.aborted) {
      return new AiProviderError("AI request was aborted.", {
        retryable: false,
        cause: error,
      });
    }

    if (isAppError(error)) {
      if (
        error.code === "AI_TIMEOUT" ||
        error.code === "AI_PROVIDER_ERROR" ||
        error.code === "RATE_LIMITED"
      ) {
        return error;
      }

      return new AiProviderError(error.message, { retryable: false, cause: error });
    }

    if (isAbortError(error)) {
      return new AiTimeoutError();
    }

    return new AiProviderError("AI provider call failed.", {
      retryable: false,
      cause: error,
    });
  }

  private backoffDelay(attempt: number): number {
    const exponential = this.baseDelayMs * 2 ** (attempt - 1);
    const jittered = exponential * (0.5 + this.random() * 0.5);
    return Math.min(this.maxDelayMs, Math.max(0, Math.round(jittered)));
  }

  private logContext(context: AiCallContext): Record<string, unknown> {
    return {
      requestId: context.requestId,
      operation: context.operation,
      organizationId: context.tenant.organizationId,
      storeId: context.tenant.storeId,
      promptId: context.promptId,
      promptVersion: context.promptVersion,
    };
  }
}

export function createAiGateway(options: AiGatewayOptions): AiGateway {
  return new AiGateway(options);
}
