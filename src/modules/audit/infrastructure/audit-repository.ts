import type { DbExecutor } from "@/db/executor";
import { auditLogs } from "@/db/schema";

export const AUDIT_ACTIONS = [
  "user.registered",
  "user.login",
  "user.login_failed",
  "user.logout",
  "organization.created",
  "organization.updated",
  "member.invited",
  "member.accepted",
  "member.role_changed",
  "member.removed",
  "store.created",
  "session.revoked",
  "salla.authorization.started",
  "salla.authorization.succeeded",
  "salla.authorization.failed",
  "salla.connection.created",
  "salla.connection.updated",
  "salla.connection.disconnected",
  "salla.token.refreshed",
  "salla.token.refresh_failed",
  "salla.products.sync_started",
  "salla.products.sync_completed",
  "salla.products.sync_failed",
  "salla.categories.sync_started",
  "salla.categories.sync_completed",
  "salla.categories.sync_failed",
] as const;

export type AuditAction = (typeof AUDIT_ACTIONS)[number];

export interface AuditEvent {
  organizationId: string | null;
  actorUserId: string | null;
  action: AuditAction;
  entityType?: string | null;
  entityId?: string | null;
  metadata?: Record<string, unknown>;
  ipHash?: string | null;
  userAgent?: string | null;
  requestId?: string | null;
}

/**
 * Appends an audit row. Callers must never pass passwords, raw tokens, API
 * keys, or unnecessary personal data in `metadata`.
 */
export async function recordAudit(db: DbExecutor, event: AuditEvent): Promise<void> {
  await db.insert(auditLogs).values({
    organizationId: event.organizationId,
    actorUserId: event.actorUserId,
    action: event.action,
    entityType: event.entityType ?? null,
    entityId: event.entityId ?? null,
    metadata: event.metadata ?? {},
    ipHash: event.ipHash ?? null,
    userAgent: event.userAgent ?? null,
    requestId: event.requestId ?? null,
  });
}
