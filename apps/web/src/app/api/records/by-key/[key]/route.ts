import { and, eq, sql } from "drizzle-orm";
import { getDb, records, projects } from "@storeai/db";
import { createRecordSchema, updateRecordSchema, MAX_RECORD_DATA_BYTES } from "@storeai/shared";
import { AppError, NotFoundError } from "@storeai/shared/errors";
import { ok } from "@/lib/http";
import { tenantRoute } from "@/lib/routeHelpers";
import { writeAuditLogSafe } from "@/lib/context";
import { enqueueAuditFanout } from "@storeai/queue";
import { redisSafe } from "@/lib/redisSafe";
import { expectedRecordVersion, VersionConflictError } from "@/lib/recordVersion";
import { writeEventSafe } from "@/lib/events";
import { z } from "zod";

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

class InvalidJsonError extends AppError {
  constructor(details: { prefix: string; length: number }) {
    super(
      400,
      "invalid_json",
      `Request body must be valid JSON (length ${details.length}, prefix ${JSON.stringify(details.prefix)})`,
      details,
    );
  }
}

async function parseJsonBody(req: Request): Promise<unknown> {
  const rawBody = await req.text();
  try {
    return rawBody ? JSON.parse(rawBody) : null;
  } catch {
    throw new InvalidJsonError({
      prefix: rawBody.slice(0, 80),
      length: Buffer.byteLength(rawBody, "utf8"),
    });
  }
}

function assertRecordDataSize(data: unknown): void {
  if (data === undefined) return;
  const serialized = JSON.stringify(data);
  if (Buffer.byteLength(serialized, "utf8") > MAX_RECORD_DATA_BYTES) {
    throw new RecordTooLargeError(MAX_RECORD_DATA_BYTES);
  }
}

function auditRecordUpdate(input: { key?: string; data?: unknown }) {
  return {
    ...(input.key !== undefined ? { key: input.key } : {}),
    dataUpdated: input.data !== undefined,
    dataBytes:
      input.data === undefined
        ? 0
        : Buffer.byteLength(JSON.stringify(input.data), "utf8"),
  };
}

async function assertProjectInTenant(tenantId: string, projectId: string) {
  const db = getDb();
  const rows = await db
    .select({ id: projects.id, integrityMode: projects.integrityMode })
    .from(projects)
    .where(and(eq(projects.id, projectId), eq(projects.tenantId, tenantId)))
    .limit(1);
  if (!rows[0]) throw new NotFoundError("Project not found");
  return rows[0];
}

function optionalProjectId(req: Request): string | undefined {
  const value = new URL(req.url).searchParams.get("projectId");
  return z.string().uuid().optional().parse(value ?? undefined);
}

// GET /api/records/by-key/[key] - Retrieve a single record by its exact key
export const GET = tenantRoute<{ key: string }>({ requiredScope: "records:read" }, async ({ req, ctx, params }) => {
  const projectId = optionalProjectId(req);
  if (projectId) await assertProjectInTenant(ctx.tenantId, projectId);
  const db = getDb();
  const conditions = [eq(records.tenantId, ctx.tenantId), eq(records.key, params.key)];
  if (projectId) conditions.push(eq(records.projectId, projectId));
  else conditions.push(eq(records.strictIdentity, false));
  const rows = await db
    .select()
    .from(records)
    .where(and(...conditions))
    .limit(1);
  if (!rows[0]) throw new NotFoundError();
  return ok(rows[0]);
});

// PUT /api/records/by-key/[key] - Upsert: update if record exists, create if not
export const PUT = tenantRoute<{ key: string }>({ requiredScope: "records:write" }, async ({ req, ctx, params }) => {
  const body = await parseJsonBody(req);
  const projectId = optionalProjectId(req);
  if (projectId) await assertProjectInTenant(ctx.tenantId, projectId);
  const db = getDb();

  // Check for existing record with this key in the tenant
  const lookupConditions = [eq(records.tenantId, ctx.tenantId), eq(records.key, params.key)];
  if (projectId) lookupConditions.push(eq(records.projectId, projectId));
  else lookupConditions.push(eq(records.strictIdentity, false));
  const existing = await db
    .select()
    .from(records)
    .where(and(...lookupConditions))
    .limit(1);

  if (existing[0]) {
    if (existing[0].immutable) {
      throw new AppError(409, "immutable_record", "Immutable records cannot be updated");
    }
    // Update existing record
    const input = updateRecordSchema.parse(body);
    assertRecordDataSize(input.data);
    const expectedVersion = expectedRecordVersion(req);

    const patch: Record<string, unknown> = {
      updatedAt: new Date(),
      version: sql`${records.version} + 1`,
    };
    if (input.key !== undefined) patch.key = input.key;
    if (input.data !== undefined) patch.data = input.data;
    const conds = [eq(records.tenantId, ctx.tenantId), eq(records.id, existing[0].id)];
    if (expectedVersion !== null) conds.push(eq(records.version, expectedVersion));

    const rows = await db
      .update(records)
      .set(patch)
      .where(and(...conds))
      .returning();
    if (!rows[0]) throw new VersionConflictError();

    await writeAuditLogSafe({
      ctx,
      action: "record.update",
      resourceType: "record",
      resourceId: existing[0].id,
      metadata: auditRecordUpdate(input),
    });
    await writeEventSafe({
      ctx,
      type: "record.updated",
      resourceType: "record",
      resourceId: rows[0]!.id,
      projectId: rows[0]!.projectId,
      payload: { key: rows[0]!.key, version: rows[0]!.version },
    });

    return ok(rows[0]);
  } else {
    // Create new record
    const input = createRecordSchema.parse(body);
    assertRecordDataSize(input.data);
    if (projectId && input.projectId !== projectId) {
      throw new AppError(400, "project_mismatch", "Project in query does not match request body");
    }
    const targetProject = await assertProjectInTenant(ctx.tenantId, input.projectId);

    // Validate key consistency if provided in body
    if (input.key !== undefined && input.key !== params.key) {
      throw new AppError(400, "key_mismatch", "Key in path does not match key in request body");
    }

    const insert = db
      .insert(records)
      .values({
        tenantId: ctx.tenantId,
        projectId: input.projectId,
        key: params.key, // Use path key for consistency
        data: input.data,
        immutable: input.immutable,
        createdByUserId: ctx.user?.id ?? null,
        createdByApiKeyId: ctx.apiKeyId,
      });
    const inserted = targetProject.integrityMode === "strict"
      ? await insert
          .onConflictDoNothing({
            target: [records.tenantId, records.projectId, records.key],
            where: eq(records.strictIdentity, true),
          })
          .returning()
      : await insert.returning();
    const row = inserted[0];

    if (!row) {
      throw new AppError(
        409,
        "concurrent_record_change",
        "Record was created concurrently; retry with its current version",
      );
    }

    const auditId = await writeAuditLogSafe({
      ctx,
      action: "record.create",
      resourceType: "record",
      resourceId: row.id,
      metadata: { key: row.key, projectId: row.projectId },
    });

    if (auditId) {
      await redisSafe(
        () => enqueueAuditFanout({ tenantId: ctx.tenantId, auditLogId: auditId, action: "record.create" }),
        null,
        "enqueue:audit-fanout",
      );
    }
    await writeEventSafe({
      ctx,
      type: "record.created",
      resourceType: "record",
      resourceId: row.id,
      projectId: row.projectId,
      payload: { key: row.key, version: row.version },
    });

    return ok(row);
  }
});
