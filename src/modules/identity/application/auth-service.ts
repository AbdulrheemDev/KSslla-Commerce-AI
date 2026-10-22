import { randomBytes } from "node:crypto";

import { sql } from "drizzle-orm";

import type { Database } from "@/db/client";
import type { DbExecutor } from "@/db/executor";
import { bindOrganization, withTenantTransaction } from "@/db/tenant";
import { recordAudit } from "@/modules/audit/infrastructure/audit-repository";
import {
  isValidEmail,
  normalizeEmail,
  slugifyOrganizationName,
} from "@/modules/identity/domain/identifiers";
import {
  assertPasswordPolicy,
  getDummyPasswordHash,
  hashPassword,
  verifyPassword,
} from "@/modules/identity/domain/password";
import {
  SESSION_ABSOLUTE_MS,
  SESSION_IDLE_MS,
  SESSION_TOUCH_INTERVAL_MS,
} from "@/modules/identity/domain/session-policy";
import { generateOpaqueToken, hashToken } from "@/modules/identity/domain/tokens";
import type { AuthSession, RequestMeta } from "@/modules/identity/application/types";
import type { AuditEvent } from "@/modules/audit/infrastructure/audit-repository";
import { getAuthSecret } from "@/modules/identity/infrastructure/auth-secret";
import {
  findSessionByTokenHash,
  findUserByEmail,
  findUserById,
  insertSession,
  insertUser,
  recordSuccessfulLogin,
  revokeSession,
  touchSession,
  type SessionRecord,
  type UserRecord,
} from "@/modules/identity/infrastructure/repositories";
import {
  findMembership,
  findOrganizationById,
  findOrganizationBySlug,
  insertMembership,
  insertOrganization,
  listMembershipsForUser,
  type MembershipRecord,
  type OrganizationRecord,
} from "@/modules/organizations/infrastructure/repositories";
import { insertStore } from "@/modules/stores/infrastructure/store-repository";
import { AppError } from "@/lib/errors";

export interface RegisterInput {
  email: string;
  password: string;
  name: string;
  organizationName: string;
  storeName?: string | null;
}

export interface RegisterResult {
  user: UserRecord;
  organization: OrganizationRecord;
  token: string;
  expiresAt: Date;
}

export interface LoginInput {
  email: string;
  password: string;
}

export interface LoginResult {
  user: UserRecord;
  session: SessionRecord;
  token: string;
  expiresAt: Date;
  organizationId: string | null;
}

const MAX_NAME_LENGTH = 120;

function requireText(value: string, field: string, maxLength = MAX_NAME_LENGTH): string {
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > maxLength) {
    throw new AppError({
      code: "VALIDATION_FAILED",
      message: `Invalid value for ${field}.`,
      details: { field },
    });
  }
  return trimmed;
}

function normalizeLoginEmail(raw: string): string {
  const email = normalizeEmail(raw);
  if (!isValidEmail(email)) {
    // Same response as a wrong password: do not confirm account existence.
    throw new AppError({
      code: "UNAUTHENTICATED",
      message: "Incorrect email or password.",
    });
  }
  return email;
}

/**
 * Session-level audits are written with tenant context when the session has an
 * organization, so the append-only RLS policy accepts the row.
 */
async function recordSessionAudit(db: DbExecutor, event: AuditEvent): Promise<void> {
  if (event.organizationId) {
    await withTenantTransaction(
      db as Database,
      { userId: event.actorUserId, organizationId: event.organizationId },
      (tx) => recordAudit(tx, event),
    );
    return;
  }

  await recordAudit(db, event);
}

async function createSession(
  db: DbExecutor,
  input: {
    userId: string;
    organizationId: string | null;
    meta: RequestMeta;
    now: Date;
  },
): Promise<{ token: string; session: SessionRecord }> {
  const token = generateOpaqueToken();

  const session = await insertSession(db, {
    userId: input.userId,
    sessionTokenHash: hashToken(token, getAuthSecret()),
    activeOrganizationId: input.organizationId,
    expiresAt: new Date(input.now.getTime() + SESSION_IDLE_MS),
    absoluteExpiresAt: new Date(input.now.getTime() + SESSION_ABSOLUTE_MS),
    ipHash: input.meta.ipHash,
    userAgent: input.meta.userAgent,
  });

  return { token, session };
}

async function uniqueOrganizationSlug(db: DbExecutor, name: string): Promise<string> {
  const base = slugifyOrganizationName(name);

  for (let attempt = 0; attempt < 5; attempt += 1) {
    const candidate = attempt === 0 ? base : `${base}-${randomBytes(2).toString("hex")}`;
    const existing = await findOrganizationBySlug(db, candidate);
    if (!existing) return candidate;
  }

  return `org-${randomBytes(8).toString("hex")}`;
}

/**
 * Creates User + Organization + OWNER membership (+ optional internal store)
 * and the first session in one transaction. No Salla connection is created,
 * implied, or claimed.
 */
export async function registerAccount(
  db: Database,
  input: RegisterInput,
  meta: RequestMeta,
): Promise<RegisterResult> {
  const email = normalizeEmail(input.email);
  const name = requireText(input.name, "name");
  const organizationName = requireText(input.organizationName, "organizationName");
  const storeName = input.storeName?.trim() ? requireText(input.storeName, "storeName") : null;

  if (!isValidEmail(email)) {
    throw new AppError({
      code: "VALIDATION_FAILED",
      message: "Invalid email address.",
      details: { field: "email" },
    });
  }

  assertPasswordPolicy(input.password);

  if (await findUserByEmail(db, email)) {
    // Does not confirm which account exists.
    throw new AppError({
      code: "CONFLICT",
      message: "Unable to create an account with these details.",
    });
  }

  const passwordHash = await hashPassword(input.password);
  const slug = await uniqueOrganizationSlug(db, organizationName);
  const now = new Date();

  return db.transaction(async (tx) => {
    const user = await insertUser(tx, { email, passwordHash, name });
    const organization = await insertOrganization(tx, {
      name: organizationName,
      slug,
      createdBy: user.id,
    });

    // The membership and audit insert policies require tenant context.
    await bindOrganization(tx, organization.id);
    await tx.execute(sql`select set_config('app.current_user', ${user.id}, true)`);

    await insertMembership(tx, {
      organizationId: organization.id,
      userId: user.id,
      role: "owner",
      status: "active",
    });

    if (storeName) {
      let storeSlug = slugifyOrganizationName(storeName);
      if (storeSlug === slug) storeSlug = `${storeSlug}-store`;

      await insertStore(tx, {
        organizationId: organization.id,
        name: storeName,
        slug: storeSlug,
      });

      await recordAudit(tx, {
        organizationId: organization.id,
        actorUserId: user.id,
        action: "store.created",
        entityType: "store",
        metadata: { platform: "salla", status: "not_connected" },
        ipHash: meta.ipHash,
        userAgent: meta.userAgent,
        requestId: meta.requestId,
      });
    }

    await recordAudit(tx, {
      organizationId: organization.id,
      actorUserId: user.id,
      action: "user.registered",
      entityType: "user",
      entityId: user.id,
      metadata: { organizationId: organization.id },
      ipHash: meta.ipHash,
      userAgent: meta.userAgent,
      requestId: meta.requestId,
    });

    await recordAudit(tx, {
      organizationId: organization.id,
      actorUserId: user.id,
      action: "organization.created",
      entityType: "organization",
      entityId: organization.id,
      metadata: {},
      ipHash: meta.ipHash,
      userAgent: meta.userAgent,
      requestId: meta.requestId,
    });

    const issued = await createSession(tx, {
      userId: user.id,
      organizationId: organization.id,
      meta,
      now,
    });

    return {
      user,
      organization,
      token: issued.token,
      expiresAt: issued.session.absoluteExpiresAt,
    };
  });
}

export async function loginWithPassword(
  db: Database,
  input: LoginInput,
  meta: RequestMeta,
): Promise<LoginResult> {
  const email = normalizeLoginEmail(input.email);
  const user = await findUserByEmail(db, email);

  if (!user) {
    // Spend the same scrypt work as a real verification.
    await verifyPassword(input.password, await getDummyPasswordHash());
    throw new AppError({ code: "UNAUTHENTICATED", message: "Incorrect email or password." });
  }

  const valid = await verifyPassword(input.password, user.passwordHash);

  if (!valid) {
    await recordAudit(db, {
      organizationId: null,
      actorUserId: null,
      action: "user.login_failed",
      entityType: "user",
      entityId: user.id,
      metadata: { reason: "invalid_credentials" },
      ipHash: meta.ipHash,
      userAgent: meta.userAgent,
      requestId: meta.requestId,
    });
    throw new AppError({ code: "UNAUTHENTICATED", message: "Incorrect email or password." });
  }

  if (user.status !== "active") {
    throw new AppError({
      code: "FORBIDDEN",
      message: "This account cannot sign in. Contact your organization owner.",
    });
  }

  const memberships = await withTenantTransaction(db, { userId: user.id }, (tx) =>
    listMembershipsForUser(tx, user.id),
  );

  const activeOrganizationId = memberships[0]?.organizationId ?? null;
  const now = new Date();

  const issued = await createSession(db, {
    userId: user.id,
    organizationId: activeOrganizationId,
    meta,
    now,
  });

  await recordSuccessfulLogin(db, user.id, now);

  await recordSessionAudit(db, {
    organizationId: activeOrganizationId,
    actorUserId: user.id,
    action: "user.login",
    entityType: "session",
    entityId: issued.session.id,
    metadata: {},
    ipHash: meta.ipHash,
    userAgent: meta.userAgent,
    requestId: meta.requestId,
  });

  return {
    user,
    session: issued.session,
    token: issued.token,
    expiresAt: issued.session.absoluteExpiresAt,
    organizationId: activeOrganizationId,
  };
}

/**
 * Resolves a cookie token into an authenticated user and the active membership.
 * Expired, revoked, and orphaned sessions are rejected.
 */
export async function authenticateSessionToken(
  db: Database,
  token: string,
  now: Date = new Date(),
): Promise<AuthSession | null> {
  const session = await findSessionByTokenHash(db, hashToken(token, getAuthSecret()));

  if (!session || session.revokedAt) return null;

  if (
    now.getTime() >= new Date(session.expiresAt).getTime() ||
    now.getTime() >= new Date(session.absoluteExpiresAt).getTime()
  ) {
    await revokeSession(db, session.id, now);
    return null;
  }

  const user = await findUserById(db, session.userId);
  if (!user || user.status !== "active") {
    await revokeSession(db, session.id, now);
    return null;
  }

  const memberships = await withTenantTransaction(db, { userId: user.id }, (tx) =>
    listMembershipsForUser(tx, user.id),
  );

  const membership =
    memberships.find((item) => item.organizationId === session.activeOrganizationId) ??
    memberships[0] ??
    null;

  if (membership && membership.organizationId !== session.activeOrganizationId) {
    await db.execute(
      sql`update sessions set active_organization_id = ${membership.organizationId} where id = ${session.id}`,
    );
  }

  if (now.getTime() - new Date(session.lastSeenAt).getTime() >= SESSION_TOUCH_INTERVAL_MS) {
    const nextExpiry = Math.min(
      now.getTime() + SESSION_IDLE_MS,
      new Date(session.absoluteExpiresAt).getTime(),
    );
    await touchSession(db, session.id, now, new Date(nextExpiry));
  }

  const organization = membership
    ? await findOrganizationById(db, membership.organizationId)
    : undefined;

  return {
    user,
    session: {
      ...session,
      activeOrganizationId: membership?.organizationId ?? session.activeOrganizationId,
    },
    membership,
    organization: organization ?? null,
  };
}

export async function logoutSession(
  db: Database,
  token: string,
  meta: RequestMeta,
): Promise<boolean> {
  const session = await findSessionByTokenHash(db, hashToken(token, getAuthSecret()));
  if (!session) return false;

  const revoked = await revokeSession(db, session.id, new Date());

  if (revoked) {
    await recordSessionAudit(db, {
      organizationId: session.activeOrganizationId,
      actorUserId: session.userId,
      action: "user.logout",
      entityType: "session",
      entityId: session.id,
      metadata: {},
      ipHash: meta.ipHash,
      userAgent: meta.userAgent,
      requestId: meta.requestId,
    });

    await recordSessionAudit(db, {
      organizationId: session.activeOrganizationId,
      actorUserId: session.userId,
      action: "session.revoked",
      entityType: "session",
      entityId: session.id,
      metadata: { reason: "logout" },
      ipHash: meta.ipHash,
      userAgent: meta.userAgent,
      requestId: meta.requestId,
    });
  }

  return revoked;
}

export async function revokeSessionById(
  db: Database,
  sessionId: string,
  actorUserId: string,
  meta: RequestMeta,
): Promise<boolean> {
  const revoked = await revokeSession(db, sessionId, new Date());

  if (revoked) {
    await recordAudit(db, {
      organizationId: null,
      actorUserId,
      action: "session.revoked",
      entityType: "session",
      entityId: sessionId,
      metadata: {},
      ipHash: meta.ipHash,
      userAgent: meta.userAgent,
      requestId: meta.requestId,
    });
  }

  return revoked;
}

/** Enforces an active membership before any tenant-scoped operation. */
export function assertMembership(
  membership: MembershipRecord | null,
): asserts membership is MembershipRecord {
  if (!membership || membership.status !== "active") {
    throw new AppError({
      code: "FORBIDDEN",
      message: "No active organization is available for this account.",
    });
  }
}

export async function loadMembershipForUser(
  db: Database,
  userId: string,
  organizationId: string,
): Promise<MembershipRecord | undefined> {
  return db.transaction(async (tx) => {
    await bindOrganization(tx, organizationId);
    return findMembership(tx, organizationId, userId);
  });
}
