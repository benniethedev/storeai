import { desc, eq } from "drizzle-orm";
import { getDb, files } from "@storeai/db";
import {
  buildObjectKey,
  deleteObject,
  ensureBucket,
  putObject,
} from "@storeai/storage";
import { enqueueFilePostProcess } from "@storeai/queue";
import { ok } from "@/lib/http";
import { tenantRoute } from "@/lib/routeHelpers";
import { writeAuditLogSafe } from "@/lib/context";
import { redisSafe } from "@/lib/redisSafe";
import { appHostedFileDownloadUrl } from "@/lib/fileUrls";
import { AppError, ValidationError } from "@storeai/shared/errors";
import { writeEventSafe } from "@/lib/events";

export const runtime = "nodejs";

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
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

type UploadedFileLike = {
  arrayBuffer: () => Promise<ArrayBuffer>;
  size: number;
  name?: string;
  type?: string;
};

type UploadFormValue = string | UploadedFileLike;
type UploadForm = Map<string, UploadFormValue>;

function isUploadedFileLike(value: unknown): value is UploadedFileLike {
  if (!value || typeof value !== "object") return false;
  const file = value as Partial<UploadedFileLike>;
  return typeof file.arrayBuffer === "function" && typeof file.size === "number";
}

function multipartBoundary(contentType: string): string | null {
  const match = contentType.match(/(?:^|;)\s*boundary=(?:"([^"]+)"|([^;]+))/i);
  return match?.[1] ?? match?.[2]?.trim() ?? null;
}

function parseContentDisposition(value: string | undefined): { name?: string; filename?: string } {
  const result: { name?: string; filename?: string } = {};
  if (!value) return result;
  for (const part of value.split(";").slice(1)) {
    const [rawKey, ...rawValue] = part.trim().split("=");
    const key = rawKey?.toLowerCase();
    if (!key) continue;
    const joined = rawValue.join("=");
    const unquoted = joined.startsWith('"') && joined.endsWith('"') ? joined.slice(1, -1) : joined;
    if (key === "name" || key === "filename") result[key] = unquoted.replace(/\\"/g, '"');
  }
  return result;
}

function headerMap(raw: Buffer): Map<string, string> {
  const headers = new Map<string, string>();
  for (const line of raw.toString("latin1").split("\r\n")) {
    const index = line.indexOf(":");
    if (index <= 0) continue;
    headers.set(line.slice(0, index).toLowerCase(), line.slice(index + 1).trim());
  }
  return headers;
}

function trimPartBody(body: Buffer): Buffer {
  return body.subarray(0, body.subarray(-2).equals(Buffer.from("\r\n")) ? body.length - 2 : body.length);
}

async function parseMultipartForm(req: Request, boundary: string): Promise<UploadForm> {
  const body = Buffer.from(await req.arrayBuffer());
  const delimiter = Buffer.from(`--${boundary}`);
  const form: UploadForm = new Map();
  let offset = body.indexOf(delimiter);
  if (offset < 0) throw new ValidationError("Malformed multipart upload");

  while (offset >= 0) {
    offset += delimiter.length;
    if (body.subarray(offset, offset + 2).equals(Buffer.from("--"))) break;
    if (body.subarray(offset, offset + 2).equals(Buffer.from("\r\n"))) offset += 2;

    const next = body.indexOf(delimiter, offset);
    if (next < 0) throw new ValidationError("Malformed multipart upload");
    const part = body.subarray(offset, next);
    const separator = part.indexOf(Buffer.from("\r\n\r\n"));
    if (separator < 0) {
      offset = next;
      continue;
    }

    const headers = headerMap(part.subarray(0, separator));
    const disposition = parseContentDisposition(headers.get("content-disposition"));
    if (!disposition.name) {
      offset = next;
      continue;
    }

    const value = trimPartBody(part.subarray(separator + 4));
    if (disposition.filename !== undefined) {
      const fileBody = Buffer.from(value);
      form.set(disposition.name, {
        name: disposition.filename,
        type: headers.get("content-type") || "application/octet-stream",
        size: fileBody.byteLength,
        arrayBuffer: async () =>
          fileBody.buffer.slice(fileBody.byteOffset, fileBody.byteOffset + fileBody.byteLength) as ArrayBuffer,
      });
    } else {
      form.set(disposition.name, value.toString("utf8"));
    }
    offset = next;
  }

  return form;
}

async function readUploadForm(req: Request): Promise<UploadForm> {
  const contentType = req.headers.get("content-type") ?? "";
  if (!contentType.toLowerCase().includes("multipart/form-data")) {
    throw new ValidationError("Expected multipart/form-data upload");
  }
  const boundary = multipartBoundary(contentType);
  if (!boundary) throw new ValidationError("Missing multipart boundary");

  const contentLength = Number(req.headers.get("content-length") ?? "0");
  if (Number.isFinite(contentLength) && contentLength > MAX_FILE_BYTES + 1024 * 1024) {
    throw new AppError(413, "payload_too_large", "Upload exceeds the allowed size");
  }

  try {
    return await parseMultipartForm(req, boundary);
  } catch (err) {
    if (err instanceof AppError) throw err;
    const message = err instanceof Error ? err.message : String(err);
    throw new ValidationError("Failed to parse multipart upload", { reason: message });
  }
}

function metadataProjectId(metaRaw: UploadFormValue | undefined): string | null {
  if (!metaRaw) return null;
  const parsed = JSON.parse(String(metaRaw)) as { projectId?: unknown } | null;
  return typeof parsed?.projectId === "string" ? parsed.projectId : null;
}

function normalizeProjectId(value: unknown): string | null {
  if (typeof value !== "string") return null;
  return UUID.test(value) ? value : null;
}

export const POST = tenantRoute({ requiredScope: "files:write" }, async ({ req, ctx }) => {
  const form = await readUploadForm(req);
  const file = form.get("file");
  const metaRaw = form.get("meta");
  if (!isUploadedFileLike(file)) throw new ValidationError("Missing 'file' form field");
  if (file.size === 0) throw new ValidationError("Empty file");
  if (file.size > MAX_FILE_BYTES) throw new ValidationError("File too large");
  const contentType = file.type || "application/octet-stream";
  if (!ALLOWED_CT.test(contentType)) throw new ValidationError("Invalid content type");
  // Accept projectId either nested in `meta` JSON or as a top-level form field.
  const topLevelProjectId = form.get("projectId");
  const projectId = normalizeProjectId(metadataProjectId(metaRaw) ?? topLevelProjectId);

  await ensureBucket();
  const objectKey = buildObjectKey({
    tenantId: ctx.tenantId,
    projectId,
    originalName: file.name || "upload",
  });
  const buf = Buffer.from(await file.arrayBuffer());
  await putObject({ objectKey, body: buf, contentType });

  const db = getDb();
  const [row] = await db
    .insert(files)
    .values({
      tenantId: ctx.tenantId,
      projectId,
      objectKey,
      originalName: (file.name || "upload").slice(0, 255),
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
  await writeAuditLogSafe({
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
  await writeEventSafe({
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
