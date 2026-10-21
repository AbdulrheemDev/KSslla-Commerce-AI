import { sql } from "drizzle-orm";

import type { Database } from "@/db/client";

export type Transaction = Parameters<Parameters<Database["transaction"]>[0]>[0];

/**
 * Runs a unit of work inside a transaction that carries tenant context for RLS.
 *
 * Both settings are transaction-local (`set_config(..., true)`), so pooled
 * connections cannot leak one tenant's context to another request.
 */
export async function withTenantTransaction<T>(
  db: Database,
  scope: { userId?: string | null; organizationId?: string | null },
  work: (tx: Transaction) => Promise<T>,
): Promise<T> {
  return db.transaction(async (tx) => {
    if (scope.userId) {
      await tx.execute(sql`select set_config('app.current_user', ${scope.userId}, true)`);
    }
    if (scope.organizationId) {
      await tx.execute(sql`select set_config('app.current_org', ${scope.organizationId}, true)`);
    }
    return work(tx);
  });
}

/**
 * Resolves an OAuth state before the tenant is known.
 *
 * Only the row whose hash matches the transaction-local setting is visible
 * (see the oauth_states RLS policy), so this cannot be used to browse states.
 */
export async function withOAuthStateLookup<T>(
  db: Database,
  stateHash: string,
  work: (tx: Transaction) => Promise<T>,
): Promise<T> {
  return db.transaction(async (tx) => {
    await tx.execute(sql`select set_config('app.oauth_state_hash', ${stateHash}, true)`);
    return work(tx);
  });
}

/** Sets the organization after it has been created inside the same transaction. */
export async function bindOrganization(tx: Transaction, organizationId: string): Promise<void> {
  await tx.execute(sql`select set_config('app.current_org', ${organizationId}, true)`);
}
