import { describe, expect, it } from "vitest";

import {
  classifyProviderFailure,
  isSystemLevelFailure,
  normalizeProviderError,
  providerFailureCode,
} from "@/modules/sync/domain/failures";
import {
  invalidGrantError,
  invalidResponseError,
  networkError,
  rateLimitError,
  sallaApiError,
} from "@/modules/integrations/salla/domain/errors";
import { AppError } from "@/lib/errors";

/**
 * Failure normalisation.
 *
 * One mapping for every resource: 401/403/404/422/429/500/503 must never mean
 * two different things, and no provider text may reach a caller.
 */

describe("provider failure codes", () => {
  it.each([
    [401, "unauthorized"],
    [403, "forbidden"],
    [404, "not_found"],
    [422, "validation_failed"],
    [429, "rate_limited"],
    [500, "provider_error"],
    [503, "provider_error"],
  ])("maps %i to %s", (status, expected) => {
    expect(providerFailureCode(sallaApiError(status))).toBe(expected);
  });

  it("maps transport, throttle, contract, and revocation failures", () => {
    expect(providerFailureCode(networkError())).toBe("network_error");
    expect(providerFailureCode(rateLimitError(30))).toBe("rate_limited");
    expect(providerFailureCode(invalidResponseError("orders.data"))).toBe("invalid_response");
    expect(providerFailureCode(invalidGrantError())).toBe("reauth_required");
  });

  it("classifies retryable versus permanent failures", () => {
    expect(classifyProviderFailure(networkError())?.kind).toBe("network");
    expect(classifyProviderFailure(rateLimitError(12))?.retryAfterSeconds).toBe(12);
    expect(classifyProviderFailure(sallaApiError(500))?.kind).toBe("server");
    expect(classifyProviderFailure(sallaApiError(401))?.kind).toBe("auth");
    expect(classifyProviderFailure(sallaApiError(422))?.kind).toBe("client");
  });
});

describe("system-level failures", () => {
  it("treats auth, network, contract, throttling, and 5xx as system-level", () => {
    for (const error of [
      sallaApiError(401),
      networkError(),
      invalidResponseError("orders.data"),
      rateLimitError(5),
      sallaApiError(503),
    ]) {
      expect(isSystemLevelFailure(error)).toBe(true);
    }
  });

  it("treats a single rejected record as partial", () => {
    expect(isSystemLevelFailure(sallaApiError(404))).toBe(false);
    expect(isSystemLevelFailure(sallaApiError(422))).toBe(false);
  });

  it("treats tenant and transaction errors as system-level", () => {
    expect(
      isSystemLevelFailure(new AppError({ code: "TENANT_ISOLATION_VIOLATION", message: "x" })),
    ).toBe(true);
  });
});

describe("normalisation to the app taxonomy", () => {
  it("collapses an unknown failure into a generic integration error", () => {
    const error = normalizeProviderError(new Error("SECRET-LOOKING-DETAIL"));
    expect(error.code).toBe("INTEGRATION_ERROR");
    expect(error.message).toBe("تعذر إكمال مزامنة البيانات مع Salla.");
    expect(error.message).not.toContain("SECRET");
  });

  it("keeps the Salla taxonomy when the failure already carries it", () => {
    // SallaIntegrationError is an AppError; re-wrapping it would lose the
    // reconnect signal the UI depends on.
    expect(normalizeProviderError(invalidGrantError()).code).toBe("INTEGRATION_AUTH_REQUIRED");
    expect(normalizeProviderError(rateLimitError(3)).code).toBe("RATE_LIMITED");
  });

  it("never trusts a non-error shape as a provider signal", () => {
    expect(normalizeProviderError({ providerStatus: 401 }).code).toBe("INTEGRATION_ERROR");
  });
});
