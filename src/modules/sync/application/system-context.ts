import { PERMISSIONS } from "@/modules/identity/domain/permissions";
import type { TenantContext } from "@/modules/identity/application/types";

/**
 * Tenant context for background work.
 *
 * The webhook worker is not a user: it acts for the organization that owns the
 * store, after the store was resolved from a verified provider identity. It
 * therefore carries every permission of the system, and no session.
 *
 * This context is only constructed inside the worker and never returned by an
 * HTTP route, so it cannot be used to answer a user request. Anything it does is
 * audited with `actorUserId = null` to keep "a person did this" and "the system
 * did this" distinguishable in the audit trail.
 */
export const SYSTEM_ACTOR_ID = "00000000-0000-0000-0000-000000000000";

export function systemTenantContext(organizationId: string): TenantContext {
  return {
    userId: SYSTEM_ACTOR_ID,
    organizationId,
    membershipId: SYSTEM_ACTOR_ID,
    role: "owner",
    permissions: [...PERMISSIONS],
    user: { id: SYSTEM_ACTOR_ID, email: "system@kshakha.invalid", name: "System" },
    organization: { id: organizationId, name: "", slug: "" },
    sessionId: SYSTEM_ACTOR_ID,
    requestId: null,
  };
}
