import { and, eq } from "drizzle-orm";
import { getDb, memberships } from "@storeai/db";
import { updateMemberRoleSchema } from "@storeai/shared";
import { NotFoundError, ForbiddenError } from "@storeai/shared/errors";
import { ok } from "@/lib/http";
import { tenantRoute } from "@/lib/routeHelpers";
import { writeAuditLog } from "@/lib/context";

export const runtime = "nodejs";

export const PATCH = tenantRoute<{ id: string }>(
  { requireRole: "admin" },
  async ({ req, ctx, params }) => {
    const body = await req.json();
    const input = updateMemberRoleSchema.parse(body);
    const db = getDb();
    // Role upgrade to owner requires owner role
    if (input.role === "owner" && ctx.role !== "owner")
      throw new ForbiddenError("Only owners can grant owner role");
    const rows = await db
      .update(memberships)
      .set({ role: input.role })
      .where(and(eq(memberships.id, params.id), eq(memberships.tenantId, ctx.tenantId)))
      .returning();
    if (!rows[0]) throw new NotFoundError();
    await writeAuditLog({
      ctx,
      action: "member.update_role",
      resourceType: "membership",
      resourceId: params.id,
      metadata: { role: input.role },
    });
    return ok(rows[0]);
  },
);

export const DELETE = tenantRoute<{ id: string }>(
  { requireRole: "admin" },
  async ({ ctx, params }) => {
    const db = getDb();
    const rows = await db
      .delete(memberships)
      .where(and(eq(memberships.id, params.id), eq(memberships.tenantId, ctx.tenantId)))
      .returning({ id: memberships.id });
    if (!rows[0]) throw new NotFoundError();
    await writeAuditLog({
      ctx,
      action: "member.remove",
      resourceType: "membership",
      resourceId: params.id,
    });
    return ok({ removed: true });
  },
);
