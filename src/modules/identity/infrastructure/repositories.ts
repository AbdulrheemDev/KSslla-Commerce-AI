import { and, eq, isNull, lt, sql } from "drizzle-orm";

import type { DbExecutor } from "@/db/executor";
import { sessions, users } from "@/db/schema";

export type UserRecord = typeof users.$inferSelect;
export type SessionRecord = typeof sessions.$inferSelect;

export async function findUserByEmail(
  db: DbExecutor,
  email: string,
): Promise<UserRecord | undefined> {
  const [row] = await db.select().from(users).where(eq(users.email, email)).limit(1);
  return row;
}

export async function findUserById(db: DbExecutor, id: string): Promise<UserRecord | undefined> {
  const [row] = await db.select().from(users).where(eq(users.id, id)).limit(1);
  return row;
}

export interface CreateUserValues {
  email: string;
  passwordHash: string;
  name: string;
}

export async function insertUser(db: DbExecutor, values: CreateUserValues): Promise<UserRecord> {
  const [row] = await db.insert(users).values(values).returning();
  if (!row) throw new Error("insertUser returned no row");
  return row;
}

export async function recordSuccessfulLogin(
  db: DbExecutor,
  userId: string,
  at: Date,
): Promise<void> {
  await db.update(users).set({ lastLoginAt: at }).where(eq(users.id, userId));
}

export interface CreateSessionValues {
  userId: string;
  sessionTokenHash: string;
  activeOrganizationId: string | null;
  expiresAt: Date;
  absoluteExpiresAt: Date;
  ipHash: string | null;
  userAgent: string | null;
}

export async function insertSession(
  db: DbExecutor,
  values: CreateSessionValues,
): Promise<SessionRecord> {
  const [row] = await db.insert(sessions).values(values).returning();
  if (!row) throw new Error("insertSession returned no row");
  return row;
}

export async function findSessionByTokenHash(
  db: DbExecutor,
  tokenHash: string,
): Promise<SessionRecord | undefined> {
  const [row] = await db
    .select()
    .from(sessions)
    .where(eq(sessions.sessionTokenHash, tokenHash))
    .limit(1);
  return row;
}

export async function findSessionById(
  db: DbExecutor,
  id: string,
): Promise<SessionRecord | undefined> {
  const [row] = await db.select().from(sessions).where(eq(sessions.id, id)).limit(1);
  return row;
}

export async function touchSession(
  db: DbExecutor,
  id: string,
  at: Date,
  expiresAt: Date,
): Promise<void> {
  await db.update(sessions).set({ lastSeenAt: at, expiresAt }).where(eq(sessions.id, id));
}

export async function revokeSession(db: DbExecutor, id: string, at: Date): Promise<boolean> {
  const rows = await db
    .update(sessions)
    .set({ revokedAt: at })
    .where(and(eq(sessions.id, id), isNull(sessions.revokedAt)))
    .returning({ id: sessions.id });
  return rows.length > 0;
}

export async function revokeAllUserSessions(
  db: DbExecutor,
  userId: string,
  at: Date,
): Promise<number> {
  const rows = await db
    .update(sessions)
    .set({ revokedAt: at })
    .where(and(eq(sessions.userId, userId), isNull(sessions.revokedAt)))
    .returning({ id: sessions.id });
  return rows.length;
}

export async function setSessionOrganization(
  db: DbExecutor,
  sessionId: string,
  organizationId: string,
): Promise<void> {
  await db
    .update(sessions)
    .set({ activeOrganizationId: organizationId })
    .where(eq(sessions.id, sessionId));
}

/** Removes expired rows; called opportunistically, never on the request path. */
export async function deleteExpiredSessions(db: DbExecutor, before: Date): Promise<void> {
  await db.delete(sessions).where(lt(sessions.expiresAt, before));
}

export async function countSessionsForUser(db: DbExecutor, userId: string): Promise<number> {
  const [row] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(sessions)
    .where(and(eq(sessions.userId, userId), isNull(sessions.revokedAt)));
  return row?.count ?? 0;
}
