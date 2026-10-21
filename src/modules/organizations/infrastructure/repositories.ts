import { and, asc, eq, isNull, sql } from "drizzle-orm";

import type { DbExecutor } from "@/db/executor";
import {
  invitations,
  organizationMembers,
  organizations,
  users,
  type MemberRole,
  type MemberStatus,
} from "@/db/schema";

export type OrganizationRecord = typeof organizations.$inferSelect;
export type MembershipRecord = typeof organizationMembers.$inferSelect;
export type InvitationRecord = typeof invitations.$inferSelect;

export async function insertOrganization(
  db: DbExecutor,
  values: { name: string; slug: string; createdBy: string },
): Promise<OrganizationRecord> {
  const [row] = await db.insert(organizations).values(values).returning();
  if (!row) throw new Error("insertOrganization returned no row");
  return row;
}

export async function findOrganizationBySlug(
  db: DbExecutor,
  slug: string,
): Promise<OrganizationRecord | undefined> {
  const [row] = await db.select().from(organizations).where(eq(organizations.slug, slug)).limit(1);
  return row;
}

export async function findOrganizationById(
  db: DbExecutor,
  id: string,
): Promise<OrganizationRecord | undefined> {
  const [row] = await db.select().from(organizations).where(eq(organizations.id, id)).limit(1);
  return row;
}

export async function updateOrganizationName(
  db: DbExecutor,
  id: string,
  name: string,
): Promise<OrganizationRecord | undefined> {
  const [row] = await db
    .update(organizations)
    .set({ name, updatedAt: new Date() })
    .where(eq(organizations.id, id))
    .returning();
  return row;
}

export interface MembershipWithUser {
  membershipId: string;
  userId: string;
  email: string;
  name: string;
  role: MemberRole;
  status: MemberStatus;
  createdAt: Date;
}

export async function insertMembership(
  db: DbExecutor,
  values: {
    organizationId: string;
    userId: string;
    role: MemberRole;
    status?: MemberStatus;
  },
): Promise<MembershipRecord> {
  const [row] = await db
    .insert(organizationMembers)
    .values({ ...values, status: values.status ?? "active" })
    .returning();
  if (!row) throw new Error("insertMembership returned no row");
  return row;
}

export async function findMembership(
  db: DbExecutor,
  organizationId: string,
  userId: string,
): Promise<MembershipRecord | undefined> {
  const [row] = await db
    .select()
    .from(organizationMembers)
    .where(
      and(
        eq(organizationMembers.organizationId, organizationId),
        eq(organizationMembers.userId, userId),
      ),
    )
    .limit(1);
  return row;
}

export async function findMembershipById(
  db: DbExecutor,
  membershipId: string,
): Promise<MembershipRecord | undefined> {
  const [row] = await db
    .select()
    .from(organizationMembers)
    .where(eq(organizationMembers.id, membershipId))
    .limit(1);
  return row;
}

export async function listMembershipsForUser(
  db: DbExecutor,
  userId: string,
): Promise<MembershipRecord[]> {
  return db
    .select()
    .from(organizationMembers)
    .where(and(eq(organizationMembers.userId, userId), eq(organizationMembers.status, "active")))
    .orderBy(asc(organizationMembers.createdAt));
}

export async function listActiveMemberships(
  db: DbExecutor,
  organizationId: string,
): Promise<MembershipWithUser[]> {
  return db
    .select({
      membershipId: organizationMembers.id,
      userId: organizationMembers.userId,
      email: users.email,
      name: users.name,
      role: organizationMembers.role,
      status: organizationMembers.status,
      createdAt: organizationMembers.createdAt,
    })
    .from(organizationMembers)
    .innerJoin(users, eq(users.id, organizationMembers.userId))
    .where(
      and(
        eq(organizationMembers.organizationId, organizationId),
        eq(organizationMembers.status, "active"),
      ),
    )
    .orderBy(asc(organizationMembers.createdAt));
}

export async function updateMembershipRole(
  db: DbExecutor,
  membershipId: string,
  role: MemberRole,
): Promise<MembershipRecord | undefined> {
  const [row] = await db
    .update(organizationMembers)
    .set({ role, updatedAt: new Date() })
    .where(eq(organizationMembers.id, membershipId))
    .returning();
  return row;
}

export async function updateMembershipStatus(
  db: DbExecutor,
  membershipId: string,
  status: MemberStatus,
): Promise<MembershipRecord | undefined> {
  const [row] = await db
    .update(organizationMembers)
    .set({ status, updatedAt: new Date() })
    .where(eq(organizationMembers.id, membershipId))
    .returning();
  return row;
}

export async function countActiveOwners(db: DbExecutor, organizationId: string): Promise<number> {
  const [row] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(organizationMembers)
    .where(
      and(
        eq(organizationMembers.organizationId, organizationId),
        eq(organizationMembers.role, "owner"),
        eq(organizationMembers.status, "active"),
      ),
    );
  return row?.count ?? 0;
}

/**
 * Serializes membership mutations for one organization so two concurrent
 * demotions cannot both observe "two owners" and remove the last one.
 */
export async function lockOrganizationMembers(
  db: DbExecutor,
  organizationId: string,
): Promise<void> {
  await db.execute(
    sql`select id from organization_members where organization_id = ${organizationId} for update`,
  );
}

export interface InsertInvitationValues {
  organizationId: string;
  email: string;
  role: MemberRole;
  tokenHash: string;
  expiresAt: Date;
  createdBy: string;
}

export async function insertInvitation(
  db: DbExecutor,
  values: InsertInvitationValues,
): Promise<InvitationRecord> {
  const [row] = await db.insert(invitations).values(values).returning();
  if (!row) throw new Error("insertInvitation returned no row");
  return row;
}

export async function findPendingInvitation(
  db: DbExecutor,
  organizationId: string,
  email: string,
): Promise<InvitationRecord | undefined> {
  const [row] = await db
    .select()
    .from(invitations)
    .where(
      and(
        eq(invitations.organizationId, organizationId),
        eq(invitations.email, email),
        isNull(invitations.acceptedAt),
        isNull(invitations.revokedAt),
      ),
    )
    .limit(1);
  return row;
}

export async function findInvitationByTokenHash(
  db: DbExecutor,
  tokenHash: string,
): Promise<InvitationRecord | undefined> {
  const [row] = await db
    .select()
    .from(invitations)
    .where(eq(invitations.tokenHash, tokenHash))
    .limit(1);
  return row;
}

export async function markInvitationAccepted(
  db: DbExecutor,
  invitationId: string,
  at: Date,
): Promise<boolean> {
  const rows = await db
    .update(invitations)
    .set({ acceptedAt: at })
    .where(and(eq(invitations.id, invitationId), isNull(invitations.acceptedAt)))
    .returning({ id: invitations.id });
  return rows.length > 0;
}

export async function revokeInvitation(
  db: DbExecutor,
  invitationId: string,
  at: Date,
): Promise<boolean> {
  const rows = await db
    .update(invitations)
    .set({ revokedAt: at })
    .where(and(eq(invitations.id, invitationId), isNull(invitations.acceptedAt)))
    .returning({ id: invitations.id });
  return rows.length > 0;
}

export async function listPendingInvitations(
  db: DbExecutor,
  organizationId: string,
): Promise<InvitationRecord[]> {
  return db
    .select()
    .from(invitations)
    .where(
      and(
        eq(invitations.organizationId, organizationId),
        isNull(invitations.acceptedAt),
        isNull(invitations.revokedAt),
      ),
    )
    .orderBy(asc(invitations.createdAt));
}
