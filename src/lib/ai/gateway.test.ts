import type { DestinationStream } from "pino";
import { describe, expect, it } from "vitest";
import { z } from "zod";

import { AiInvalidOutputError, AiProviderError } from "@/lib/ai/errors";
import { createAiGateway, parseJsonResponse } from "@/lib/ai/gateway";
import { AiProviderRegistry } from "@/lib/ai/registry";
import type {
  AiCallContext,
  AiCompletionRequest,
  AiProvider,
  AiProviderResponse,
  AiTokenUsage,
} from "@/lib/ai/types";
import { createLogger } from "@/lib/logger";

type Step = (request: AiCompletionRequest, context: AiCallContext) => Promise<AiProviderResponse>;

class ScriptedProvider implements AiProvider {
  readonly id: string;
  readonly capabilities = ["text"] as const;
  readonly defaultModel = "scripted-1";
  readonly models = ["scripted-1"];
  readonly calls: Array<{ request: AiCompletionRequest; context: AiCallContext }> = [];

  private readonly steps: Step[];

  constructor(steps: Step[], id = "scripted") {
    this.steps = [...steps];
    this.id = id;
  }

  async generate(
    request: AiCompletionRequest,
    context: AiCallContext,
  ): Promise<AiProviderResponse> {
    this.calls.push({ request, context });
    const step = this.steps.shift();
    if (!step) {
      throw new Error("No scripted response left");
    }
    return step(request, context);
  }
}

function reply(text: string, usage?: AiTokenUsage): Step {
  return async () => ({
    text,
    model: "scripted-1",
    ...(usage === undefined ? {} : { usage }),
    finishReason: "stop",
  });
}

function createCapture() {
  const lines: string[] = [];
  const destination = {
    write(chunk: string) {
      lines.push(chunk);
    },
  } as unknown as DestinationStream;

  const logger = createLogger({ level: "trace", destination, context: { service: "ai-test" } });
  const records = () => lines.map((line) => JSON.parse(line) as Record<string, unknown>);

  return { logger, lines, records };
}

const context: AiCallContext = {
  requestId: "req_1",
  operation: "test.generate",
  tenant: { organizationId: "org_1", storeId: "store_1" },
};

const prompt = [{ role: "user" as const, content: "Write a product description." }];

function buildGateway(
  provider: ScriptedProvider,
  options: {
    logger?: ReturnType<typeof createCapture>["logger"];
    sleep?: (ms: number, signal?: AbortSignal) => Promise<void>;
    maxAttempts?: number;
    timeoutMs?: number;
  } = {},
) {
  const capture = createCapture();
  const sleepCalls: number[] = [];

  const gateway = createAiGateway({
    registry: new AiProviderRegistry([provider]),
    logger: options.logger ?? capture.logger,
    random: () => 0.5,
    baseDelayMs: 10,
    maxDelayMs: 10,
    maxAttempts: options.maxAttempts ?? 3,
    ...(options.timeoutMs === undefined ? {} : { timeoutMs: options.timeoutMs }),
    sleep:
      options.sleep ??
      (async (ms) => {
        sleepCalls.push(ms);
      }),
  });

  return { gateway, capture, sleepCalls };
}

describe("AiGateway.generateText", () => {
  it("returns text and metadata for a successful call", async () => {
    const usage: AiTokenUsage = { inputTokens: 10, outputTokens: 5, totalTokens: 15 };
    const provider = new ScriptedProvider([reply("مرحبًا", usage)]);
    const { gateway, capture } = buildGateway(provider);

    const result = await gateway.generateText({ messages: prompt, context });

    expect(result.text).toBe("مرحبًا");
    expect(result.meta).toMatchObject({
      providerId: "scripted",
      model: "scripted-1",
      operation: "test.generate",
      requestId: "req_1",
      attempts: 1,
      usage,
    });
    expect(provider.calls).toHaveLength(1);
    expect(provider.calls[0]?.request.model).toBe("scripted-1");

    const records = capture.records();
    const completed = records.find((record) => record.event === "ai.generation.completed");
    expect(completed).toMatchObject({
      organizationId: "org_1",
      storeId: "store_1",
      requestId: "req_1",
      providerId: "scripted",
      mode: "text",
    });
    expect(capture.lines.join("\n")).not.toContain("Write a product description.");
  });

  it("rejects calls without tenant scope before reaching the provider", async () => {
    const provider = new ScriptedProvider([reply("should not be called")]);
    const { gateway } = buildGateway(provider);

    await expect(
      gateway.generateText({
        messages: prompt,
        context: { ...context, tenant: { organizationId: "org_1", storeId: "" } },
      }),
    ).rejects.toMatchObject({ code: "VALIDATION_FAILED" });

    expect(provider.calls).toHaveLength(0);
  });

  it("rejects an empty message list", async () => {
    const provider = new ScriptedProvider([reply("unused")]);
    const { gateway } = buildGateway(provider);

    await expect(gateway.generateText({ messages: [], context })).rejects.toMatchObject({
      code: "VALIDATION_FAILED",
    });
  });

  it("retries retryable provider failures and reports attempts", async () => {
    const provider = new ScriptedProvider([
      async () => {
        throw new AiProviderError("Rate limited", { retryable: true });
      },
      reply("recovered"),
    ]);
    const { gateway, capture, sleepCalls } = buildGateway(provider);

    const result = await gateway.generateText({ messages: prompt, context });

    expect(result.text).toBe("recovered");
    expect(result.meta.attempts).toBe(2);
    expect(provider.calls).toHaveLength(2);
    expect(sleepCalls).toHaveLength(1);
    expect(sleepCalls[0]).toBeGreaterThanOrEqual(5);
    expect(sleepCalls[0]).toBeLessThanOrEqual(10);
    expect(capture.records().some((record) => record.event === "ai.generation.retry")).toBe(true);
  });

  it("does not retry non-retryable provider failures", async () => {
    const provider = new ScriptedProvider([
      async () => {
        throw new AiProviderError("Invalid API key", { retryable: false });
      },
    ]);
    const { gateway, capture } = buildGateway(provider);

    await expect(gateway.generateText({ messages: prompt, context })).rejects.toMatchObject({
      code: "AI_PROVIDER_ERROR",
    });

    expect(provider.calls).toHaveLength(1);
    expect(capture.records().some((record) => record.event === "ai.generation.retry")).toBe(false);
  });

  it("does not log provider error messages that may contain secrets", async () => {
    const provider = new ScriptedProvider([
      async () => {
        throw new AiProviderError("upstream echoed sk-super-secret", { retryable: false });
      },
    ]);
    const { gateway, capture } = buildGateway(provider);

    await expect(gateway.generateText({ messages: prompt, context })).rejects.toBeInstanceOf(
      AiProviderError,
    );

    expect(capture.lines.join("\n")).not.toContain("sk-super-secret");
  });

  it("maps a provider timeout to AI_TIMEOUT", async () => {
    const provider = new ScriptedProvider([
      (_request, callContext) =>
        new Promise<AiProviderResponse>((_resolve, reject) => {
          callContext.signal?.addEventListener(
            "abort",
            () => reject(new DOMException("Aborted", "AbortError")),
            { once: true },
          );
        }),
    ]);
    const { gateway } = buildGateway(provider, { timeoutMs: 20, maxAttempts: 1 });

    await expect(gateway.generateText({ messages: prompt, context })).rejects.toMatchObject({
      code: "AI_TIMEOUT",
    });
  });

  it("honors an already-aborted external signal", async () => {
    const provider = new ScriptedProvider([reply("unused")]);
    const { gateway } = buildGateway(provider);
    const controller = new AbortController();
    controller.abort();

    await expect(
      gateway.generateText({
        messages: prompt,
        context: { ...context, signal: controller.signal },
      }),
    ).rejects.toMatchObject({ code: "AI_PROVIDER_ERROR" });

    expect(provider.calls).toHaveLength(0);
  });
});

describe("AiGateway.generateStructured", () => {
  const schema = z.object({
    title: z.string().min(1),
    count: z.number().int().nonnegative(),
  });

  it("validates and returns structured output", async () => {
    const provider = new ScriptedProvider([reply('{"title":"عباية","count":3}')]);
    const { gateway } = buildGateway(provider);

    const result = await gateway.generateStructured({
      messages: prompt,
      context,
      schema,
      schemaName: "product_summary",
    });

    expect(result.data).toEqual({ title: "عباية", count: 3 });
    expect(result.meta.validationAttempts).toBe(1);

    const instruction = provider.calls[0]?.request.messages.at(-1)?.content ?? "";
    expect(instruction).toContain("JSON Schema");
    expect(instruction).toContain("product_summary");
  });

  it("parses JSON wrapped in Markdown fences", async () => {
    const provider = new ScriptedProvider([reply('```json\n{"title":"قندورة","count":1}\n```')]);
    const { gateway } = buildGateway(provider);

    const result = await gateway.generateStructured({
      messages: prompt,
      context,
      schema,
      schemaName: "product_summary",
    });

    expect(result.data.title).toBe("قندورة");
  });

  it("repairs one invalid response before succeeding", async () => {
    const provider = new ScriptedProvider([
      reply("this is not json"),
      reply('{"title":"جديد","count":2}'),
    ]);
    const { gateway, capture } = buildGateway(provider);

    const result = await gateway.generateStructured({
      messages: prompt,
      context,
      schema,
      schemaName: "product_summary",
      repairAttempts: 1,
    });

    expect(result.data).toEqual({ title: "جديد", count: 2 });
    expect(result.meta.validationAttempts).toBe(2);
    expect(provider.calls).toHaveLength(2);

    const repairMessages = provider.calls[1]?.request.messages ?? [];
    expect(repairMessages.some((message) => message.content.includes("failed validation"))).toBe(
      true,
    );
    expect(capture.records().some((record) => record.event === "ai.structured.invalid")).toBe(true);
  });

  it("throws AI_INVALID_OUTPUT when the schema still fails after repairs", async () => {
    const provider = new ScriptedProvider([
      reply('{"title":"","count":-1}'),
      reply('{"title":"","count":-1}'),
      reply('{"title":"","count":-1}'),
    ]);
    const { gateway } = buildGateway(provider);

    await expect(
      gateway.generateStructured({
        messages: prompt,
        context,
        schema,
        schemaName: "product_summary",
        repairAttempts: 1,
      }),
    ).rejects.toBeInstanceOf(AiInvalidOutputError);

    await expect(
      gateway.generateStructured({
        messages: prompt,
        context: { ...context, requestId: "req_2" },
        schema,
        schemaName: "product_summary",
        repairAttempts: 0,
      }),
    ).rejects.toMatchObject({ code: "AI_INVALID_OUTPUT" });
  });

  it("uses an unambiguous provider error when two providers are registered", async () => {
    const first = new ScriptedProvider([reply("unused")]);
    const second = new ScriptedProvider([reply("unused")], "scripted-2");
    const capture = createCapture();

    const gateway = createAiGateway({
      registry: new AiProviderRegistry([first, second]),
      logger: capture.logger,
    });

    await expect(gateway.generateText({ messages: prompt, context })).rejects.toMatchObject({
      code: "AI_PROVIDER_REQUIRED",
    });
  });
});

describe("parseJsonResponse", () => {
  it("extracts JSON surrounded by prose", () => {
    expect(parseJsonResponse('Here you go: {"a":1} thanks')).toEqual({
      ok: true,
      value: { a: 1 },
    });
  });

  it("extracts fenced JSON arrays", () => {
    expect(parseJsonResponse("```json\n[1,2,3]\n```")).toEqual({
      ok: true,
      value: [1, 2, 3],
    });
  });

  it("reports empty and invalid responses", () => {
    expect(parseJsonResponse("   ")).toEqual({
      ok: false,
      message: "The response was empty.",
    });
    expect(parseJsonResponse("no json here")).toEqual({
      ok: false,
      message: "The response was not valid JSON.",
    });
  });
});
