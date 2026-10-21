import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

import { logger } from "@/lib/logger";
import { toPublicError } from "@/lib/errors";

/**
 * Shared route-handler plumbing: one response envelope, one error projection.
 * Internal details and causes never reach the client.
 */

export const NO_STORE = { "Cache-Control": "no-store" } as const;

export function apiSuccess<T>(data: T, status = 200): NextResponse {
  return NextResponse.json({ data }, { status, headers: NO_STORE });
}

export function apiFailure(error: unknown): NextResponse {
  const publicError = toPublicError(error);

  if (publicError.httpStatus >= 500) {
    // Log identifiers only: driver messages can echo query values (PII).
    const driverCode =
      error && typeof error === "object" && "code" in error
        ? String((error as { code?: unknown }).code)
        : undefined;

    logger.error(
      {
        code: publicError.code,
        errorName: error instanceof Error ? error.name : "Unknown",
        driverCode,
      },
      "request failed",
    );
  }

  return NextResponse.json(
    { error: { code: publicError.code, message: publicError.message } },
    { status: publicError.httpStatus, headers: NO_STORE },
  );
}

export function withApi<Context = unknown>(
  handler: (request: NextRequest, context: Context) => Promise<NextResponse>,
): (request: NextRequest, context: Context) => Promise<NextResponse> {
  return async (request, context) => {
    try {
      return await handler(request, context);
    } catch (error) {
      return apiFailure(error);
    }
  };
}
