import {
  invalidResponseError,
  networkError,
  rateLimitError,
} from "@/modules/integrations/salla/domain/errors";

/**
 * Thin JSON transport for Salla.
 *
 * - Hard timeout on every call.
 * - No automatic retry. Token requests are single-use, so retrying them is a
 *   correctness risk, not a resilience measure. Callers decide explicitly.
 * - Error objects never carry the request body, headers, or response text.
 */

const DEFAULT_TIMEOUT_MS = 10_000;
const MAX_BODY_BYTES = 512 * 1024;

export interface JsonResponse {
  status: number;
  body: unknown;
  retryAfterSeconds?: number;
}

export interface JsonRequestInit {
  method: "GET" | "POST";
  headers?: Record<string, string>;
  body?: string;
  timeoutMs?: number;
}

function parseRetryAfter(value: string | null): number | undefined {
  if (!value) return undefined;
  const seconds = Number(value);
  return Number.isFinite(seconds) && seconds >= 0 ? Math.ceil(seconds) : undefined;
}

export async function requestJson(url: string, init: JsonRequestInit): Promise<JsonResponse> {
  let response: Response;

  try {
    response = await fetch(url, {
      method: init.method,
      headers: init.headers,
      body: init.body,
      redirect: "error",
      cache: "no-store",
      signal: AbortSignal.timeout(init.timeoutMs ?? DEFAULT_TIMEOUT_MS),
    });
  } catch (error) {
    // DNS, TLS, connection reset, timeout. Never include the URL (it has no
    // secret for the token endpoint, but the rule is uniform).
    throw networkError(error);
  }

  const text = await response.text().catch(() => "");

  if (text.length > MAX_BODY_BYTES) {
    throw invalidResponseError("body_size");
  }

  let body: unknown = null;
  if (text.length > 0) {
    try {
      body = JSON.parse(text);
    } catch {
      if (response.status >= 200 && response.status < 300) {
        throw invalidResponseError("json");
      }
      body = { error: "non_json_error_response" };
    }
  }

  if (response.status === 429) {
    throw rateLimitError(parseRetryAfter(response.headers.get("retry-after")));
  }

  return {
    status: response.status,
    body,
    retryAfterSeconds: parseRetryAfter(response.headers.get("retry-after")),
  };
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
