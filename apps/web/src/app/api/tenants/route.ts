import { eq } from "drizzle-orm";
import { getDb, tenants, memberships } from "@storeai/db";
import { createTenantSchema } from "@storeai/shared";
import { ConflictError } from "@storeai/shared/errors";
import { ok } from "@/lib/http";
import { userRoute } from "@/lib/routeHelpers";

export const runtime = "nodejs";

export const GET = userRoute(async ({ user }) => {
  const db = getDb();
  const rows = await db
    .select({ id: tenants.id, slug: tenants.slug, name: tenants.name, role: memberships.role })
    .from(memberships)
    .innerJoin(tenants, eq(tenants.id, memberships.tenantId))
    .where(eq(memberships.userId, user.user.id));
  return ok(rows);
});

export const POST = userRoute(async ({ req, user }) => {
  const body = await req.json();
  const input = createTenantSchema.parse(body);
  const db = getDb();
  const existing = await db.select().from(tenants).where(eq(tenants.slug, input.slug)).limit(1);
  if (existing[0]) throw new ConflictError("Tenant slug already taken");
  const [t] = await db.insert(tenants).values({ slug: input.slug, name: input.name }).returning();
  if (!t) throw new Error("failed to create tenant");
  await db.insert(memberships).values({ userId: user.user.id, tenantId: t.id, role: "owner" });
  return ok({ id: t.id, slug: t.slug, name: t.name, role: "owner" });
});
