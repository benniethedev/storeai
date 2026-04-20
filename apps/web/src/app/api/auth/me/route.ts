import { NextRequest } from "next/server";
import { eq } from "drizzle-orm";
import { getDb, memberships, tenants } from "@storeai/db";
import { getUserSessionFromRequest } from "@/lib/context";
import { ok } from "@/lib/http";

export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  const s = await getUserSessionFromRequest(req);
  if (!s) return ok({ user: null, tenants: [], activeTenantId: null });
  const db = getDb();
  const rows = await db
    .select({
      tenantId: tenants.id,
      slug: tenants.slug,
      name: tenants.name,
      role: memberships.role,
    })
    .from(memberships)
    .innerJoin(tenants, eq(tenants.id, memberships.tenantId))
    .where(eq(memberships.userId, s.user.id));
  return ok({
    user: { id: s.user.id, email: s.user.email, name: s.user.name, isPlatformAdmin: s.user.isPlatformAdmin },
    tenants: rows,
    activeTenantId: s.session.activeTenantId,
    csrfToken: s.session.csrfToken,
  });
}
