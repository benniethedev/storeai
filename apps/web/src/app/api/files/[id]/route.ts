import { and, eq } from "drizzle-orm";
import { getDb, files } from "@storeai/db";
import { deleteObject, assertTenantOwnsKey } from "@storeai/storage";
import { NotFoundError } from "@storeai/shared/errors";
import { ok } from "@/lib/http";
import { tenantRoute } from "@/lib/routeHelpers";
import { writeAuditLog } from "@/lib/context";
import { appHostedFileDownloadUrl } from "@/lib/fileUrls";
import { writeEventSafe } from "@/lib/events";

export const runtime = "nodejs";

export const GET = tenantRoute<{ id: string }>({ requiredScope: "files:read" }, async ({ ctx, params }) => {
  const db = getDb();
  const rows = await db
    .select()
    .from(files)
    .where(and(eq(files.tenantId, ctx.tenantId), eq(files.id, params.id)))
    .limit(1);
  const row = rows[0];
  if (!row) throw new NotFoundError();
  assertTenantOwnsKey(ctx.tenantId, row.objectKey);
  const downloadUrl = appHostedFileDownloadUrl(row.id);
  return ok({ ...row, downloadUrl });
});

export const DELETE = tenantRoute<{ id: string }>({ requiredScope: "files:write" }, async ({ ctx, params }) => {
  const db = getDb();
  const rows = await db
    .select()
    .from(files)
    .where(and(eq(files.tenantId, ctx.tenantId), eq(files.id, params.id)))
    .limit(1);
  const row = rows[0];
  if (!row) throw new NotFoundError();
  assertTenantOwnsKey(ctx.tenantId, row.objectKey);
  await deleteObject(row.objectKey).catch((e) => console.warn("s3 delete failed", e));
  await db.delete(files).where(eq(files.id, row.id));
  await writeAuditLog({
    ctx,
    action: "file.delete",
    resourceType: "file",
    resourceId: params.id,
    metadata: { objectKey: row.objectKey },
  });
  await writeEventSafe({
    ctx,
    type: "file.deleted",
    resourceType: "file",
    resourceId: params.id,
    projectId: row.projectId,
    payload: { objectKey: row.objectKey },
  });
  return ok({ deleted: true });
});
