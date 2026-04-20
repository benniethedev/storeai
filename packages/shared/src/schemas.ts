import { z } from "zod";

export const emailSchema = z.string().trim().toLowerCase().email().max(254);
export const passwordSchema = z.string().min(8).max(256);
export const slugSchema = z
  .string()
  .trim()
  .toLowerCase()
  .min(2)
  .max(60)
  .regex(/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/, "Invalid slug");
export const nameSchema = z.string().trim().min(1).max(120);

export const signupSchema = z.object({
  email: emailSchema,
  password: passwordSchema,
  name: nameSchema,
  tenantName: nameSchema,
  tenantSlug: slugSchema,
});

export const loginSchema = z.object({
  email: emailSchema,
  password: passwordSchema,
});

export const createTenantSchema = z.object({
  name: nameSchema,
  slug: slugSchema,
});

export const createApiKeySchema = z.object({
  name: z.string().trim().min(1).max(80),
});

export const createProjectSchema = z.object({
  name: nameSchema,
  slug: slugSchema,
  description: z.string().trim().max(1000).optional().nullable(),
});

export const updateProjectSchema = createProjectSchema.partial();

export const createRecordSchema = z.object({
  projectId: z.string().uuid(),
  key: z.string().trim().min(1).max(120),
  data: z.record(z.string(), z.unknown()),
});

export const updateRecordSchema = z.object({
  key: z.string().trim().min(1).max(120).optional(),
  data: z.record(z.string(), z.unknown()).optional(),
});

export const paginationSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
  sort: z.enum(["created_at", "-created_at", "updated_at", "-updated_at"]).default("-created_at"),
});

export const inviteMemberSchema = z.object({
  email: emailSchema,
  role: z.enum(["owner", "admin", "member"]).default("member"),
});

export const updateMemberRoleSchema = z.object({
  role: z.enum(["owner", "admin", "member"]),
});
