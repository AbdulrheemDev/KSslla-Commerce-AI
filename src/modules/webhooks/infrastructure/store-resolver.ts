import { sql } from "drizzle-orm";

import type { Database } from "@/db/client";

/**
 * Provider store id → internal tenant ids.
 *
 * This is the only trusted path from a webhook body to a tenant: the `merchant`
 * value in the envelope is looked up in `store_connections`, which was written
 * by a completed OAuth flow. Nothing else in the payload — no store id, no
 * organization id, no e-mail — is used for resolution (ADR-046).
 *
 * The lookup goes through `app.resolve_salla_store`, a `SECURITY DEFINER`
 * function that returns ids and connection status only.
 */

export interface ResolvedStore {
  organizationId: string;
  storeId: string;
  connectionStatus: string;
}

export async function resolveStoreByExternalId(
  db: Database,
  externalStoreId: string,
): Promise<ResolvedStore | null> {
  if (!externalStoreId.trim()) return null;

  const rows = (await db.execute(
    sql`select organization_id, store_id, connection_status from app.resolve_salla_store(${externalStoreId})`,
  )) as unknown as Array<{
    organization_id: string | null;
    store_id: string | null;
    connection_status: string | null;
  }>;

  const row = rows[0];
  if (!row || !row.organization_id || !row.store_id) return null;

  return {
    organizationId: row.organization_id,
    storeId: row.store_id,
    connectionStatus: row.connection_status ?? "unknown",
  };
}
