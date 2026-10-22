import { z } from "zod";

import { isValidEmail } from "@/modules/identity/domain/identifiers";
import { MEMBERSHIP_ROLES } from "@/modules/identity/domain/permissions";

const email = z
  .string()
  .trim()
  .toLowerCase()
  .max(254)
  .refine(isValidEmail, "Invalid email address.");
const name = z.string().trim().min(1).max(120);

export const registerSchema = z.object({
  email,
  password: z.string().min(1).max(128),
  name,
  organizationName: name,
  storeName: name.optional(),
});

export const loginSchema = z.object({
  email,
  password: z.string().min(1).max(128),
});

export const inviteSchema = z.object({
  email,
  role: z.enum(MEMBERSHIP_ROLES),
});

export const changeRoleSchema = z.object({
  role: z.enum(MEMBERSHIP_ROLES),
});

export const createStoreSchema = z.object({
  name,
});

export const acceptInvitationSchema = z.object({
  token: z.string().min(20).max(200),
});

export const organizationSettingsSchema = z.object({
  name,
});

export const switchOrganizationSchema = z.object({
  organizationId: z.uuid(),
});
