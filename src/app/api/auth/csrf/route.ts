import { NextResponse } from "next/server";

import { generateOpaqueToken } from "@/modules/identity/domain/tokens";
import { NO_STORE } from "@/server/api";
import { setCsrfCookie } from "@/server/csrf";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * Issues a double-submit CSRF token. The cookie is readable by scripts by
 * design; the session cookie remains HttpOnly.
 */
export async function GET() {
  const token = generateOpaqueToken(32);

  const response = new NextResponse(JSON.stringify({ data: { csrfToken: token } }), {
    status: 200,
    headers: { ...NO_STORE, "content-type": "application/json" },
  });

  setCsrfCookie(response, token);

  return response;
}
