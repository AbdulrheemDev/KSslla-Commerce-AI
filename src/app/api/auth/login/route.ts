import { getDb } from "@/db/client";
import { loginWithPassword } from "@/modules/identity/application/auth-service";
import { normalizeEmail } from "@/modules/identity/domain/identifiers";
import { hashToken } from "@/modules/identity/domain/tokens";
import { getAuthSecret } from "@/modules/identity/infrastructure/auth-secret";
import { apiSuccess, withApi } from "@/server/api";
import { assertCsrf } from "@/server/csrf";
import { clientKey, requestMeta } from "@/server/request-meta";
import { RATE_LIMITS, enforceRateLimit } from "@/server/rate-limit";
import { loginSchema } from "@/server/schemas";
import { parseJson } from "@/server/validation";
import { setSessionCookie } from "@/server/session";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export const POST = withApi(async (request) => {
  assertCsrf(request);

  const input = await parseJson(request, loginSchema);
  const accountKey = hashToken(`email:${normalizeEmail(input.email)}`, getAuthSecret()).slice(
    0,
    32,
  );

  enforceRateLimit(
    "login:ip",
    clientKey(request),
    RATE_LIMITS.loginPerIp.limit,
    RATE_LIMITS.loginPerIp.windowMs,
  );
  enforceRateLimit(
    "login:account",
    accountKey,
    RATE_LIMITS.loginPerAccount.limit,
    RATE_LIMITS.loginPerAccount.windowMs,
  );

  const meta = requestMeta(request);
  const result = await loginWithPassword(getDb(), input, meta);

  const response = apiSuccess({
    user: { id: result.user.id, email: result.user.email, name: result.user.name },
    organizationId: result.organizationId,
  });

  setSessionCookie(response, result.token, result.expiresAt);

  return response;
});
