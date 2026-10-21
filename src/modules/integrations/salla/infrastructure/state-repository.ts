import { and, eq, isNull, lt } from "drizzle-orm";

import type { DbExecutor } from "@/db/executor";
import { oauthStates, type OAuthState } from "@/db/schema";

export type OAuthStateRecord = OAuthState;

export async function insertOAuthState(
  db: DbExecutor,
  values: {
    stateHash: string;
    userId: string;
    organizationId: string;
    storeId: string;
    provider: "salla";
    expiresAt: Date;
  },
): Promise<OAuthStateRecord> {
  const [row] = await db.insert(oauthStates).values(values).returning();
  if (!row) throw new Error("insertOAuthState returned no row");
  return row;
}

/** Invalidates outstanding states for the same store so only one flow is live. */
export async function invalidatePendingStates(
  db: DbExecutor,
  storeId: string,
  at: Date,
): Promise<void> {
  await db
    .update(oauthStates)
    .set({ usedAt: at })
    .where(
      and(
        eq(oauthStates.storeId, storeId),
        eq(oauthStates.provider, "salla"),
        isNull(oauthStates.usedAt),
      ),
    );
}

export async function findStateByHash(
  db: DbExecutor,
  stateHash: string,
): Promise<OAuthStateRecord | undefined> {
  const [row] = await db
    .select()
    .from(oauthStates)
    .where(eq(oauthStates.stateHash, stateHash))
    .limit(1);
  return row;
}

/** Consumes a state exactly once; a second caller gets `false`. */
export async function consumeState(db: DbExecutor, id: string, at: Date): Promise<boolean> {
  const rows = await db
    .update(oauthStates)
    .set({ usedAt: at })
    .where(and(eq(oauthStates.id, id), isNull(oauthStates.usedAt)))
    .returning({ id: oauthStates.id });

  return rows.length > 0;
}

export async function deleteExpiredStates(db: DbExecutor, before: Date): Promise<void> {
  await db.delete(oauthStates).where(lt(oauthStates.expiresAt, before));
}
