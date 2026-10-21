import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";

/**
 * Protocol-level mock of the Salla OAuth endpoints.
 *
 * Tests never contact Salla. The mock implements the documented behaviour that
 * matters for Phase 03: form-urlencoded token requests, `invalid_grant` on a
 * spent or unknown grant, refresh-token rotation with reuse detection, and the
 * `user/info` payload shape.
 */

export interface MockToken {
  accessToken: string;
  refreshToken: string | null;
  expiresIn: number;
  tokenType: string;
  scope: string;
}

export interface MockSallaBehaviour {
  /** Reject the next authorization_code exchange with this error code. */
  authorizationCodeError?: string | null;
  /** Respond to token requests with a transport failure. */
  failTokenRequests?: boolean;
  /** Reject user-info calls. */
  failUserInfo?: boolean;
}

export interface RecordedRequest {
  method: string;
  path: string;
  form: Record<string, string>;
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

  merchantId = "847769313";
  userId = "1689171978";
  merchantName = "متجر تجريبي";
  scope = "offline_access";

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
        const path = new URL(req.url ?? "/", "http://localhost").pathname;
        const form = Object.fromEntries(new URLSearchParams(raw).entries());

        this.requests.push({ method: req.method ?? "GET", path, form });

        const send = (status: number, body: unknown) => {
          res.writeHead(status, { "content-type": "application/json" });
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
          const auth = req.headers.authorization ?? "";
          const token = auth.replace(/^Bearer\s+/i, "");
          if (!this.validAccessTokens.has(token)) {
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
    this.merchantId = "847769313";
    this.userId = "1689171978";
    this.merchantName = "متجر تجريبي";
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
}
