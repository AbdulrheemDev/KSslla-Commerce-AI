import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";

/**
 * Protocol-level mock of the Salla endpoints used by Phases 03–04.
 *
 * Tests never contact Salla. The mock implements the documented behaviour that
 * matters here: form-urlencoded token requests, `invalid_grant` on a spent or
 * unknown grant, refresh-token rotation with reuse detection, the `user/info`
 * payload, and paginated catalogue listings with documented envelope shape.
 */

export interface MockToken {
  accessToken: string;
  refreshToken: string | null;
  expiresIn: number;
  tokenType: string;
  scope: string;
}

export interface MockProduct {
  id: number | string;
  name: string;
  sku?: string | null;
  type?: string;
  status: string;
  description?: string;
  price?: { amount: number | string; currency: string };
  regular_price?: { amount: number | string; currency: string };
  sale_price?: Record<string, never>;
  quantity?: number | string;
  is_available?: boolean;
  updated_at?: string;
  categories?: Array<{ id: number | string }>;
  main_image?: string;
}

export interface MockCategory {
  id: number | string;
  name: string;
  parent_id?: number | string;
  status: string;
  sort_order?: number;
  update_at?: string;
}

export interface MockOrder {
  id: number | string;
  external_reference_id?: string | number | null;
  reference_id?: string | number | null;
  total?: { amount: number | string; currency: string };
  date?: { date: string; timezone_type: number; timezone: string };
  source?: string;
  status?: { id: number | string; name: string; slug: string };
  draft?: boolean;
  payment_method?: string;
  is_pending_payment?: boolean;
  items?: Array<{ name: string; quantity: number | string; thumbnail: string | null }>;
  customer?: MockCustomer;
}

export interface MockCustomer {
  id: number | string;
  first_name?: string | null;
  last_name?: string | null;
  mobile?: { number: number | string; mobile_code?: string } | string | number | null;
  mobile_code?: string | null;
  email?: string | null;
  gender?: string | null;
  birthday?: { date: string; timezone_type?: number; timezone?: string } | null;
  city?: string | null;
  country?: string | null;
  country_code?: string | null;
  currency?: string | null;
  lang?: string | null;
  type?: string | null;
  created_at?: { date: string } | string | null;
  updated_at?: { date: string } | string;
  groups?: unknown[];
}

export interface MockQuantity {
  id: number | string;
  name: string;
  image?: string | null;
  sku_id?: number | string | null;
  sku?: string | null;
  quantity: number | string;
  sold_quantity: number | string;
  price: number | string;
  unlimited_quantity: boolean;
  variant?: string | null;
}

export interface MockSallaBehaviour {
  /** Reject the next authorization_code exchange with this error code. */
  authorizationCodeError?: string | null;
  /** Respond to token requests with a transport failure. */
  failTokenRequests?: boolean;
  /** Reject user-info calls. */
  failUserInfo?: boolean;
  /** HTTP status returned for catalogue requests, if set. */
  catalogStatus?: number | null;
  /** Number of catalogue requests that fail with `catalogStatus` before succeeding. */
  catalogFailuresRemaining?: number;
  /** Status used for the first `catalogFailuresRemaining` requests. */
  catalogFailureStatus?: number | null;
  /** Value of the Retry-After header sent with a failing catalogue request. */
  catalogRetryAfter?: number | null;
  /** Return a body that does not match the documented envelope. */
  catalogMalformed?: boolean;
  /** Return page 1 data for every requested page. */
  catalogRepeatPage?: boolean;
  /** Delay before answering a catalogue request (lets concurrency tests overlap). */
  catalogDelayMs?: number;
  /** Reject every refresh_token grant with invalid_grant. */
  rejectRefresh?: boolean;
  /** Fail catalogue requests from this 1-based request number onward. */
  catalogFailFrom?: number | null;
  /** HTTP status returned for orders/customers/quantities, if set. */
  dataStatus?: number | null;
  /** Number of data requests that fail with `dataFailureStatus` before succeeding. */
  dataFailuresRemaining?: number;
  /** Status used for the first `dataFailuresRemaining` requests (default 500). */
  dataFailureStatus?: number | null;
  /** Value of the Retry-After header sent with a failing data request. */
  dataRetryAfter?: number | null;
  /** Return a body that does not match the documented envelope. */
  dataMalformed?: boolean;
  /** Return page 1 data for every requested orders page. */
  ordersRepeatPage?: boolean;
  /** Disable the documented sequential-read guard (for negative tests only). */
  ordersAllowOutOfOrder?: boolean;
}

export interface RecordedRequest {
  method: string;
  path: string;
  form: Record<string, string>;
  query: Record<string, string>;
}

export class MockSallaServer {
  private server: Server | null = null;
  private nextId = 1;

  readonly requests: RecordedRequest[] = [];
  readonly behaviour: MockSallaBehaviour = {};

  /** Refresh tokens already spent, for reuse detection. */
  private readonly spentRefreshTokens = new Set<string>();
  /** Tokens Salla has revoked independently of this process. */
  readonly revokedRefreshTokens = new Set<string>();
  readonly validAccessTokens = new Set<string>();

  private catalogRequestSeq = 0;
  private dataRequestSeq = 0;

  products: MockProduct[] = [];
  categories: MockCategory[] = [];
  productPageSize = 30;

  orders: MockOrder[] = [];
  customers: MockCustomer[] = [];
  quantities: MockQuantity[] = [];
  /** Documented default page sizes: 15 for customers/quantities, 30 for orders. */
  orderPageSize = 30;
  customerPageSize = 30;
  quantityPageSize = 30;
  /** The last orders page served, so an out-of-sequence read can return empty. */
  lastOrdersPage = 0;

  merchantId = "847769313";
  userId = "1689171978";
  merchantName = "متجر تجريبي";
  scope = "offline_access products.read categories.read orders.read customers.read";

  get url(): string {
    return this.baseUrl;
  }

  private baseUrl = "";

  async start(): Promise<void> {
    this.server = createServer((req, res) => {
      const chunks: Buffer[] = [];
      req.on("data", (chunk: Buffer) => chunks.push(chunk));
      req.on("end", () => {
        const raw = Buffer.concat(chunks).toString("utf8");
        const parsed = new URL(req.url ?? "/", "http://localhost");
        const path = parsed.pathname;
        const form = Object.fromEntries(new URLSearchParams(raw).entries());
        const query = Object.fromEntries(parsed.searchParams.entries());

        this.requests.push({ method: req.method ?? "GET", path, form, query });

        const send = (status: number, body: unknown, headers: Record<string, string> = {}) => {
          res.writeHead(status, { "content-type": "application/json", ...headers });
          res.end(JSON.stringify(body));
        };

        if (path === "/oauth2/token") {
          if (this.behaviour.failTokenRequests) {
            req.socket.destroy();
            return;
          }
          this.handleToken(form, send);
          return;
        }

        if (path === "/oauth2/user/info") {
          if (this.behaviour.failUserInfo) {
            send(500, { error: "server_error" });
            return;
          }
          if (!this.accessTokenFrom(req)) {
            send(401, { error: "unauthenticated" });
            return;
          }
          send(200, {
            status: 200,
            success: true,
            data: {
              id: Number(this.userId),
              name: "Test User",
              email: "test@example.com",
              role: "user",
              merchant: {
                id: Number(this.merchantId),
                username: "demo_user",
                name: this.merchantName,
                domain: "https://demo.salla.sa",
                status: "active",
                plan: "pro",
              },
            },
          });
          return;
        }

        if (
          path === "/admin/v2/orders" ||
          path === "/admin/v2/customers" ||
          path === "/admin/v2/products/quantities"
        ) {
          this.handleDataList(req, query, path, send);
          return;
        }

        if (path === "/admin/v2/products" || path === "/admin/v2/categories") {
          const answer = () => this.handleCatalog(req, query, path.endsWith("products"), send);
          if (this.behaviour.catalogDelayMs && this.behaviour.catalogDelayMs > 0) {
            setTimeout(answer, this.behaviour.catalogDelayMs);
          } else {
            answer();
          }
          return;
        }

        send(404, { error: "not_found" });
      });
    });

    await new Promise<void>((resolve) => {
      this.server!.listen(0, "127.0.0.1", () => resolve());
    });

    const address = this.server.address() as AddressInfo;
    this.baseUrl = `http://127.0.0.1:${address.port}`;
  }

  async stop(): Promise<void> {
    if (!this.server) return;
    await new Promise<void>((resolve) => this.server!.close(() => resolve()));
    this.server = null;
  }

  reset(): void {
    this.requests.length = 0;
    this.spentRefreshTokens.clear();
    this.revokedRefreshTokens.clear();
    this.validAccessTokens.clear();
    this.behaviour.authorizationCodeError = null;
    this.behaviour.failTokenRequests = false;
    this.behaviour.failUserInfo = false;
    this.behaviour.catalogStatus = null;
    this.behaviour.catalogFailureStatus = null;
    this.behaviour.catalogFailuresRemaining = 0;
    this.behaviour.catalogRetryAfter = null;
    this.behaviour.catalogMalformed = false;
    this.behaviour.catalogRepeatPage = false;
    this.behaviour.catalogDelayMs = 0;
    this.behaviour.rejectRefresh = false;
    this.behaviour.catalogFailFrom = null;
    this.catalogRequestSeq = 0;
    this.behaviour.dataStatus = null;
    this.behaviour.dataFailuresRemaining = 0;
    this.behaviour.dataFailureStatus = null;
    this.behaviour.dataRetryAfter = null;
    this.behaviour.dataMalformed = false;
    this.behaviour.ordersRepeatPage = false;
    this.behaviour.ordersAllowOutOfOrder = false;
    this.dataRequestSeq = 0;
    this.lastOrdersPage = 0;
    this.orders = [];
    this.customers = [];
    this.quantities = [];
    this.merchantId = "847769313";
    this.userId = "1689171978";
    this.merchantName = "متجر تجريبي";
    this.products = [];
    this.categories = [];
  }

  invalidateAccessTokens(): void {
    this.validAccessTokens.clear();
  }

  private accessTokenFrom(req: { headers: { authorization?: string } }): string | null {
    const header = req.headers.authorization ?? "";
    const token = header.replace(/^Bearer\s+/i, "");
    if (!token || !this.validAccessTokens.has(token)) return null;
    return token;
  }

  /**
   * Documented list behaviour for orders/customers/quantities.
   *
   * Orders are **sequential only**: asking for a page other than the next one
   * returns an empty `data` array with the real pagination block, exactly as
   * the docs describe. Customers and quantities have no such rule.
   */
  private handleDataList(
    req: { headers: { authorization?: string } },
    query: Record<string, string>,
    path: string,
    send: (status: number, body: unknown, headers?: Record<string, string>) => void,
  ): void {
    if (!this.accessTokenFrom(req)) {
      send(401, {
        status: 401,
        success: false,
        error: { code: "Unauthorized", message: "The access token is invalid" },
      });
      return;
    }

    this.dataRequestSeq += 1;

    const fail = (status: number) => {
      const headers: Record<string, string> =
        this.behaviour.dataRetryAfter !== null && this.behaviour.dataRetryAfter !== undefined
          ? { "retry-after": String(this.behaviour.dataRetryAfter) }
          : {};
      send(
        status,
        { status, success: false, error: { code: "error", message: "forced" } },
        headers,
      );
    };

    if (this.behaviour.dataFailuresRemaining && this.behaviour.dataFailuresRemaining > 0) {
      this.behaviour.dataFailuresRemaining -= 1;
      fail(this.behaviour.dataFailureStatus ?? this.behaviour.dataStatus ?? 500);
      return;
    }

    if (this.behaviour.dataStatus) {
      fail(this.behaviour.dataStatus);
      return;
    }

    if (this.behaviour.dataMalformed) {
      send(200, { status: 200, success: true, data: "not-an-array" });
      return;
    }

    const isOrders = path === "/admin/v2/orders";
    const isCustomers = path === "/admin/v2/customers";
    const source: unknown[] = isOrders
      ? this.orders
      : isCustomers
        ? this.customers
        : this.quantities;
    const defaultSize = isOrders
      ? this.orderPageSize
      : isCustomers
        ? this.customerPageSize
        : this.quantityPageSize;

    const page = Math.max(1, Number(query.page ?? "1") || 1);
    const perPage = Math.min(60, Math.max(1, Number(query.per_page ?? defaultSize) || defaultSize));
    const totalPages = Math.max(1, Math.ceil(source.length / perPage));

    const envelope = (data: unknown[], currentPage: number) => ({
      status: 200,
      success: true,
      data,
      pagination: {
        count: data.length,
        total: source.length,
        perPage,
        currentPage,
        totalPages,
        links: { next: null, previous: null },
      },
    });

    if (isOrders && !this.behaviour.ordersAllowOutOfOrder) {
      // Page 1 starts a new pagination pass (the documented 15-minute window);
      // anything after it must be the immediate next page.
      if (page !== 1 && page !== this.lastOrdersPage + 1) {
        // Documented: an out-of-sequence request returns an empty response.
        send(200, envelope([], page));
        return;
      }
      this.lastOrdersPage = page;
    }

    const effectivePage = isOrders && this.behaviour.ordersRepeatPage ? 1 : page;
    const slice = source.slice((effectivePage - 1) * perPage, effectivePage * perPage);
    send(200, envelope(slice, page));
  }

  private handleCatalog(
    req: { headers: { authorization?: string } },
    query: Record<string, string>,
    isProducts: boolean,
    send: (status: number, body: unknown, headers?: Record<string, string>) => void,
  ): void {
    if (!this.accessTokenFrom(req)) {
      send(401, {
        status: 401,
        success: false,
        error: { code: "Unauthorized", message: "The access token is invalid" },
      });
      return;
    }

    this.catalogRequestSeq += 1;

    const fail = (status: number) => {
      const headers: Record<string, string> =
        this.behaviour.catalogRetryAfter !== null && this.behaviour.catalogRetryAfter !== undefined
          ? { "retry-after": String(this.behaviour.catalogRetryAfter) }
          : {};
      send(
        status,
        { status, success: false, error: { code: "error", message: "forced" } },
        headers,
      );
    };

    if (this.behaviour.catalogFailFrom !== null && this.behaviour.catalogFailFrom !== undefined) {
      if (this.catalogRequestSeq >= this.behaviour.catalogFailFrom) {
        fail(this.behaviour.catalogStatus ?? 500);
        return;
      }
    } else if (
      this.behaviour.catalogFailuresRemaining &&
      this.behaviour.catalogFailuresRemaining > 0
    ) {
      this.behaviour.catalogFailuresRemaining -= 1;
      fail(this.behaviour.catalogFailureStatus ?? this.behaviour.catalogStatus ?? 500);
      return;
    } else if (this.behaviour.catalogStatus) {
      fail(this.behaviour.catalogStatus);
      return;
    }

    if (this.behaviour.catalogMalformed) {
      send(200, { status: 200, success: true, data: "not-an-array" });
      return;
    }

    const page = Math.max(1, Number(query.page ?? "1") || 1);
    const perPage = Math.min(60, Math.max(1, Number(query.per_page ?? this.productPageSize) || 30));
    const source = isProducts ? this.products : this.categories;
    const totalPages = Math.max(1, Math.ceil(source.length / perPage));
    const effectivePage = this.behaviour.catalogRepeatPage ? 1 : page;
    const slice = source.slice((effectivePage - 1) * perPage, effectivePage * perPage);

    send(200, {
      status: 200,
      success: true,
      data: slice,
      pagination: {
        count: slice.length,
        total: source.length,
        perPage,
        currentPage: page,
        totalPages,
        links: [],
      },
    });
  }

  private issueToken(refreshToken: string | null): MockToken {
    const id = this.nextId++;
    const accessToken = `mock-access-${id}`;
    const token: MockToken = {
      accessToken,
      refreshToken,
      expiresIn: 1209600,
      tokenType: "bearer",
      scope: this.scope,
    };
    this.validAccessTokens.add(accessToken);
    return token;
  }

  private handleToken(form: Record<string, string>, send: (status: number, body: unknown) => void) {
    const grant = form.grant_type;

    if (!form.client_id || !form.client_secret) {
      send(401, { error: "invalid_client" });
      return;
    }

    if (this.revokeAllAccessTokensPending) {
      this.validAccessTokens.clear();
      this.revokeAllAccessTokensPending = false;
    }

    if (grant === "authorization_code") {
      if (this.behaviour.authorizationCodeError) {
        send(400, {
          error: this.behaviour.authorizationCodeError,
          error_description: "The provided authorization grant is invalid.",
        });
        return;
      }

      const token = this.issueToken(`mock-refresh-${this.nextId++}`);
      send(200, {
        access_token: token.accessToken,
        refresh_token: token.refreshToken,
        expires_in: token.expiresIn,
        token_type: token.tokenType,
        scope: token.scope,
      });
      return;
    }

    if (grant === "refresh_token") {
      const presented = form.refresh_token ?? "";

      if (this.behaviour.rejectRefresh) {
        send(401, {
          error: "invalid_grant",
          error_description: "The provided authorization grant is invalid, expired, or revoked.",
        });
        return;
      }

      if (
        !presented ||
        this.spentRefreshTokens.has(presented) ||
        this.revokedRefreshTokens.has(presented)
      ) {
        // Documented behaviour: reusing a refresh token invalidates the grant
        // and every access token obtained with it.
        this.revokeAllAccessTokensPending = true;
        send(401, {
          error: "invalid_grant",
          error_description: "The provided authorization grant is invalid, expired, or revoked.",
        });
        return;
      }

      this.spentRefreshTokens.add(presented);
      const token = this.issueToken(`mock-refresh-${this.nextId++}`);
      send(200, {
        access_token: token.accessToken,
        refresh_token: token.refreshToken,
        expires_in: token.expiresIn,
        token_type: token.tokenType,
        scope: token.scope,
      });
      return;
    }

    send(400, { error: "unsupported_grant_type" });
  }

  private revokeAllAccessTokensPending = false;

  /** Number of token-endpoint calls observed. */
  tokenRequestCount(): number {
    return this.requests.filter((request) => request.path === "/oauth2/token").length;
  }

  refreshRequestCount(): number {
    return this.requests.filter(
      (request) => request.path === "/oauth2/token" && request.form.grant_type === "refresh_token",
    ).length;
  }

  catalogRequestCount(resource: "products" | "categories"): number {
    return this.requests.filter((request) => request.path.endsWith(`/admin/v2/${resource}`)).length;
  }

  cataloguePages(resource: "products" | "categories"): number[] {
    return this.requests
      .filter((request) => request.path.endsWith(`/admin/v2/${resource}`))
      .map((request) => Number(request.query.page ?? "1"));
  }
}
