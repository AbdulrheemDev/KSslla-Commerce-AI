import { AppError } from "@/lib/errors";
import {
  hasPermission,
  outranks,
  type MembershipRole,
  type Permission,
} from "@/modules/identity/domain/permissions";
import type { TenantContext } from "@/modules/identity/application/types";

/**
 * Authorization primitives shared by route handlers, server components and use
 * cases. Every tenant-scoped write must call one of these inside the use case;
 * route-level guards alone are not sufficient because use cases are reusable.
 */

export function hasTenantPermission(context: TenantContext, permission: Permission): boolean {
  return hasPermission(context.role, permission);
}

export function assertPermission(context: TenantContext, permission: Permission): void {
  if (!hasTenantPermission(context, permission)) {
    throw new AppError({
      code: "FORBIDDEN",
      message: "You do not have permission to perform this action.",
      details: { permission },
    });
  }
}

export function assertRole(context: TenantContext, allowed: readonly MembershipRole[]): void {
  if (!allowed.includes(context.role)) {
    throw new AppError({
      code: "FORBIDDEN",
      message: "Your role does not allow this action.",
    });
  }
}

/** True when the actor may manage a member holding `targetRole`. */
export function canManageRole(actor: MembershipRole, target: MembershipRole): boolean {
  return outranks(actor, target);
}

/** True when the actor may grant `role`. Ownership transfer is always explicit. */
export function canAssignRole(actor: MembershipRole, role: MembershipRole): boolean {
  return role !== "owner" && outranks(actor, role);
}
