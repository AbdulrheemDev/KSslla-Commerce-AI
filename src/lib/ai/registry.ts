import { AppError } from "@/lib/errors";
import { AiProviderNotConfiguredError, AiProviderRequiredError } from "@/lib/ai/errors";
import type { AiProvider } from "@/lib/ai/types";

const PROVIDER_ID_PATTERN = /^[a-z][a-z0-9-]{1,31}$/;

/**
 * In-process registry of AI providers.
 *
 * Registration happens at composition time (app bootstrap / provider factory),
 * never inside domain code. Phase 01 ships an empty registry.
 */
export class AiProviderRegistry {
  private readonly providers = new Map<string, AiProvider>();

  constructor(initialProviders: readonly AiProvider[] = []) {
    for (const provider of initialProviders) {
      this.register(provider);
    }
  }

  register(provider: AiProvider): void {
    if (!PROVIDER_ID_PATTERN.test(provider.id)) {
      throw new AppError({
        code: "VALIDATION_FAILED",
        message: "Invalid AI provider id. Use lowercase kebab-case (2–32 characters).",
        details: { providerId: provider.id },
      });
    }

    if (!provider.capabilities.includes("text")) {
      throw new AppError({
        code: "VALIDATION_FAILED",
        message: 'An AI provider must declare the "text" capability.',
        details: { providerId: provider.id },
      });
    }

    if (this.providers.has(provider.id)) {
      throw new AppError({
        code: "CONFLICT",
        message: `AI provider "${provider.id}" is already registered.`,
      });
    }

    this.providers.set(provider.id, provider);
  }

  get(providerId: string): AiProvider | undefined {
    return this.providers.get(providerId);
  }

  list(): readonly AiProvider[] {
    return [...this.providers.values()];
  }

  /**
   * Resolves a provider unambiguously.
   * - explicit id → that provider, or AI_NOT_CONFIGURED
   * - none + 0 registered → AI_NOT_CONFIGURED
   * - none + 1 registered → that provider
   * - none + >1 registered → AI_PROVIDER_REQUIRED
   */
  require(providerId?: string): AiProvider {
    if (providerId !== undefined) {
      const provider = this.providers.get(providerId);
      if (!provider) {
        throw new AiProviderNotConfiguredError(
          `AI provider "${providerId}" is not registered in this environment.`,
        );
      }
      return provider;
    }

    const providers = this.list();
    const first = providers[0];

    if (!first) {
      throw new AiProviderNotConfiguredError();
    }

    if (providers.length > 1) {
      throw new AiProviderRequiredError();
    }

    return first;
  }
}

/** Application-wide registry. Empty until a provider adapter is added. */
export const aiProviderRegistry = new AiProviderRegistry();
