import type { NextRequest, NextResponse } from "next/server";

import { getDb } from "@/db/client";
import { AppError } from "@/lib/errors";
import {
  permissionsForRole,
  type MembershipRole,
  type Permission,
} from "@/modules/identity/domain/permissions";
import { SESSION_COOKIE_NAME } from "@/modules/identity/domain/session-policy";
import { authenticateSessionToken } from "@/modules/identity/application/auth-service";
import type { AuthSession, TenantContext } from "@/modules/identity/application/types";
import { assertPermission, assertRole } from "@/modules/identity/application/authorization";
import { cookiePolicy } from "@/server/cookie-policy";
import { requestMeta } from "@/server/request-meta";

/** Reads the session cookie value without trusting anything else. */
export function readSessionToken(request: NextRequest): string | null {
  return request.cookies.get(SESSION_COOKIE_NAME)?.value ?? null;
}

export function setSessionCookie(response: NextResponse, token: string, expiresAt: Date): void {
  response.cookies.set(SESSION_COOKIE_NAME, token, {
    httpOnly: true,
    path: "/",
    expires: expiresAt,
    ...cookiePolicy(),
  });
}

export function clearSessionCookie(response: NextResponse): void {
  response.cookies.set(SESSION_COOKIE_NAME, "", {
    httpOnly: true,
    path: "/",
    maxAge: 0,
    ...cookiePolicy(),
  });
}

export async function optionalAuth(request: NextRequest): Promise<AuthSession | null> {
  const token = readSessionToken(request);
  if (!token) return null;
  return authenticateSessionToken(getDb(), token);
}

export async function requireAuth(request: NextRequest): Promise<AuthSession> {
  const auth = await optionalAuth(request);

  if (!auth) {
    throw new AppError({
      code: "UNAUTHENTICATED",
      message: "Sign in to continue.",
    });
  }

  return auth;
}

/**
 * Derives the tenant context from the authenticated session only. A client
 * supplied organization or store id is never part of this computation.
 */
export function toTenantContext(auth: AuthSession, requestId: string | null): TenantContext {
  const membership = auth.membership;
  const organization = auth.organization;

  if (!membership || membership.status !== "active" || !organization) {
    throw new AppError({
      code: "FORBIDDEN",
      message: "No active organization is available for this account.",
    });
  }

  return {
    userId: auth.user.id,
    organizationId: membership.organizationId,
    membershipId: membership.id,
    role: membership.role as MembershipRole,
    permissions: permissionsForRole(membership.role as MembershipRole),
    user: { id: auth.user.id, email: auth.user.email, name: auth.user.name },
    organization: {
      id: organization.id,
      name: organization.name,
      slug: organization.slug,
    },
    sessionId: auth.session.id,
    requestId,
  };
}

export async function requireOrganizationAccess(request: NextRequest): Promise<TenantContext> {
  const auth = await requireAuth(request);
  return toTenantContext(auth, requestMeta(request).requestId);
}

export async function requirePermission(
  request: NextRequest,
  permission: Permission,
): Promise<TenantContext> {
  const context = await requireOrganizationAccess(request);
  assertPermission(context, permission);
  return context;
}

export async function requireRole(
  request: NextRequest,
  roles: readonly MembershipRole[],
): Promise<TenantContext> {
  const context = await requireOrganizationAccess(request);
  assertRole(context, roles);
  return context;
}
