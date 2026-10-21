import type { MembershipRole, Permission } from "@/modules/identity/domain/permissions";
import type { SessionRecord, UserRecord } from "@/modules/identity/infrastructure/repositories";
import type {
  MembershipRecord,
  OrganizationRecord,
} from "@/modules/organizations/infrastructure/repositories";

/** Request-scoped facts that may be logged. Never includes raw IP or secrets. */
export interface RequestMeta {
  ipHash: string | null;
  userAgent: string | null;
  requestId: string | null;
}

/** An authenticated session before an organization is selected. */
export interface AuthSession {
  user: UserRecord;
  session: SessionRecord;
  membership: MembershipRecord | null;
  organization: OrganizationRecord | null;
}

/**
 * The tenant context used by authorization checks.
 *
 * Derived exclusively from the session cookie: user → active membership →
 * role → permissions. No value here is ever taken from the request body.
 */
export interface TenantContext {
  userId: string;
  organizationId: string;
  membershipId: string;
  role: MembershipRole;
  permissions: Permission[];
  user: { id: string; email: string; name: string };
  organization: { id: string; name: string; slug: string };
  sessionId: string;
  requestId: string | null;
}
