import { z } from "zod";

// Limits for clients (also documented in README/docs/API.md).
export const MAX_RECORD_DATA_BYTES = 1 * 1024 * 1024;
export const MAX_FILE_BYTES = 50 * 1024 * 1024;
export const MAX_RECORD_KEY_LENGTH = 120;
export const MAX_ATOMIC_OPERATIONS = 100;

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
  scopes: z
    .array(
      z.enum([
        "projects:read",
        "projects:write",
        "records:read",
        "records:write",
        "files:read",
        "files:write",
        "members:read",
        "audit:read",
        "usage:read",
        "realtime:connect",
      ]),
    )
    .optional(),
});

export const API_KEY_SCOPES = [
  "projects:read",
  "projects:write",
  "records:read",
  "records:write",
  "files:read",
  "files:write",
  "members:read",
  "audit:read",
  "usage:read",
  "realtime:connect",
] as const;

export type ApiKeyScope = (typeof API_KEY_SCOPES)[number];

export const createProjectSchema = z.object({
  name: nameSchema,
  slug: slugSchema,
  description: z.string().trim().max(1000).optional().nullable(),
  integrityMode: z.literal("strict").optional().default("strict"),
});

export const updateProjectSchema = createProjectSchema.omit({ integrityMode: true }).partial();

export const createRecordSchema = z.object({
  projectId: z.string().uuid(),
  key: z.string().trim().min(1).max(120),
  data: z.record(z.string(), z.unknown()),
  immutable: z.boolean().optional().default(false),
});

export const updateRecordSchema = z.object({
  key: z.string().trim().min(1).max(120).optional(),
  data: z.record(z.string(), z.unknown()).optional(),
});

const atomicRecordKeySchema = z.string().trim().min(1).max(MAX_RECORD_KEY_LENGTH);

export const atomicOperationSchema = z.discriminatedUnion("op", [
  z.object({
    op: z.literal("create"),
    key: atomicRecordKeySchema,
    data: z.record(z.string(), z.unknown()),
    ifAbsent: z.literal(true).optional().default(true),
    immutable: z.boolean().optional().default(false),
  }),
  z.object({
    op: z.literal("update"),
    key: atomicRecordKeySchema,
    data: z.record(z.string(), z.unknown()),
    expectedVersion: z.number().int().positive().optional(),
  }),
  z.object({
    op: z.literal("delete"),
    key: atomicRecordKeySchema,
    expectedVersion: z.number().int().positive().optional(),
  }),
]);

export const atomicOperationsSchema = z.object({
  projectId: z.string().uuid(),
  operations: z.array(atomicOperationSchema).min(1).max(MAX_ATOMIC_OPERATIONS),
});

export type AtomicOperation = z.infer<typeof atomicOperationSchema>;

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
