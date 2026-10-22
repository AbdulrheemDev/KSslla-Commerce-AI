import { getDb } from "@/db/client";
import { registerAccount } from "@/modules/identity/application/auth-service";
import { apiSuccess, withApi } from "@/server/api";
import { assertCsrf } from "@/server/csrf";
import { clientKey, requestMeta } from "@/server/request-meta";
import { RATE_LIMITS, enforceRateLimit } from "@/server/rate-limit";
import { parseJson } from "@/server/validation";
import { registerSchema } from "@/server/schemas";
import { setSessionCookie } from "@/server/session";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export const POST = withApi(async (request) => {
  assertCsrf(request);
  enforceRateLimit(
    "register:ip",
    clientKey(request),
    RATE_LIMITS.registerPerIp.limit,
    RATE_LIMITS.registerPerIp.windowMs,
  );

  const input = await parseJson(request, registerSchema);
  const meta = requestMeta(request);
  const result = await registerAccount(getDb(), input, meta);

  const response = apiSuccess(
    {
      user: { id: result.user.id, email: result.user.email, name: result.user.name },
      organization: {
        id: result.organization.id,
        name: result.organization.name,
        slug: result.organization.slug,
      },
    },
    201,
  );

  setSessionCookie(response, result.token, result.expiresAt);

  return response;
});
