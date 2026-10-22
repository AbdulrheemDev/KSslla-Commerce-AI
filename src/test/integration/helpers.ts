import { NextRequest } from "next/server";
import type { NextResponse } from "next/server";

import { resetRateLimits } from "@/server/rate-limit";
import { CSRF_COOKIE_NAME, CSRF_HEADER_NAME } from "@/modules/identity/domain/session-policy";
import { resetDatabase } from "@/test/db/client";

export const BASE_URL = "http://localhost:3000";

export function resetState(): Promise<void> {
  resetRateLimits();
  return resetDatabase();
}

export interface JsonEnvelope<T> {
  data?: T;
  error?: { code: string; message: string };
}

/** Minimal cookie-aware HTTP client for direct route-handler invocation. */
export class ApiClient {
  readonly cookies = new Map<string, string>();

  private cookieHeader(): string | undefined {
    if (this.cookies.size === 0) return undefined;
    return [...this.cookies.entries()].map(([name, value]) => `${name}=${value}`).join("; ");
  }

  private capture(response: NextResponse): void {
    for (const cookie of response.cookies.getAll()) {
      if (cookie.value === "") {
        this.cookies.delete(cookie.name);
      } else {
        this.cookies.set(cookie.name, cookie.value);
      }
    }
  }

  private build(
    path: string,
    init: {
      method: string;
      body?: unknown;
      headers?: Record<string, string>;
    },
  ): NextRequest {
    const headers = new Headers({
      host: "localhost:3000",
      origin: BASE_URL,
      ...(init.headers ?? {}),
    });

    const cookie = this.cookieHeader();
    if (cookie) headers.set("cookie", cookie);
    if (init.body !== undefined) headers.set("content-type", "application/json");

    return new NextRequest(`${BASE_URL}${path}`, {
      method: init.method,
      headers,
      ...(init.body === undefined ? {} : { body: JSON.stringify(init.body) }),
    });
  }

  async ensureCsrf(): Promise<string> {
    const { GET } = await import("@/app/api/auth/csrf/route");
    const response = await GET();
    this.capture(response);
    const payload = (await response.json()) as JsonEnvelope<{ csrfToken: string }>;
    return payload.data?.csrfToken ?? "";
  }

  async request<T>(
    method: "GET" | "POST" | "PATCH" | "DELETE",
    path: string,
    options: {
      body?: unknown;
      headers?: Record<string, string>;
      params?: Record<string, string>;
    } = {},
  ): Promise<{ status: number; body: JsonEnvelope<T>; response: NextResponse }> {
    const headers: Record<string, string> = { ...(options.headers ?? {}) };

    if (method !== "GET") {
      const csrf = this.cookies.get(CSRF_COOKIE_NAME) ?? (await this.ensureCsrf());
      headers[CSRF_HEADER_NAME] = csrf;
    }

    const request = this.build(path, { method, body: options.body, headers });
    const { dispatch } = await loadHandler(method, path);

    const response = await dispatch(request, {
      params: Promise.resolve(routeParams(path, options.params)),
    });

    this.capture(response);
    const body = (await response.json()) as JsonEnvelope<T>;

    return { status: response.status, body, response };
  }

  get<T>(path: string, options?: { params?: Record<string, string> }) {
    return this.request<T>("GET", path, options);
  }

  /**
   * GET a non-JSON body (CSV exports). Kept separate from `request` so the
   * envelope-typed helper never has to guess a content type.
   */
  async getText(
    path: string,
    options: { params?: Record<string, string> } = {},
  ): Promise<{ status: number; text: string; headers: Headers; response: NextResponse }> {
    const request = this.build(path, { method: "GET" });
    const { dispatch } = await loadHandler("GET", path);

    const response = await dispatch(request, {
      params: Promise.resolve(routeParams(path, options.params)),
    });

    this.capture(response);

    return {
      status: response.status,
      text: await response.text(),
      headers: response.headers,
      response,
    };
  }

  post<T>(path: string, body?: unknown, headers?: Record<string, string>) {
    return this.request<T>("POST", path, { body, headers });
  }

  patch<T>(path: string, body?: unknown, params?: Record<string, string>) {
    return this.request<T>("PATCH", path, { body, params });
  }

  delete<T>(path: string, params?: Record<string, string>) {
    return this.request<T>("DELETE", path, { params });
  }
}

function routeParams(path: string, extra?: Record<string, string>): Record<string, string> {
  const membershipMatch = path.match(/\/members\/([^/]+)$/);
  const storeMatch = path.match(/\/stores\/([^/]+)/);
  const derived: Record<string, string> = membershipMatch
    ? { membershipId: membershipMatch[1]! }
    : storeMatch
      ? { storeId: storeMatch[1]! }
      : {};

  return { ...derived, ...(extra ?? {}) };
}

type Handler = (
  request: NextRequest,
  context: { params: Promise<Record<string, string>> },
) => Promise<NextResponse>;

async function loadHandler(
  method: "GET" | "POST" | "PATCH" | "DELETE",
  path: string,
): Promise<{ dispatch: Handler }> {
  // The query string belongs to the request, not to the route: `?period=30d`
  // must still resolve to `/…/overview`, exactly as the Next.js router does.
  const normalized = path.replace(/\?.*$/, "").replace(/\/$/, "");

  const table: Record<string, () => Promise<Record<string, unknown>>> = {
    "/api/auth/register": () => import("@/app/api/auth/register/route"),
    "/api/auth/login": () => import("@/app/api/auth/login/route"),
    "/api/auth/logout": () => import("@/app/api/auth/logout/route"),
    "/api/auth/session": () => import("@/app/api/auth/session/route"),
    "/api/organizations/current": () => import("@/app/api/organizations/current/route"),
    "/api/organizations/current/members": () =>
      import("@/app/api/organizations/current/members/route"),
    "/api/organizations/current/stores": () =>
      import("@/app/api/organizations/current/stores/route"),
    "/api/organizations/current/audit": () => import("@/app/api/organizations/current/audit/route"),
    "/api/invitations/accept": () => import("@/app/api/invitations/accept/route"),
    "/api/organizations/switch": () => import("@/app/api/organizations/switch/route"),
  };

  if (table[normalized]) {
    const handlers = (await table[normalized]()) as Record<string, unknown>;
    const dispatch = handlers[method] as Handler | undefined;
    if (!dispatch) throw new Error(`No ${method} handler for ${normalized}`);
    return { dispatch };
  }

  const membership = normalized.match(/^\/api\/organizations\/current\/members\/([^/]+)$/);
  if (membership) {
    const handlers =
      (await import("@/app/api/organizations/current/members/[membershipId]/route")) as Record<
        string,
        unknown
      >;
    const dispatch = handlers[method] as Handler | undefined;
    if (!dispatch) throw new Error(`No ${method} handler for ${normalized}`);
    return { dispatch };
  }

  const sallaAuthorize = normalized.match(
    /^\/api\/organizations\/current\/stores\/([^/]+)\/salla\/authorize$/,
  );
  if (sallaAuthorize) {
    const handlers =
      (await import("@/app/api/organizations/current/stores/[storeId]/salla/authorize/route")) as Record<
        string,
        unknown
      >;
    const dispatch = handlers[method] as Handler | undefined;
    if (!dispatch) throw new Error(`No ${method} handler for ${normalized}`);
    return { dispatch };
  }

  const sallaConnection = normalized.match(
    /^\/api\/organizations\/current\/stores\/([^/]+)\/salla\/connection$/,
  );
  if (sallaConnection) {
    const handlers =
      (await import("@/app/api/organizations/current/stores/[storeId]/salla/connection/route")) as Record<
        string,
        unknown
      >;
    const dispatch = handlers[method] as Handler | undefined;
    if (!dispatch) throw new Error(`No ${method} handler for ${normalized}`);
    return { dispatch };
  }

  const catalogSync = normalized.match(
    /^\/api\/organizations\/current\/stores\/([^/]+)\/catalog\/sync$/,
  );
  if (catalogSync) {
    const handlers =
      (await import("@/app/api/organizations/current/stores/[storeId]/catalog/sync/route")) as Record<
        string,
        unknown
      >;
    const dispatch = handlers[method] as Handler | undefined;
    if (!dispatch) throw new Error(`No ${method} handler for ${normalized}`);
    return { dispatch };
  }

  const catalogProducts = normalized.match(
    /^\/api\/organizations\/current\/stores\/([^/]+)\/catalog\/products$/,
  );
  if (catalogProducts) {
    const handlers =
      (await import("@/app/api/organizations/current/stores/[storeId]/catalog/products/route")) as Record<
        string,
        unknown
      >;
    const dispatch = handlers[method] as Handler | undefined;
    if (!dispatch) throw new Error(`No ${method} handler for ${normalized}`);
    return { dispatch };
  }

  const catalogCategories = normalized.match(
    /^\/api\/organizations\/current\/stores\/([^/]+)\/catalog\/categories$/,
  );
  if (catalogCategories) {
    const handlers =
      (await import("@/app/api/organizations/current/stores/[storeId]/catalog/categories/route")) as Record<
        string,
        unknown
      >;
    const dispatch = handlers[method] as Handler | undefined;
    if (!dispatch) throw new Error(`No ${method} handler for ${normalized}`);
    return { dispatch };
  }

  const dataSync = normalized.match(/^\/api\/organizations\/current\/stores\/([^/]+)\/data\/sync$/);
  if (dataSync) {
    const handlers =
      (await import("@/app/api/organizations/current/stores/[storeId]/data/sync/route")) as Record<
        string,
        unknown
      >;
    const dispatch = handlers[method] as Handler | undefined;
    if (!dispatch) throw new Error(`No ${method} handler for ${normalized}`);
    return { dispatch };
  }

  const dataResource = normalized.match(
    /^\/api\/organizations\/current\/stores\/([^/]+)\/data\/(orders|customers|inventory)$/,
  );
  if (dataResource) {
    const resource = dataResource[2]!;
    const handlers =
      resource === "orders"
        ? ((await import("@/app/api/organizations/current/stores/[storeId]/data/orders/route")) as Record<
            string,
            unknown
          >)
        : resource === "customers"
          ? ((await import("@/app/api/organizations/current/stores/[storeId]/data/customers/route")) as Record<
              string,
              unknown
            >)
          : ((await import("@/app/api/organizations/current/stores/[storeId]/data/inventory/route")) as Record<
              string,
              unknown
            >);
    const dispatch = handlers[method] as Handler | undefined;
    if (!dispatch) throw new Error(`No ${method} handler for ${normalized}`);
    return { dispatch };
  }

  const webhookReplay = normalized.match(
    /^\/api\/organizations\/current\/stores\/([^/]+)\/webhooks\/([^/]+)\/replay$/,
  );
  if (webhookReplay) {
    const handlers =
      (await import("@/app/api/organizations/current/stores/[storeId]/webhooks/[eventId]/replay/route")) as Record<
        string,
        unknown
      >;
    const dispatch = handlers[method] as Handler | undefined;
    if (!dispatch) throw new Error(`No ${method} handler for ${normalized}`);
    return { dispatch };
  }

  const webhookList = normalized.match(
    /^\/api\/organizations\/current\/stores\/([^/]+)\/webhooks$/,
  );
  if (webhookList) {
    const handlers =
      (await import("@/app/api/organizations/current/stores/[storeId]/webhooks/route")) as Record<
        string,
        unknown
      >;
    const dispatch = handlers[method] as Handler | undefined;
    if (!dispatch) throw new Error(`No ${method} handler for ${normalized}`);
    return { dispatch };
  }

  if (normalized === "/api/integrations/salla/callback") {
    const handlers = (await import("@/app/api/integrations/salla/callback/route")) as Record<
      string,
      unknown
    >;
    const dispatch = handlers[method] as Handler | undefined;
    if (!dispatch) throw new Error(`No ${method} handler for ${normalized}`);
    return { dispatch };
  }

  const intelligence = normalized.match(
    /^\/api\/organizations\/current\/stores\/([^/]+)\/intelligence\/(overview|products|categories|inventory|customers|opportunities)$/,
  );
  if (intelligence) {
    const endpoint = intelligence[2]!;
    const handlers = (await (endpoint === "overview"
      ? import("@/app/api/organizations/current/stores/[storeId]/intelligence/overview/route")
      : endpoint === "products"
        ? import("@/app/api/organizations/current/stores/[storeId]/intelligence/products/route")
        : endpoint === "categories"
          ? import("@/app/api/organizations/current/stores/[storeId]/intelligence/categories/route")
          : endpoint === "inventory"
            ? import("@/app/api/organizations/current/stores/[storeId]/intelligence/inventory/route")
            : endpoint === "customers"
              ? import("@/app/api/organizations/current/stores/[storeId]/intelligence/customers/route")
              : import("@/app/api/organizations/current/stores/[storeId]/intelligence/opportunities/route"))) as Record<
      string,
      unknown
    >;
    const dispatch = handlers[method] as Handler | undefined;
    if (!dispatch) throw new Error(`No ${method} handler for ${normalized}`);
    return { dispatch };
  }

  const salesIntelligence = normalized.match(
    /^\/api\/organizations\/current\/stores\/([^/]+)\/sales-intelligence\/(overview|trends|anomalies|discounts|export)$/,
  );
  if (salesIntelligence) {
    const endpoint = salesIntelligence[2]!;
    const loaders: Record<string, () => Promise<Record<string, unknown>>> = {
      overview: () =>
        import("@/app/api/organizations/current/stores/[storeId]/sales-intelligence/overview/route"),
      trends: () =>
        import("@/app/api/organizations/current/stores/[storeId]/sales-intelligence/trends/route"),
      anomalies: () =>
        import("@/app/api/organizations/current/stores/[storeId]/sales-intelligence/anomalies/route"),
      discounts: () =>
        import("@/app/api/organizations/current/stores/[storeId]/sales-intelligence/discounts/route"),
      export: () =>
        import("@/app/api/organizations/current/stores/[storeId]/sales-intelligence/export/route"),
    };

    const handlers = (await loaders[endpoint]!()) as Record<string, unknown>;
    const dispatch = handlers[method] as Handler | undefined;
    if (!dispatch) throw new Error(`No ${method} handler for ${normalized}`);
    return { dispatch };
  }

  const productIntelligence = normalized.match(
    /^\/api\/organizations\/current\/stores\/([^/]+)\/product-intelligence\/(overview|products|categories|issues|recommendations)$/,
  );
  if (productIntelligence) {
    const endpoint = productIntelligence[2]!;
    const loaders: Record<string, () => Promise<Record<string, unknown>>> = {
      overview: () =>
        import("@/app/api/organizations/current/stores/[storeId]/product-intelligence/overview/route"),
      products: () =>
        import("@/app/api/organizations/current/stores/[storeId]/product-intelligence/products/route"),
      categories: () =>
        import("@/app/api/organizations/current/stores/[storeId]/product-intelligence/categories/route"),
      issues: () =>
        import("@/app/api/organizations/current/stores/[storeId]/product-intelligence/issues/route"),
      recommendations: () =>
        import("@/app/api/organizations/current/stores/[storeId]/product-intelligence/recommendations/route"),
    };

    const handlers = (await loaders[endpoint]!()) as Record<string, unknown>;
    const dispatch = handlers[method] as Handler | undefined;
    if (!dispatch) throw new Error(`No ${method} handler for ${normalized}`);
    return { dispatch };
  }

  const store = normalized.match(/^\/api\/organizations\/current\/stores\/([^/]+)$/);
  if (store) {
    const handlers =
      (await import("@/app/api/organizations/current/stores/[storeId]/route")) as Record<
        string,
        unknown
      >;
    const dispatch = handlers[method] as Handler | undefined;
    if (!dispatch) throw new Error(`No ${method} handler for ${normalized}`);
    return { dispatch };
  }

  throw new Error(`Unknown route ${method} ${normalized}`);
}

export interface RegisteredUser {
  client: ApiClient;
  userId: string;
  organizationId: string;
  email: string;
  password: string;
}

export const DEFAULT_PASSWORD = "correct horse battery staple";

export async function registerViaApi(options: {
  email: string;
  name?: string;
  organizationName: string;
  password?: string;
  storeName?: string;
}): Promise<RegisteredUser> {
  const client = new ApiClient();
  await client.ensureCsrf();

  const password = options.password ?? DEFAULT_PASSWORD;
  const result = await client.post<{
    user: { id: string };
    organization: { id: string };
  }>("/api/auth/register", {
    email: options.email,
    password,
    name: options.name ?? "مالك تجريبي",
    organizationName: options.organizationName,
    ...(options.storeName ? { storeName: options.storeName } : {}),
  });

  if (result.status !== 201 || !result.body.data) {
    throw new Error(`registration failed: ${JSON.stringify(result.body)}`);
  }

  return {
    client,
    userId: result.body.data.user.id,
    organizationId: result.body.data.organization.id,
    email: options.email,
    password,
  };
}

export async function loginViaApi(
  email: string,
  password: string,
  client = new ApiClient(),
): Promise<{ client: ApiClient; status: number; body: JsonEnvelope<unknown> }> {
  await client.ensureCsrf();
  const result = await client.post("/api/auth/login", { email, password });
  return { client, status: result.status, body: result.body };
}

/**
 * Invokes the OAuth callback route with the client's session cookie and returns
 * the redirect target instead of a JSON body.
 */
export async function callbackViaApi(
  client: ApiClient,
  query: Record<string, string>,
): Promise<{ status: number; location: string | null }> {
  const { buildCallbackRequest } = await import("@/test/integration/salla-helpers");
  const { GET } = await import("@/app/api/integrations/salla/callback/route");

  const request = buildCallbackRequest(query, client.cookies);
  const response = await GET(request);

  for (const cookie of response.cookies.getAll()) {
    if (cookie.value === "") client.cookies.delete(cookie.name);
    else client.cookies.set(cookie.name, cookie.value);
  }

  return { status: response.status, location: response.headers.get("location") };
}
