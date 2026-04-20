import { randomBytes } from "node:crypto";
import { sql } from "drizzle-orm";
import {
  getDb,
  users,
  tenants,
  memberships,
  projects,
  records,
  files,
  apiKeys,
  auditLogs,
  usageLogs,
  sessions,
} from "@storeai/db";
import { hashPassword, createSession, createApiKey } from "@storeai/auth";

export async function resetDb(): Promise<void> {
  const db = getDb();
  // Order matters only minimally given cascades; truncate for speed.
  await db.execute(sql`TRUNCATE
    ${usageLogs},
    ${auditLogs},
    ${files},
    ${records},
    ${projects},
    ${apiKeys},
    ${sessions},
    ${memberships},
    ${tenants},
    ${users}
    RESTART IDENTITY CASCADE`);
}

export function uniqueEmail(label = "u"): string {
  return `${label}-${randomBytes(4).toString("hex")}@test.local`;
}

export function uniqueSlug(label = "t"): string {
  return `${label}-${randomBytes(4).toString("hex")}`;
}

export async function createUserAndTenant(opts: {
  email?: string;
  password?: string;
  name?: string;
  tenantName?: string;
  tenantSlug?: string;
  role?: "owner" | "admin" | "member";
}) {
  const db = getDb();
  const email = (opts.email ?? uniqueEmail()).toLowerCase();
  const password = opts.password ?? "password1234";
  const passwordHash = await hashPassword(password);
  const [user] = await db
    .insert(users)
    .values({ email, passwordHash, name: opts.name ?? "Test User" })
    .returning();
  const [tenant] = await db
    .insert(tenants)
    .values({ slug: opts.tenantSlug ?? uniqueSlug(), name: opts.tenantName ?? "Test Workspace" })
    .returning();
  await db
    .insert(memberships)
    .values({ userId: user!.id, tenantId: tenant!.id, role: opts.role ?? "owner" });
  const session = await createSession({
    userId: user!.id,
    activeTenantId: tenant!.id,
    userAgent: "test",
    ip: "127.0.0.1",
  });
  return { user: user!, tenant: tenant!, password, session };
}

export async function addMember(args: {
  userId: string;
  tenantId: string;
  role?: "owner" | "admin" | "member";
}) {
  const db = getDb();
  await db
    .insert(memberships)
    .values({ userId: args.userId, tenantId: args.tenantId, role: args.role ?? "member" });
}

export async function createTenantApiKey(args: { tenantId: string; userId: string; name?: string }) {
  return createApiKey({
    tenantId: args.tenantId,
    createdByUserId: args.userId,
    name: args.name ?? "test-key",
  });
}
