import { and, eq, or, isNull, lt, sql } from "drizzle-orm";

import type { DbExecutor } from "@/db/executor";
import { storeConnections, type ConnectionStatus, type StoreConnection } from "@/db/schema";

export type ConnectionRecord = StoreConnection;

export async function findConnectionByStore(
  db: DbExecutor,
  storeId: string,
): Promise<ConnectionRecord | undefined> {
  const [row] = await db
    .select()
    .from(storeConnections)
    .where(and(eq(storeConnections.storeId, storeId), eq(storeConnections.provider, "salla")))
    .limit(1);
  return row;
}

export async function findConnectionById(
  db: DbExecutor,
  id: string,
): Promise<ConnectionRecord | undefined> {
  const [row] = await db
    .select()
    .from(storeConnections)
    .where(eq(storeConnections.id, id))
    .limit(1);
  return row;
}

/**
 * Creates the connection row for a store or reuses the existing one.
 * Reconnection updates the same row, so a store never accumulates duplicates.
 */
export async function upsertPendingConnection(
  db: DbExecutor,
  values: { organizationId: string; storeId: string },
): Promise<ConnectionRecord> {
  const [row] = await db
    .insert(storeConnections)
    .values({
      organizationId: values.organizationId,
      storeId: values.storeId,
      provider: "salla",
      status: "authorizing",
    })
    .onConflictDoUpdate({
      target: [storeConnections.storeId, storeConnections.provider],
      set: { status: "authorizing", updatedAt: new Date() },
    })
    .returning();

  if (!row) throw new Error("upsertPendingConnection returned no row");
  return row;
}

export interface AuthorizedConnectionValues {
  externalStoreId: string;
  externalUserId: string;
  externalStoreName: string | null;
  scopes: string[];
  accessTokenCiphertext: string;
  refreshTokenCiphertext: string | null;
  accessTokenExpiresAt: Date;
  refreshTokenExpiresAt: Date | null;
  connectedAt: Date;
}

export async function saveAuthorizedConnection(
  db: DbExecutor,
  id: string,
  values: AuthorizedConnectionValues,
): Promise<ConnectionRecord | undefined> {
  const [row] = await db
    .update(storeConnections)
    .set({
      ...values,
      status: "connected",
      revokedAt: null,
      lastErrorCode: null,
      lastRefreshAt: values.connectedAt,
      refreshLockId: null,
      refreshLockExpiresAt: null,
      updatedAt: new Date(),
    })
    .where(eq(storeConnections.id, id))
    .returning();
  return row;
}

export async function updateConnectionStatus(
  db: DbExecutor,
  id: string,
  status: ConnectionStatus,
  lastErrorCode: string | null = null,
): Promise<void> {
  await db
    .update(storeConnections)
    .set({ status, lastErrorCode, updatedAt: new Date() })
    .where(eq(storeConnections.id, id));
}

export async function disconnectConnection(db: DbExecutor, id: string, at: Date): Promise<boolean> {
  const rows = await db
    .update(storeConnections)
    .set({
      status: "disconnected",
      accessTokenCiphertext: null,
      refreshTokenCiphertext: null,
      accessTokenExpiresAt: null,
      refreshTokenExpiresAt: null,
      revokedAt: at,
      lastErrorCode: null,
      refreshLockId: null,
      refreshLockExpiresAt: null,
      updatedAt: at,
    })
    .where(eq(storeConnections.id, id))
    .returning({ id: storeConnections.id });
  return rows.length > 0;
}

export async function markReauthRequired(
  db: DbExecutor,
  id: string,
  errorCode: string,
): Promise<void> {
  await db
    .update(storeConnections)
    .set({
      status: "reauth_required",
      accessTokenCiphertext: null,
      refreshTokenCiphertext: null,
      accessTokenExpiresAt: null,
      refreshTokenExpiresAt: null,
      lastErrorCode: errorCode,
      refreshLockId: null,
      refreshLockExpiresAt: null,
      updatedAt: new Date(),
    })
    .where(eq(storeConnections.id, id));
}

/**
 * Acquires the cross-process refresh lease.
 *
 * The conditional update is atomic, so exactly one worker can hold the lease
 * even across application instances. An expired lease is reclaimable.
 */
export async function acquireRefreshLease(
  db: DbExecutor,
  id: string,
  lockId: string,
  leaseSeconds: number,
): Promise<boolean> {
  const rows = await db
    .update(storeConnections)
    .set({
      refreshLockId: lockId,
      refreshLockExpiresAt: sql`now() + ${leaseSeconds} * interval '1 second'`,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(storeConnections.id, id),
        or(
          isNull(storeConnections.refreshLockId),
          lt(storeConnections.refreshLockExpiresAt, new Date()),
        ),
      ),
    )
    .returning({ id: storeConnections.id });

  return rows.length > 0;
}

export async function releaseRefreshLease(
  db: DbExecutor,
  id: string,
  lockId: string,
): Promise<void> {
  await db
    .update(storeConnections)
    .set({ refreshLockId: null, refreshLockExpiresAt: null })
    .where(and(eq(storeConnections.id, id), eq(storeConnections.refreshLockId, lockId)));
}

export interface RefreshedTokenValues {
  accessTokenCiphertext: string;
  refreshTokenCiphertext: string;
  accessTokenExpiresAt: Date;
  refreshTokenExpiresAt: Date | null;
  scopes: string[];
  refreshedAt: Date;
  expectedVersion: number;
}

/**
 * Persists rotated tokens only if this worker still owns the lease and no other
 * worker has already advanced the token version.
 */
export async function saveRefreshedTokens(
  db: DbExecutor,
  id: string,
  lockId: string,
  values: RefreshedTokenValues,
): Promise<ConnectionRecord | undefined> {
  const [row] = await db
    .update(storeConnections)
    .set({
      accessTokenCiphertext: values.accessTokenCiphertext,
      refreshTokenCiphertext: values.refreshTokenCiphertext,
      accessTokenExpiresAt: values.accessTokenExpiresAt,
      refreshTokenExpiresAt: values.refreshTokenExpiresAt,
      scopes: values.scopes,
      tokenVersion: values.expectedVersion + 1,
      lastRefreshAt: values.refreshedAt,
      status: "connected",
      lastErrorCode: null,
      refreshLockId: null,
      refreshLockExpiresAt: null,
      updatedAt: values.refreshedAt,
    })
    .where(
      and(
        eq(storeConnections.id, id),
        eq(storeConnections.refreshLockId, lockId),
        eq(storeConnections.tokenVersion, values.expectedVersion),
      ),
    )
    .returning();

  return row;
}

export async function recordRefreshFailure(
  db: DbExecutor,
  id: string,
  lockId: string,
  errorCode: string,
): Promise<void> {
  await db
    .update(storeConnections)
    .set({ lastErrorCode: errorCode, updatedAt: new Date() })
    .where(and(eq(storeConnections.id, id), eq(storeConnections.refreshLockId, lockId)));
}
