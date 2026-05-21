import { desc, eq } from "drizzle-orm";
import { getDb, files } from "@storeai/db";
import {
  buildObjectKey,
  deleteObject,
  ensureBucket,
  putObject,
} from "@storeai/storage";
import { enqueueFilePostProcess } from "@storeai/queue";
import { z } from "zod";
import { ok } from "@/lib/http";
import { tenantRoute } from "@/lib/routeHelpers";
import { writeAuditLog } from "@/lib/context";
import { redisSafe } from "@/lib/redisSafe";
import { appHostedFileDownloadUrl } from "@/lib/fileUrls";
import { ValidationError } from "@storeai/shared/errors";
import { writeEvent } from "@/lib/events";

export const runtime = "nodejs";

const metadataSchema = z.object({
  projectId: z.string().uuid().optional().nullable(),
});

export const GET = tenantRoute({ requiredScope: "files:read" }, async ({ ctx }) => {
  const db = getDb();
  const rows = await db
    .select()
    .from(files)
    .where(eq(files.tenantId, ctx.tenantId))
    .orderBy(desc(files.createdAt))
    .limit(100);
  const withUrls = await Promise.all(
    rows.map(async (f) => ({
      ...f,
      downloadUrl: appHostedFileDownloadUrl(f.id),
    })),
  );
  return ok(withUrls);
});

const MAX_FILE_BYTES = 50 * 1024 * 1024; // 50MB for v1
const ALLOWED_CT = /^[\w.\-+/]+$/;

export const POST = tenantRoute({ requiredScope: "files:write" }, async ({ req, ctx }) => {
  const form = await req.formData();
  const file = form.get("file");
  const metaRaw = form.get("meta");
  if (!(file instanceof File)) throw new ValidationError("Missing 'file' form field");
  if (file.size === 0) throw new ValidationError("Empty file");
  if (file.size > MAX_FILE_BYTES) throw new ValidationError("File too large");
  const contentType = file.type || "application/octet-stream";
  if (!ALLOWED_CT.test(contentType)) throw new ValidationError("Invalid content type");
  const metaParsed = metaRaw ? metadataSchema.parse(JSON.parse(String(metaRaw))) : {};
  // Accept projectId either nested in `meta` JSON or as a top-level form field.
  const topLevelProjectId = form.get("projectId");
  const projectIdRaw =
    metaParsed.projectId ?? (typeof topLevelProjectId === "string" ? topLevelProjectId : null);
  const parsed = metadataSchema.parse({ projectId: projectIdRaw || null });

  await ensureBucket();
  const objectKey = buildObjectKey({
    tenantId: ctx.tenantId,
    projectId: parsed.projectId ?? null,
    originalName: file.name,
  });
  const buf = Buffer.from(await file.arrayBuffer());
  await putObject({ objectKey, body: buf, contentType });

  const db = getDb();
  const [row] = await db
    .insert(files)
    .values({
      tenantId: ctx.tenantId,
      projectId: parsed.projectId ?? null,
      objectKey,
      originalName: file.name.slice(0, 255),
      sizeBytes: file.size,
      contentType,
      uploadedByUserId: ctx.user?.id ?? null,
      uploadedByApiKeyId: ctx.apiKeyId,
    })
    .returning();
  if (!row) {
    // cleanup
    await deleteObject(objectKey).catch(() => {});
    throw new Error("failed to persist file metadata");
  }
  await writeAuditLog({
    ctx,
    action: "file.upload",
    resourceType: "file",
    resourceId: row.id,
    metadata: { name: row.originalName, size: row.sizeBytes, objectKey: row.objectKey },
  });
  await redisSafe(
    () => enqueueFilePostProcess({ tenantId: ctx.tenantId, fileId: row.id }),
    null,
    "enqueue:file-post-process",
  );
  await writeEvent({
    ctx,
    type: "file.uploaded",
    resourceType: "file",
    resourceId: row.id,
    projectId: row.projectId,
    payload: { name: row.originalName, size: row.sizeBytes, contentType: row.contentType },
  });
  const downloadUrl = appHostedFileDownloadUrl(row.id);
  return ok({ ...row, downloadUrl });
});
