import { describe, expect, it } from "vitest";

import { AiProviderRegistry } from "@/lib/ai/registry";
import type { AiCapability, AiProvider } from "@/lib/ai/types";

function createProvider(id: string, capabilities: readonly AiCapability[] = ["text"]): AiProvider {
  return {
    id,
    capabilities,
    defaultModel: `${id}-model`,
    async generate() {
      return { text: "ok", model: `${id}-model` };
    },
  };
}

describe("AiProviderRegistry", () => {
  it("registers and resolves a single provider", () => {
    const provider = createProvider("openai");
    const registry = new AiProviderRegistry([provider]);

    expect(registry.get("openai")).toBe(provider);
    expect(registry.require()).toBe(provider);
    expect(registry.list()).toEqual([provider]);
  });

  it("rejects duplicate provider ids", () => {
    const registry = new AiProviderRegistry([createProvider("fake")]);

    expect(() => registry.register(createProvider("fake"))).toThrowError(
      expect.objectContaining({ code: "CONFLICT" }),
    );
  });

  it("rejects invalid provider ids", () => {
    const registry = new AiProviderRegistry();

    expect(() => registry.register(createProvider("Fake Provider"))).toThrowError(
      expect.objectContaining({ code: "VALIDATION_FAILED" }),
    );
  });

  it("requires the text capability", () => {
    const registry = new AiProviderRegistry();

    expect(() => registry.register(createProvider("vision-only", ["vision"]))).toThrowError(
      expect.objectContaining({ code: "VALIDATION_FAILED" }),
    );
  });

  it("fails with AI_NOT_CONFIGURED when no provider is registered", () => {
    const registry = new AiProviderRegistry();

    expect(() => registry.require()).toThrowError(
      expect.objectContaining({ code: "AI_NOT_CONFIGURED" }),
    );
  });

  it("requires an explicit provider when several are registered", () => {
    const registry = new AiProviderRegistry([
      createProvider("openai"),
      createProvider("anthropic"),
    ]);

    expect(() => registry.require()).toThrowError(
      expect.objectContaining({ code: "AI_PROVIDER_REQUIRED" }),
    );
    expect(registry.require("anthropic").id).toBe("anthropic");
  });

  it("fails with AI_NOT_CONFIGURED for an unknown provider id", () => {
    const registry = new AiProviderRegistry([createProvider("openai")]);

    expect(() => registry.require("gemini")).toThrowError(
      expect.objectContaining({ code: "AI_NOT_CONFIGURED" }),
    );
  });
});
