import { getDb } from "@/db/client";
import { logoutSession } from "@/modules/identity/application/auth-service";
import { apiSuccess, withApi } from "@/server/api";
import { assertCsrf } from "@/server/csrf";
import { requestMeta } from "@/server/request-meta";
import { clearSessionCookie, readSessionToken } from "@/server/session";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export const POST = withApi(async (request) => {
  assertCsrf(request);

  const token = readSessionToken(request);
  if (token) {
    await logoutSession(getDb(), token, requestMeta(request));
  }

  const response = apiSuccess({ signedOut: true });
  clearSessionCookie(response);
  return response;
});
