import { and, eq } from "drizzle-orm";
import { getDb, projects } from "@storeai/db";
import { updateProjectSchema } from "@storeai/shared";
import { NotFoundError } from "@storeai/shared/errors";
import { ok } from "@/lib/http";
import { tenantRoute } from "@/lib/routeHelpers";
import { writeAuditLog } from "@/lib/context";

export const runtime = "nodejs";

export const GET = tenantRoute<{ id: string }>({}, async ({ ctx, params }) => {
  const db = getDb();
  const rows = await db
    .select()
    .from(projects)
    .where(and(eq(projects.tenantId, ctx.tenantId), eq(projects.id, params.id)))
    .limit(1);
  if (!rows[0]) throw new NotFoundError();
  return ok(rows[0]);
});

export const PATCH = tenantRoute<{ id: string }>({}, async ({ req, ctx, params }) => {
  const body = await req.json();
  const input = updateProjectSchema.parse(body);
  const db = getDb();
  const patch: Record<string, unknown> = { updatedAt: new Date() };
  if (input.name !== undefined) patch.name = input.name;
  if (input.slug !== undefined) patch.slug = input.slug;
  if (input.description !== undefined) patch.description = input.description;
  const rows = await db
    .update(projects)
    .set(patch)
    .where(and(eq(projects.tenantId, ctx.tenantId), eq(projects.id, params.id)))
    .returning();
  if (!rows[0]) throw new NotFoundError();
  await writeAuditLog({
    ctx,
    action: "project.update",
    resourceType: "project",
    resourceId: params.id,
    metadata: input,
  });
  return ok(rows[0]);
});

export const DELETE = tenantRoute<{ id: string }>({}, async ({ ctx, params }) => {
  const db = getDb();
  const rows = await db
    .delete(projects)
    .where(and(eq(projects.tenantId, ctx.tenantId), eq(projects.id, params.id)))
    .returning({ id: projects.id });
  if (!rows[0]) throw new NotFoundError();
  await writeAuditLog({
    ctx,
    action: "project.delete",
    resourceType: "project",
    resourceId: params.id,
  });
  return ok({ deleted: true });
});
