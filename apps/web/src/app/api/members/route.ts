import { and, eq } from "drizzle-orm";
import { getDb, memberships, users } from "@storeai/db";
import { inviteMemberSchema } from "@storeai/shared";
import { ConflictError, ForbiddenError, NotFoundError } from "@storeai/shared/errors";
import { ok } from "@/lib/http";
import { tenantRoute } from "@/lib/routeHelpers";
import { writeAuditLog } from "@/lib/context";

export const runtime = "nodejs";

export const GET = tenantRoute({ requireRole: "admin" }, async ({ ctx }) => {
  const db = getDb();
  const rows = await db
    .select({
      membershipId: memberships.id,
      userId: users.id,
      email: users.email,
      name: users.name,
      role: memberships.role,
      createdAt: memberships.createdAt,
    })
    .from(memberships)
    .innerJoin(users, eq(users.id, memberships.userId))
    .where(eq(memberships.tenantId, ctx.tenantId));
  return ok(rows);
});

export const POST = tenantRoute({ requireRole: "admin" }, async ({ req, ctx }) => {
  const body = await req.json();
  const input = inviteMemberSchema.parse(body);
  if (input.role === "owner" && ctx.role !== "owner") {
    throw new ForbiddenError("Only owners can grant owner role");
  }
  const db = getDb();
  const user = await db.select().from(users).where(eq(users.email, input.email)).limit(1);
  if (!user[0])
    throw new NotFoundError("User does not exist — invites not supported in v1, ask them to sign up first");
  const existing = await db
    .select()
    .from(memberships)
    .where(and(eq(memberships.userId, user[0].id), eq(memberships.tenantId, ctx.tenantId)))
    .limit(1);
  if (existing[0]) throw new ConflictError("User already a member");
  const [m] = await db
    .insert(memberships)
    .values({ userId: user[0].id, tenantId: ctx.tenantId, role: input.role })
    .returning();
  await writeAuditLog({
    ctx,
    action: "member.add",
    resourceType: "membership",
    resourceId: m!.id,
    metadata: { email: input.email, role: input.role },
  });
  return ok({ id: m!.id, userId: user[0].id, email: user[0].email, role: input.role });
});
