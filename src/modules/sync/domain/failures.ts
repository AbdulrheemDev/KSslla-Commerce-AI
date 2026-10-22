import { AppError, isAppError, type AppErrorCode } from "@/lib/errors";
import { isSallaError } from "@/modules/integrations/salla/domain/errors";
import type { FailureKind } from "@/modules/catalog/domain/retry";

/**
 * Provider failure classification — one implementation for every read sync.
 *
 * The catalogue sync (Phase 04) and the orders/customers/inventory syncs
 * (Phase 05) share this module, so 401/403/404/422/429/500/503 always mean the
 * same thing and are retried (or not) the same way. See
 * docs/salla-reference.md §11 for the documented status codes.
 *
 * Nothing here exposes a provider message to a caller: only a stable code.
 */

export interface ClassifiedFailure {
  kind: FailureKind;
  retryAfterSeconds?: number;
}

export function classifyProviderFailure(error: unknown): ClassifiedFailure | null {
  if (!isSallaError(error)) return null;

  switch (error.sallaKind) {
    case "network":
      return { kind: "network" };
    case "rate_limited":
      return {
        kind: "rate_limited",
        retryAfterSeconds:
          typeof error.details?.retryAfterSeconds === "number"
            ? error.details.retryAfterSeconds
            : undefined,
      };
    case "invalid_response":
      return { kind: "schema" };
    case "api": {
      const status = Number(error.details?.providerStatus ?? 0);
      if (status === 401) return { kind: "auth" };
      if (status >= 500) return { kind: "server" };
      return { kind: "client" };
    }
    default:
      return null;
  }
}

/**
 * Stable failure code stored on the run and returned to the UI.
 *
 * The mapping is the same for every resource so the sync-state card never has
 * to learn a per-endpoint vocabulary.
 */
export function providerFailureCode(error: unknown): string {
  if (!isSallaError(error)) {
    return isAppError(error) ? error.code.toLowerCase() : "internal_error";
  }

  switch (error.sallaKind) {
    case "network":
      return "network_error";
    case "rate_limited":
      return "rate_limited";
    case "invalid_response":
      return "invalid_response";
    case "invalid_grant":
      return "reauth_required";
    case "not_configured":
      return "not_configured";
    case "api": {
      const status = Number(error.details?.providerStatus ?? 0);
      if (status === 401) return "unauthorized";
      if (status === 403) return "forbidden";
      if (status === 404) return "not_found";
      if (status === 422) return "validation_failed";
      if (status === 429) return "rate_limited";
      return status >= 500 ? "provider_error" : "provider_rejected";
    }
    default:
      return "salla_error";
  }
}

/**
 * Failures that must stop the whole resource instead of skipping one record.
 *
 * Auth failures, revoked tokens, contract changes, transport failures, rate
 * limiting, and 5xx are system-level: retrying them record by record would
 * either hammer the provider or hide a broken integration. Everything else
 * (a 404/422 for one object, a product that does not exist locally) is
 * partial: the record is logged and the run continues.
 */
export function isSystemLevelFailure(error: unknown): boolean {
  if (isAppError(error) && !isSallaError(error)) {
    // Tenant mismatch, permission, transaction and lease errors.
    return true;
  }

  const classified = classifyProviderFailure(error);
  if (!classified) return true;

  return (
    classified.kind === "auth" ||
    classified.kind === "network" ||
    classified.kind === "schema" ||
    classified.kind === "rate_limited" ||
    classified.kind === "server"
  );
}

/** Provider status → the only message a user is ever shown. */
export const PROVIDER_STATUS_MESSAGES: Record<number, string> = {
  401: "انتهت صلاحية الاتصال بـ Salla. أعد ربط المتجر.",
  403: "لا يملك هذا الاتصال صلاحية الوصول إلى البيانات المطلوبة.",
  404: "تعذر العثور على المورد المطلوب في Salla.",
  422: "رفضت Salla الطلب لعدم صحة البيانات المرسلة.",
  429: "تم تجاوز حد الطلبات المسموح به في Salla. أعد المحاولة لاحقًا.",
  500: "حدث خطأ في Salla أثناء تنفيذ الطلب.",
  503: "خدمة Salla غير متاحة مؤقتًا. أعد المحاولة لاحقًا.",
};

export function providerStatusMessage(status: number): string {
  return PROVIDER_STATUS_MESSAGES[status] ?? "تعذر إكمال الطلب مع Salla.";
}

/**
 * Failure code → the app error taxonomy (src/lib/errors.ts).
 *
 * The taxonomy is closed on purpose, so provider failures collapse onto the
 * existing codes rather than adding one per endpoint.
 */
const CODE_MAP: Record<string, AppErrorCode> = {
  unauthorized: "INTEGRATION_AUTH_REQUIRED",
  reauth_required: "INTEGRATION_AUTH_REQUIRED",
  forbidden: "INTEGRATION_AUTH_REQUIRED",
  rate_limited: "RATE_LIMITED",
  not_configured: "INTEGRATION_NOT_CONFIGURED",
};

/** Normalises any thrown value into a stable, non-leaking app error. */
export function normalizeProviderError(error: unknown): AppError {
  if (isAppError(error)) return error;

  const code = providerFailureCode(error);
  return new AppError({
    code: CODE_MAP[code] ?? "INTEGRATION_ERROR",
    message: "تعذر إكمال مزامنة البيانات مع Salla.",
    retryable: code === "rate_limited" || code === "provider_error" || code === "network_error",
  });
}
