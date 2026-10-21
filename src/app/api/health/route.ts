import { NextResponse } from "next/server";

import { PRODUCT } from "@/config/product";
import { getSafeEnvSummary } from "@/lib/env";
import { toPublicError } from "@/lib/errors";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * Liveness/readiness probe.
 *
 * Reports configuration presence only — never values. A "not_configured"
 * integration is expected in Phase 01 and is not a failure.
 */
const NO_STORE = { "Cache-Control": "no-store" } as const;

export function GET() {
  const timestamp = new Date().toISOString();

  try {
    const env = getSafeEnvSummary();

    return NextResponse.json(
      {
        status: "ok",
        service: PRODUCT.name,
        version: PRODUCT.version,
        phase: PRODUCT.phase.number,
        environment: env.environment,
        integrations: env.integrations,
        timestamp,
      },
      { headers: NO_STORE },
    );
  } catch (error) {
    // Misconfiguration is a service availability issue, not a runtime crash.
    // Expose only the safe error code/message.
    const publicError = toPublicError(error);

    return NextResponse.json(
      {
        status: "error",
        code: publicError.code,
        message: publicError.message,
        timestamp,
      },
      { status: 503, headers: NO_STORE },
    );
  }
}
