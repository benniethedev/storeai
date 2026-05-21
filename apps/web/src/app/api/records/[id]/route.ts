import { and, eq, sql } from "drizzle-orm";
import { getDb, records } from "@storeai/db";
import { updateRecordSchema, MAX_RECORD_DATA_BYTES } from "@storeai/shared";
import { AppError, NotFoundError } from "@storeai/shared/errors";
import { ok } from "@/lib/http";
import { tenantRoute } from "@/lib/routeHelpers";
import { writeAuditLog } from "@/lib/context";
import { expectedRecordVersion, VersionConflictError } from "@/lib/recordVersion";
import { writeEvent } from "@/lib/events";

export const runtime = "nodejs";

class RecordTooLargeError extends AppError {
  constructor(limit: number) {
    super(
      413,
      "record_too_large",
      `Record data exceeds the maximum allowed size of ${limit} bytes`,
    );
  }
}

function assertRecordDataSize(data: unknown): void {
  if (data === undefined) return;
  const serialized = JSON.stringify(data);
  if (Buffer.byteLength(serialized, "utf8") > MAX_RECORD_DATA_BYTES) {
    throw new RecordTooLargeError(MAX_RECORD_DATA_BYTES);
  }
}

export const GET = tenantRoute<{ id: string }>({ requiredScope: "records:read" }, async ({ ctx, params }) => {
  const db = getDb();
  const rows = await db
    .select()
    .from(records)
    .where(and(eq(records.tenantId, ctx.tenantId), eq(records.id, params.id)))
    .limit(1);
  if (!rows[0]) throw new NotFoundError();
  return ok(rows[0]);
});

export const PATCH = tenantRoute<{ id: string }>({ requiredScope: "records:write" }, async ({ req, ctx, params }) => {
  const body = await req.json();
  const input = updateRecordSchema.parse(body);
  assertRecordDataSize(input.data);
  const expectedVersion = expectedRecordVersion(req);
  const db = getDb();
  const patch: Record<string, unknown> = {
    updatedAt: new Date(),
    version: sql`${records.version} + 1`,
  };
  if (input.key !== undefined) patch.key = input.key;
  if (input.data !== undefined) patch.data = input.data;
  const conds = [eq(records.tenantId, ctx.tenantId), eq(records.id, params.id)];
  if (expectedVersion !== null) conds.push(eq(records.version, expectedVersion));
  const rows = await db
    .update(records)
    .set(patch)
    .where(and(...conds))
    .returning();
  if (!rows[0]) {
    if (expectedVersion !== null) throw new VersionConflictError();
    throw new NotFoundError();
  }
  await writeAuditLog({
    ctx,
    action: "record.update",
    resourceType: "record",
    resourceId: params.id,
    metadata: input,
  });
  await writeEvent({
    ctx,
    type: "record.updated",
    resourceType: "record",
    resourceId: params.id,
    projectId: rows[0].projectId,
    payload: { key: rows[0].key, version: rows[0].version },
  });
  return ok(rows[0]);
});

export const DELETE = tenantRoute<{ id: string }>({ requiredScope: "records:write" }, async ({ ctx, params }) => {
  const db = getDb();
  const rows = await db
    .delete(records)
    .where(and(eq(records.tenantId, ctx.tenantId), eq(records.id, params.id)))
    .returning({ id: records.id, projectId: records.projectId, key: records.key });
  if (!rows[0]) throw new NotFoundError();
  await writeAuditLog({
    ctx,
    action: "record.delete",
    resourceType: "record",
    resourceId: params.id,
  });
  await writeEvent({
    ctx,
    type: "record.deleted",
    resourceType: "record",
    resourceId: params.id,
    projectId: rows[0].projectId,
    payload: { key: rows[0].key },
  });
  return ok({ deleted: true });
});
