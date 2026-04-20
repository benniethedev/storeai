import { and, eq, sql } from "drizzle-orm";
import { getDb, memberships } from "@storeai/db";
import { updateMemberRoleSchema } from "@storeai/shared";
import { ConflictError, ForbiddenError, NotFoundError } from "@storeai/shared/errors";
import { ok } from "@/lib/http";
import { tenantRoute } from "@/lib/routeHelpers";
import { writeAuditLog } from "@/lib/context";

export const runtime = "nodejs";

async function countOwners(tenantId: string): Promise<number> {
  const db = getDb();
  const [row] = await db
    .select({ c: sql<number>`count(*)::int` })
    .from(memberships)
    .where(and(eq(memberships.tenantId, tenantId), eq(memberships.role, "owner")));
  return row?.c ?? 0;
}

async function loadTarget(tenantId: string, membershipId: string) {
  const db = getDb();
  const rows = await db
    .select()
    .from(memberships)
    .where(and(eq(memberships.id, membershipId), eq(memberships.tenantId, tenantId)))
    .limit(1);
  return rows[0] ?? null;
}

export const PATCH = tenantRoute<{ id: string }>(
  { requireRole: "admin" },
  async ({ req, ctx, params }) => {
    const body = await req.json();
    const input = updateMemberRoleSchema.parse(body);

    const target = await loadTarget(ctx.tenantId, params.id);
    if (!target) throw new NotFoundError();

    // Only owners can grant the owner role.
    if (input.role === "owner" && ctx.role !== "owner") {
      throw new ForbiddenError("Only owners can grant owner role");
    }
    // Only owners can modify an existing owner's membership.
    if (target.role === "owner" && ctx.role !== "owner") {
      throw new ForbiddenError("Only owners can change another owner's role");
    }
    // Don't let the last owner demote themselves.
    if (target.role === "owner" && input.role !== "owner") {
      const owners = await countOwners(ctx.tenantId);
      if (owners <= 1) throw new ConflictError("Cannot demote the last owner");
    }

    const db = getDb();
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
      metadata: { role: input.role, previousRole: target.role },
    });
    return ok(rows[0]);
  },
);

export const DELETE = tenantRoute<{ id: string }>(
  { requireRole: "admin" },
  async ({ ctx, params }) => {
    const target = await loadTarget(ctx.tenantId, params.id);
    if (!target) throw new NotFoundError();

    if (target.role === "owner" && ctx.role !== "owner") {
      throw new ForbiddenError("Only owners can remove another owner");
    }
    if (target.role === "owner") {
      const owners = await countOwners(ctx.tenantId);
      if (owners <= 1) throw new ConflictError("Cannot remove the last owner");
    }

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
      metadata: { previousRole: target.role },
    });
    return ok({ removed: true });
  },
);
