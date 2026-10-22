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

  products: MockProduct[] = [];
  categories: MockCategory[] = [];
  productPageSize = 30;

  merchantId = "847769313";
  userId = "1689171978";
  merchantName = "متجر تجريبي";
  scope = "offline_access products.read categories.read";

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
