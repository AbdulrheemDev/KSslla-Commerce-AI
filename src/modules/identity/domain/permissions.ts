/**
 * Permission catalog and role matrix.
 *
 * Source of truth: docs/phase-02.md §4.2. Roles are ordered from most to least
 * privileged; the runtime matrix is the only authority used by authorization
 * checks, so adding a permission is a one-line change plus a documentation
 * update.
 */

export const MEMBERSHIP_ROLES = ["owner", "admin", "manager", "analyst", "viewer"] as const;

export type MembershipRole = (typeof MEMBERSHIP_ROLES)[number];

export const PERMISSIONS = [
  "organization:read",
  "organization:update",
  "store:read",
  "store:connect",
  "store:disconnect",
  "store:sync",
  "member:read",
  "member:invite",
  "member:remove",
  "role:update",
  "audit:read",
  "recommendation:read",
  "recommendation:decide",
  "action:approve:low",
  "action:approve:high",
  "billing:manage",
] as const;

export type Permission = (typeof PERMISSIONS)[number];

const ALL: readonly Permission[] = PERMISSIONS;

export const ROLE_PERMISSIONS: Record<MembershipRole, readonly Permission[]> = {
  owner: ALL,
  admin: ALL.filter((permission) => permission !== "billing:manage"),
  manager: [
    "organization:read",
    "store:read",
    "store:sync",
    "member:read",
    "recommendation:read",
    "recommendation:decide",
    "action:approve:low",
  ],
  analyst: ["organization:read", "store:read", "recommendation:read"],
  viewer: ["organization:read", "store:read"],
};

/** Higher number = more authority. Used for anti-escalation checks. */
export const ROLE_RANK: Record<MembershipRole, number> = {
  owner: 5,
  admin: 4,
  manager: 3,
  analyst: 2,
  viewer: 1,
};

export const ROLE_LABELS_AR: Record<MembershipRole, string> = {
  owner: "المالك",
  admin: "مسؤول",
  manager: "مدير",
  analyst: "محلل",
  viewer: "مشاهد",
};

export function isMembershipRole(value: unknown): value is MembershipRole {
  return typeof value === "string" && (MEMBERSHIP_ROLES as readonly string[]).includes(value);
}

export function permissionsForRole(role: MembershipRole): Permission[] {
  return [...ROLE_PERMISSIONS[role]];
}

export function hasPermission(role: MembershipRole, permission: Permission): boolean {
  return ROLE_PERMISSIONS[role].includes(permission);
}

export function outranks(actor: MembershipRole, target: MembershipRole): boolean {
  return ROLE_RANK[actor] > ROLE_RANK[target];
}
