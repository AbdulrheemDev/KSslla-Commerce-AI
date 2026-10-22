import type { Database } from "@/db/client";
import { withTenantTransaction } from "@/db/tenant";
import type { TenantContext } from "@/modules/identity/application/types";
import { assertPermission } from "@/modules/identity/application/authorization";
import { auditLogs } from "@/db/schema";
import { desc, eq } from "drizzle-orm";

export interface AuditLogView {
  id: string;
  action: string;
  actorUserId: string | null;
  entityType: string | null;
  entityId: string | null;
  metadata: Record<string, unknown>;
  createdAt: string;
}

export async function listAuditLogs(
  db: Database,
  context: TenantContext,
  limit = 100,
): Promise<AuditLogView[]> {
  assertPermission(context, "audit:read");

  const rows = await withTenantTransaction(
    db,
    { userId: context.userId, organizationId: context.organizationId },
    (tx) =>
      tx
        .select()
        .from(auditLogs)
        .where(eq(auditLogs.organizationId, context.organizationId))
        .orderBy(desc(auditLogs.createdAt))
        .limit(Math.min(Math.max(limit, 1), 200)),
  );

  return rows.map((row) => ({
    id: row.id,
    action: row.action,
    actorUserId: row.actorUserId,
    entityType: row.entityType,
    entityId: row.entityId,
    metadata: row.metadata,
    createdAt: row.createdAt.toISOString(),
  }));
}
