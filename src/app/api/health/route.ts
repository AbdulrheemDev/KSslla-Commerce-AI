import { sql } from "drizzle-orm";
import { NextResponse } from "next/server";

import { PRODUCT } from "@/config/product";
import { getDb } from "@/db/client";
import { getSafeEnvSummary } from "@/lib/env";
import { toPublicError } from "@/lib/errors";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * Liveness/readiness probe.
 *
 * Reports configuration presence and a real database round-trip. Values are
 * never exposed, and Salla stays `not_configured` until Phase 03 is built.
 */
const NO_STORE = { "Cache-Control": "no-store" } as const;

type DatabaseCheck = "ok" | "not_configured" | "unavailable";

async function checkDatabase(): Promise<DatabaseCheck> {
  const env = getSafeEnvSummary();
  if (env.integrations.database === "not_configured") return "not_configured";

  try {
    await getDb().execute(sql`select 1`);
    return "ok";
  } catch {
    return "unavailable";
  }
}

export async function GET() {
  const timestamp = new Date().toISOString();

  try {
    const env = getSafeEnvSummary();
    const database = await checkDatabase();
    const authConfigured = Boolean(
      env.integrations.database === "configured" && process.env.AUTH_SECRET,
    );

    const degraded = database === "unavailable";

    return NextResponse.json(
      {
        status: degraded ? "degraded" : "ok",
        service: PRODUCT.name,
        version: PRODUCT.version,
        phase: PRODUCT.phase.number,
        environment: env.environment,
        checks: {
          database,
          auth: authConfigured ? "configured" : "not_configured",
          salla: "not_configured",
        },
        integrations: env.integrations,
        timestamp,
      },
      { status: degraded ? 503 : 200, headers: NO_STORE },
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
