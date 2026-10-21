import type { Database } from "@/db/client";
import { withTenantTransaction } from "@/db/tenant";
import { recordAudit } from "@/modules/audit/infrastructure/audit-repository";
import type { RequestMeta, TenantContext } from "@/modules/identity/application/types";
import { assertPermission } from "@/modules/identity/application/authorization";
import {
  listActiveMemberships,
  updateOrganizationName,
} from "@/modules/organizations/infrastructure/repositories";
import { listStoresForOrganization } from "@/modules/stores/infrastructure/store-repository";
import { AppError } from "@/lib/errors";

export interface OrganizationOverview {
  organization: { id: string; name: string; slug: string };
  role: string;
  memberCount: number | null;
  stores: Array<{
    id: string;
    name: string;
    platform: string;
    status: string;
  }>;
}

export async function getOrganizationOverview(
  db: Database,
  context: TenantContext,
): Promise<OrganizationOverview> {
  const { members, stores } = await withTenantTransaction(
    db,
    { userId: context.userId, organizationId: context.organizationId },
    async (tx) => {
      const memberships = context.permissions.includes("member:read")
        ? await listActiveMemberships(tx, context.organizationId)
        : [];
      const storeRows = await listStoresForOrganization(tx, context.organizationId);
      return { members: memberships, stores: storeRows };
    },
  );

  return {
    organization: {
      id: context.organization.id,
      name: context.organization.name,
      slug: context.organization.slug,
    },
    role: context.role,
    memberCount: context.permissions.includes("member:read") ? members.length : null,
    stores: stores.map((store) => ({
      id: store.id,
      name: store.name,
      platform: store.platform,
      status: store.status,
    })),
  };
}

export async function renameOrganization(
  db: Database,
  context: TenantContext,
  name: string,
  meta: RequestMeta,
): Promise<void> {
  assertPermission(context, "organization:update");

  const nextName = name.trim();
  if (!nextName || nextName.length > 120) {
    throw new AppError({
      code: "VALIDATION_FAILED",
      message: "Invalid organization name.",
      details: { field: "name" },
    });
  }

  await withTenantTransaction(
    db,
    { userId: context.userId, organizationId: context.organizationId },
    async (tx) => {
      const updated = await updateOrganizationName(tx, context.organizationId, nextName);
      if (!updated) {
        throw new AppError({ code: "NOT_FOUND", message: "Organization not found." });
      }

      await recordAudit(tx, {
        organizationId: context.organizationId,
        actorUserId: context.userId,
        action: "organization.updated",
        entityType: "organization",
        entityId: context.organizationId,
        metadata: {},
        ipHash: meta.ipHash,
        userAgent: meta.userAgent,
        requestId: meta.requestId,
      });
    },
  );
}
