import type { ZodType } from "zod";

/**
 * AI provider abstraction.
 *
 * The domain never imports a vendor SDK. Every call goes through this contract,
 * which keeps the platform free to use OpenAI, Anthropic, Google Gemini, or an
 * in-house model without changing business logic.
 *
 * Phase 01 defines the contract only. No provider is implemented or configured.
 */

export const AI_CAPABILITIES = [
  "text",
  "json_mode",
  "vision",
  "tool_calling",
  "embeddings",
] as const;

export type AiCapability = (typeof AI_CAPABILITIES)[number];

export type AiMessageRole = "system" | "user" | "assistant";

export interface AiMessage {
  role: AiMessageRole;
  content: string;
}

export type AiFinishReason = "stop" | "length" | "content_filter" | "unknown";

export interface AiTokenUsage {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
}

/**
 * Tenant scope is mandatory for every AI call. It prevents accidental
 * cross-tenant context assembly and makes every generation attributable.
 */
export interface AiTenantScope {
  organizationId: string;
  storeId: string;
}

export interface AiCallContext {
  /** Correlates the generation with the originating request/action. */
  requestId: string;
  /** Stable operation name, e.g. "product.description.generate". */
  operation: string;
  tenant: AiTenantScope;
  /** Prompt registry identifiers (Phase 14). */
  promptId?: string;
  promptVersion?: string;
  signal?: AbortSignal;
  /** Per-call timeout. Falls back to the gateway default. */
  timeoutMs?: number;
}

export interface AiCompletionRequest {
  messages: readonly AiMessage[];
  model?: string;
  temperature?: number;
  maxOutputTokens?: number;
}

export interface AiProviderResponse {
  text: string;
  model: string;
  finishReason?: AiFinishReason;
  usage?: AiTokenUsage;
}

export interface AiProvider {
  /** Lowercase kebab-case identifier, e.g. "openai". */
  readonly id: string;
  readonly capabilities: readonly AiCapability[];
  readonly defaultModel: string;
  readonly models?: readonly string[];
  generate(request: AiCompletionRequest, context: AiCallContext): Promise<AiProviderResponse>;
}

export interface AiTextInput extends AiCompletionRequest {
  context: AiCallContext;
  providerId?: string;
}

export interface AiStructuredInput<T> extends AiTextInput {
  schema: ZodType<T>;
  schemaName: string;
  /** Extra correction rounds after an invalid response. Default: 1. */
  repairAttempts?: number;
}

export interface AiGenerationMeta {
  providerId: string;
  model: string;
  operation: string;
  requestId: string;
  promptId?: string;
  promptVersion?: string;
  latencyMs: number;
  /** Number of provider calls (retries included). */
  attempts: number;
  usage?: AiTokenUsage;
  finishReason?: AiFinishReason;
}

export interface AiTextResult {
  text: string;
  meta: AiGenerationMeta;
}

export interface AiStructuredResult<T> {
  data: T;
  raw: string;
  meta: AiGenerationMeta & {
    /** Number of generation + validation rounds. */
    validationAttempts: number;
  };
}

export interface AiValidationIssue {
  path: string;
  code: string;
  message: string;
}
