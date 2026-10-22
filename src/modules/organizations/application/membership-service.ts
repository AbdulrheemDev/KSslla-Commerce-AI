import { sql } from "drizzle-orm";

import type { Database } from "@/db/client";
import { bindOrganization, withTenantTransaction } from "@/db/tenant";
import { recordAudit } from "@/modules/audit/infrastructure/audit-repository";
import { isValidEmail, normalizeEmail } from "@/modules/identity/domain/identifiers";
import { isMembershipRole, type MembershipRole } from "@/modules/identity/domain/permissions";
import { INVITATION_TTL_MS } from "@/modules/identity/domain/session-policy";
import { generateOpaqueToken, hashToken } from "@/modules/identity/domain/tokens";
import type { RequestMeta, TenantContext } from "@/modules/identity/application/types";
import {
  assertPermission,
  canAssignRole,
  canManageRole,
} from "@/modules/identity/application/authorization";
import { getAuthSecret } from "@/modules/identity/infrastructure/auth-secret";
import { findUserByEmail } from "@/modules/identity/infrastructure/repositories";
import {
  countActiveOwners,
  findInvitationByTokenHash,
  findMembership,
  findMembershipById,
  findPendingInvitation,
  insertInvitation,
  insertMembership,
  listActiveMemberships,
  listPendingInvitations,
  lockOrganizationMembers,
  markInvitationAccepted,
  updateMembershipRole,
  updateMembershipStatus,
  type MembershipRecord,
} from "@/modules/organizations/infrastructure/repositories";
import { AppError } from "@/lib/errors";

export interface MemberView {
  membershipId: string;
  userId: string;
  name: string;
  email: string;
  role: MembershipRole;
  joinedAt: string;
}

export interface InvitationView {
  id: string;
  email: string;
  role: MembershipRole;
  createdAt: string;
  expiresAt: string;
}

function assertManageableRole(role: string): MembershipRole {
  if (!isMembershipRole(role)) {
    throw new AppError({
      code: "VALIDATION_FAILED",
      message: "Unknown role.",
      details: { field: "role" },
    });
  }
  return role;
}

function assertNotOwnerTarget(target: MembershipRecord): void {
  if (target.role === "owner") {
    throw new AppError({
      code: "FORBIDDEN",
      message: "Ownership changes require an explicit transfer.",
    });
  }
}

function assertCanActOn(actorRole: MembershipRole, targetRole: MembershipRole): void {
  if (!canManageRole(actorRole, targetRole)) {
    throw new AppError({
      code: "FORBIDDEN",
      message: "You cannot manage a member with this role.",
    });
  }
}

export async function listMembers(db: Database, context: TenantContext): Promise<MemberView[]> {
  assertPermission(context, "member:read");

  const rows = await withTenantTransaction(
    db,
    { userId: context.userId, organizationId: context.organizationId },
    (tx) => listActiveMemberships(tx, context.organizationId),
  );

  return rows.map((row) => ({
    membershipId: row.membershipId,
    userId: row.userId,
    name: row.name,
    email: row.email,
    role: row.role,
    joinedAt: row.createdAt.toISOString(),
  }));
}

export async function listInvitations(
  db: Database,
  context: TenantContext,
): Promise<InvitationView[]> {
  assertPermission(context, "member:read");

  const rows = await withTenantTransaction(
    db,
    { userId: context.userId, organizationId: context.organizationId },
    (tx) => listPendingInvitations(tx, context.organizationId),
  );

  return rows.map((row) => ({
    id: row.id,
    email: row.email,
    role: row.role,
    createdAt: row.createdAt.toISOString(),
    expiresAt: row.expiresAt.toISOString(),
  }));
}

export interface InviteMemberInput {
  email: string;
  role: MembershipRole;
}

export interface InviteMemberResult {
  invitationId: string;
  email: string;
  role: MembershipRole;
  expiresAt: Date;
  /** Returned exactly once so the owner can pass it on; never persisted raw. */
  token: string;
}

export async function inviteMember(
  db: Database,
  context: TenantContext,
  input: InviteMemberInput,
  meta: RequestMeta,
): Promise<InviteMemberResult> {
  assertPermission(context, "member:invite");

  const email = normalizeEmail(input.email);
  if (!isValidEmail(email)) {
    throw new AppError({
      code: "VALIDATION_FAILED",
      message: "Invalid email address.",
      details: { field: "email" },
    });
  }

  const role = assertManageableRole(input.role);

  if (!canAssignRole(context.role, role)) {
    throw new AppError({
      code: "FORBIDDEN",
      message: "You cannot grant this role.",
      details: { field: "role" },
    });
  }

  const token = generateOpaqueToken();
  const tokenHash = hashToken(token, getAuthSecret());
  const expiresAt = new Date(Date.now() + INVITATION_TTL_MS);

  const invitation = await withTenantTransaction(
    db,
    { userId: context.userId, organizationId: context.organizationId },
    async (tx) => {
      const existingUser = await findUserByEmail(tx, email);
      if (existingUser) {
        const membership = await findMembership(tx, context.organizationId, existingUser.id);
        if (membership?.status === "active") {
          throw new AppError({
            code: "CONFLICT",
            message: "This person is already a member.",
          });
        }
      }

      const pending = await findPendingInvitation(tx, context.organizationId, email);
      if (pending) {
        throw new AppError({
          code: "CONFLICT",
          message: "An invitation is already pending for this email.",
        });
      }

      const row = await insertInvitation(tx, {
        organizationId: context.organizationId,
        email,
        role,
        tokenHash,
        expiresAt,
        createdBy: context.userId,
      });

      await recordAudit(tx, {
        organizationId: context.organizationId,
        actorUserId: context.userId,
        action: "member.invited",
        entityType: "invitation",
        entityId: row.id,
        metadata: { role },
        ipHash: meta.ipHash,
        userAgent: meta.userAgent,
        requestId: meta.requestId,
      });

      return row;
    },
  );

  return {
    invitationId: invitation.id,
    email,
    role,
    expiresAt: invitation.expiresAt,
    token,
  };
}

export interface AcceptInvitationResult {
  organizationId: string;
  role: MembershipRole;
}

/**
 * Accepts an invitation for the signed-in user.
 *
 * The raw token is the only credential: a wrong, expired, revoked, or already
 * used token produces the same 404 so tokens cannot be probed.
 */
export async function acceptInvitation(
  db: Database,
  input: { token: string; userId: string; userEmail: string },
  meta: RequestMeta,
): Promise<AcceptInvitationResult> {
  const tokenHash = hashToken(input.token, getAuthSecret());

  return db.transaction(async (tx) => {
    // Allows exactly one invitation row to be resolved before organization
    // context exists (see the invitations RLS policy).
    await tx.execute(sql`select set_config('app.invitation_token_hash', ${tokenHash}, true)`);

    const invitation = await findInvitationByTokenHash(tx, tokenHash);
    const invalid = () =>
      new AppError({
        code: "NOT_FOUND",
        message: "This invitation is invalid or has expired.",
      });

    if (!invitation) throw invalid();
    if (invitation.acceptedAt || invitation.revokedAt) throw invalid();
    if (invitation.expiresAt.getTime() <= Date.now()) throw invalid();
    if (invitation.email !== normalizeEmail(input.userEmail)) throw invalid();

    await bindOrganization(tx, invitation.organizationId);
    await tx.execute(sql`select set_config('app.current_user', ${input.userId}, true)`);

    const existing = await findMembership(tx, invitation.organizationId, input.userId);

    if (existing?.status === "active") {
      throw new AppError({
        code: "CONFLICT",
        message: "You are already a member of this organization.",
      });
    }

    if (existing) {
      await updateMembershipRole(tx, existing.id, invitation.role);
      await updateMembershipStatus(tx, existing.id, "active");
    } else {
      await insertMembership(tx, {
        organizationId: invitation.organizationId,
        userId: input.userId,
        role: invitation.role,
        status: "active",
      });
    }

    const accepted = await markInvitationAccepted(tx, invitation.id, new Date());
    if (!accepted) {
      throw new AppError({
        code: "CONFLICT",
        message: "This invitation has already been used.",
      });
    }

    await recordAudit(tx, {
      organizationId: invitation.organizationId,
      actorUserId: input.userId,
      action: "member.accepted",
      entityType: "invitation",
      entityId: invitation.id,
      metadata: { role: invitation.role },
      ipHash: meta.ipHash,
      userAgent: meta.userAgent,
      requestId: meta.requestId,
    });

    return { organizationId: invitation.organizationId, role: invitation.role };
  });
}

export async function changeMemberRole(
  db: Database,
  context: TenantContext,
  membershipId: string,
  nextRole: MembershipRole,
  meta: RequestMeta,
): Promise<void> {
  assertPermission(context, "role:update");
  const role = assertManageableRole(nextRole);

  if (!canAssignRole(context.role, role)) {
    throw new AppError({
      code: "FORBIDDEN",
      message: "You cannot grant this role.",
    });
  }

  await withTenantTransaction(
    db,
    { userId: context.userId, organizationId: context.organizationId },
    async (tx) => {
      await lockOrganizationMembers(tx, context.organizationId);

      const target = await findMembershipById(tx, membershipId);
      if (!target || target.organizationId !== context.organizationId) {
        throw new AppError({ code: "NOT_FOUND", message: "Member not found." });
      }

      if (target.userId === context.userId) {
        throw new AppError({
          code: "FORBIDDEN",
          message: "You cannot change your own role.",
        });
      }

      assertCanActOn(context.role, target.role);
      assertNotOwnerTarget(target);

      await updateMembershipRole(tx, target.id, role);

      await recordAudit(tx, {
        organizationId: context.organizationId,
        actorUserId: context.userId,
        action: "member.role_changed",
        entityType: "membership",
        entityId: target.id,
        metadata: { from: target.role, to: role },
        ipHash: meta.ipHash,
        userAgent: meta.userAgent,
        requestId: meta.requestId,
      });
    },
  );
}

export async function removeMember(
  db: Database,
  context: TenantContext,
  membershipId: string,
  meta: RequestMeta,
): Promise<void> {
  assertPermission(context, "member:remove");

  await withTenantTransaction(
    db,
    { userId: context.userId, organizationId: context.organizationId },
    async (tx) => {
      await lockOrganizationMembers(tx, context.organizationId);

      const target = await findMembershipById(tx, membershipId);
      if (!target || target.organizationId !== context.organizationId) {
        throw new AppError({ code: "NOT_FOUND", message: "Member not found." });
      }

      if (target.userId === context.userId) {
        throw new AppError({
          code: "FORBIDDEN",
          message: "You cannot remove yourself.",
        });
      }

      if (target.role === "owner") {
        // Only an owner may remove a peer owner, and never the last one.
        if (context.role !== "owner") {
          throw new AppError({
            code: "FORBIDDEN",
            message: "You cannot manage an owner.",
          });
        }

        const owners = await countActiveOwners(tx, context.organizationId);
        if (owners <= 1) {
          throw new AppError({
            code: "CONFLICT",
            message: "The last owner cannot be removed.",
          });
        }
      } else {
        assertCanActOn(context.role, target.role);
      }

      await updateMembershipStatus(tx, target.id, "removed");

      await recordAudit(tx, {
        organizationId: context.organizationId,
        actorUserId: context.userId,
        action: "member.removed",
        entityType: "membership",
        entityId: target.id,
        metadata: { role: target.role },
        ipHash: meta.ipHash,
        userAgent: meta.userAgent,
        requestId: meta.requestId,
      });
    },
  );
}
