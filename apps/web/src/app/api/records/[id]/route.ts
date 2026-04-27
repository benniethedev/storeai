import { and, eq } from "drizzle-orm";
import { getDb, records } from "@storeai/db";
import { updateRecordSchema, MAX_RECORD_DATA_BYTES } from "@storeai/shared";
import { AppError, NotFoundError } from "@storeai/shared/errors";
import { ok } from "@/lib/http";
import { tenantRoute } from "@/lib/routeHelpers";
import { writeAuditLog } from "@/lib/context";

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
  assertRecordDataSize(input.data);
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
