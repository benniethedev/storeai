import { and, eq } from "drizzle-orm";
import { getDb, records } from "@storeai/db";
import { updateRecordSchema } from "@storeai/shared";
import { NotFoundError } from "@storeai/shared/errors";
import { ok } from "@/lib/http";
import { tenantRoute } from "@/lib/routeHelpers";
import { writeAuditLog } from "@/lib/context";

export const runtime = "nodejs";

export const GET = tenantRoute<{ id: string }>({}, async ({ ctx, params }) => {
  const db = getDb();
  const rows = await db
    .select()
    .from(records)
    .where(and(eq(records.tenantId, ctx.tenantId), eq(records.id, params.id)))
    .limit(1);
  if (!rows[0]) throw new NotFoundError();
  return ok(rows[0]);
});

export const PATCH = tenantRoute<{ id: string }>({}, async ({ req, ctx, params }) => {
  const body = await req.json();
  const input = updateRecordSchema.parse(body);
  const db = getDb();
  const patch: Record<string, unknown> = { updatedAt: new Date() };
  if (input.key !== undefined) patch.key = input.key;
  if (input.data !== undefined) patch.data = input.data;
  const rows = await db
    .update(records)
    .set(patch)
    .where(and(eq(records.tenantId, ctx.tenantId), eq(records.id, params.id)))
    .returning();
  if (!rows[0]) throw new NotFoundError();
  await writeAuditLog({
    ctx,
    action: "record.update",
    resourceType: "record",
    resourceId: params.id,
    metadata: input,
  });
  return ok(rows[0]);
});

export const DELETE = tenantRoute<{ id: string }>({}, async ({ ctx, params }) => {
  const db = getDb();
  const rows = await db
    .delete(records)
    .where(and(eq(records.tenantId, ctx.tenantId), eq(records.id, params.id)))
    .returning({ id: records.id });
  if (!rows[0]) throw new NotFoundError();
  await writeAuditLog({
    ctx,
    action: "record.delete",
    resourceType: "record",
    resourceId: params.id,
  });
  return ok({ deleted: true });
});
