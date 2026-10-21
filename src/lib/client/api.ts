"use client";

/**
 * Browser API helper.
 *
 * Every mutation sends the double-submit CSRF token. A stale token (for example
 * after a server restart) is refreshed once and the request retried.
 */

let cachedToken: string | null = null;
let inflight: Promise<string> | null = null;

async function fetchCsrfToken(force = false): Promise<string> {
  if (!force && cachedToken) return cachedToken;
  if (!force && inflight) return inflight;

  inflight = (async () => {
    const response = await fetch("/api/auth/csrf", {
      credentials: "same-origin",
      cache: "no-store",
    });

    if (!response.ok) {
      throw new Error("تعذّر تهيئة الطلب. أعد تحميل الصفحة.");
    }

    const payload = (await response.json()) as { data?: { csrfToken?: string } };
    const token = payload.data?.csrfToken;
    if (!token) throw new Error("تعذّر تهيئة الطلب. أعد تحميل الصفحة.");

    cachedToken = token;
    return token;
  })().finally(() => {
    inflight = null;
  });

  return inflight;
}

export interface ApiError extends Error {
  status: number;
  code?: string;
}

interface RequestOptions {
  method?: "GET" | "POST" | "PATCH" | "DELETE";
  body?: unknown;
}

export async function apiRequest<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const method = options.method ?? "GET";

  const send = async (token: string | null) => {
    const headers: Record<string, string> = {};
    if (options.body !== undefined) headers["content-type"] = "application/json";
    if (method !== "GET" && token) headers["x-csrf-token"] = token;

    return fetch(path, {
      method,
      credentials: "same-origin",
      cache: "no-store",
      headers,
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
    });
  };

  let token = method === "GET" ? null : await fetchCsrfToken();
  let response = await send(token);

  if (response.status === 403 && method !== "GET") {
    token = await fetchCsrfToken(true);
    response = await send(token);
  }

  const payload = (await response.json().catch(() => ({}))) as {
    data?: T;
    error?: { code?: string; message?: string };
  };

  if (!response.ok) {
    const error = new Error(payload.error?.message ?? "تعذّر إكمال الطلب.") as ApiError;
    error.status = response.status;
    error.code = payload.error?.code;
    throw error;
  }

  return payload.data as T;
}
