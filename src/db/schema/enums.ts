import { pgEnum } from "drizzle-orm/pg-core";

export const USER_STATUSES = ["active", "suspended", "deleted"] as const;
export const ORGANIZATION_STATUSES = ["active", "suspended"] as const;
export const MEMBER_ROLES = ["owner", "admin", "manager", "analyst", "viewer"] as const;
export const MEMBER_STATUSES = ["active", "invited", "removed"] as const;
export const STORE_PLATFORMS = ["salla"] as const;
export const STORE_STATUSES = ["not_connected", "connected", "disconnected"] as const;

export const userStatusEnum = pgEnum("user_status", USER_STATUSES);
export const organizationStatusEnum = pgEnum("organization_status", ORGANIZATION_STATUSES);
export const memberRoleEnum = pgEnum("member_role", MEMBER_ROLES);
export const memberStatusEnum = pgEnum("member_status", MEMBER_STATUSES);
export const storePlatformEnum = pgEnum("store_platform", STORE_PLATFORMS);
export const storeStatusEnum = pgEnum("store_status", STORE_STATUSES);

export type UserStatus = (typeof USER_STATUSES)[number];
export type OrganizationStatus = (typeof ORGANIZATION_STATUSES)[number];
export type MemberRole = (typeof MEMBER_ROLES)[number];
export type MemberStatus = (typeof MEMBER_STATUSES)[number];
export type StorePlatform = (typeof STORE_PLATFORMS)[number];
export type StoreStatus = (typeof STORE_STATUSES)[number];
