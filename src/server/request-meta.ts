import { randomUUID } from "node:crypto";

import type { NextRequest } from "next/server";

import { hashToken } from "@/modules/identity/domain/tokens";
import { getAuthSecret } from "@/modules/identity/infrastructure/auth-secret";
import type { RequestMeta } from "@/modules/identity/application/types";

/**
 * Extracts request facts for audit rows.
 *
 * Raw IP addresses are never stored: only a keyed hash, which is enough to
 * correlate abuse without retaining personal data.
 */
export function requestMeta(request: NextRequest): RequestMeta {
  const forwarded = request.headers.get("x-forwarded-for");
  const ip = forwarded?.split(",")[0]?.trim() || request.headers.get("x-real-ip") || null;

  return {
    ipHash: ip ? hashToken(`ip:${ip}`, getAuthSecret()).slice(0, 32) : null,
    userAgent: request.headers.get("user-agent")?.slice(0, 255) ?? null,
    requestId: request.headers.get("x-request-id") ?? randomUUID(),
  };
}

export function clientIp(request: NextRequest): string {
  const forwarded = request.headers.get("x-forwarded-for");
  return forwarded?.split(",")[0]?.trim() || request.headers.get("x-real-ip") || "unknown";
}

/** Stable, non-reversible key for in-memory rate limiting. */
export function clientKey(request: NextRequest): string {
  return hashToken(`ip:${clientIp(request)}`, getAuthSecret()).slice(0, 32);
}
