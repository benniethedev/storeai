import { and, eq } from "drizzle-orm";
import { getDb, records, projects } from "@storeai/db";
import { createRecordSchema, updateRecordSchema, MAX_RECORD_DATA_BYTES } from "@storeai/shared";
import { AppError, NotFoundError } from "@storeai/shared/errors";
import { ok } from "@/lib/http";
import { tenantRoute } from "@/lib/routeHelpers";
import { writeAuditLog } from "@/lib/context";
import { enqueueAuditFanout } from "@storeai/queue";
import { redisSafe } from "@/lib/redisSafe";

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

async function assertProjectInTenant(tenantId: string, projectId: string) {
  const db = getDb();
  const rows = await db
    .select({ id: projects.id })
    .from(projects)
    .where(and(eq(projects.id, projectId), eq(projects.tenantId, tenantId)))
    .limit(1);
  if (!rows[0]) throw new NotFoundError("Project not found");
}

// GET /api/records/by-key/[key] - Retrieve a single record by its exact key
export const GET = tenantRoute<{ key: string }>({}, async ({ ctx, params }) => {
  const db = getDb();
  const rows = await db
    .select()
    .from(records)
    .where(and(eq(records.tenantId, ctx.tenantId), eq(records.key, params.key)))
    .limit(1);
  if (!rows[0]) throw new NotFoundError();
  return ok(rows[0]);
});

// PUT /api/records/by-key/[key] - Upsert: update if record exists, create if not
export const PUT = tenantRoute<{ key: string }>({}, async ({ req, ctx, params }) => {
  const body = await req.json();
  const db = getDb();

  // Check for existing record with this key in the tenant
  const existing = await db
    .select()
    .from(records)
    .where(and(eq(records.tenantId, ctx.tenantId), eq(records.key, params.key)))
    .limit(1);

  if (existing[0]) {
    // Update existing record
    const input = updateRecordSchema.parse(body);
    assertRecordDataSize(input.data);

    const patch: Record<string, unknown> = { updatedAt: new Date() };
    if (input.key !== undefined) patch.key = input.key;
    if (input.data !== undefined) patch.data = input.data;

    const rows = await db
      .update(records)
      .set(patch)
      .where(and(eq(records.tenantId, ctx.tenantId), eq(records.id, existing[0].id)))
      .returning();

    await writeAuditLog({
      ctx,
      action: "record.update",
      resourceType: "record",
      resourceId: existing[0].id,
      metadata: input,
    });

    return ok(rows[0]);
  } else {
    // Create new record
    const input = createRecordSchema.parse(body);
    assertRecordDataSize(input.data);
    await assertProjectInTenant(ctx.tenantId, input.projectId);

    // Validate key consistency if provided in body
    if (input.key !== undefined && input.key !== params.key) {
      throw new AppError(400, "key_mismatch", "Key in path does not match key in request body");
    }

    const [row] = await db
      .insert(records)
      .values({
        tenantId: ctx.tenantId,
        projectId: input.projectId,
        key: params.key, // Use path key for consistency
        data: input.data,
        createdByUserId: ctx.user?.id ?? null,
        createdByApiKeyId: ctx.apiKeyId,
      })
      .returning();

    if (!row) throw new Error("Failed to create record");

    const auditId = await writeAuditLog({
      ctx,
      action: "record.create",
      resourceType: "record",
      resourceId: row.id,
      metadata: { key: row.key, projectId: row.projectId },
    });

    await redisSafe(
      () => enqueueAuditFanout({ tenantId: ctx.tenantId, auditLogId: auditId, action: "record.create" }),
      null,
      "enqueue:audit-fanout",
    );

    return ok(row);
  }
});
