import { and, eq } from "drizzle-orm";
import { getDb, files } from "@storeai/db";
import { deleteObject, getSignedDownloadUrl, assertTenantOwnsKey } from "@storeai/storage";
import { NotFoundError } from "@storeai/shared/errors";
import { ok } from "@/lib/http";
import { tenantRoute } from "@/lib/routeHelpers";
import { writeAuditLog } from "@/lib/context";

export const runtime = "nodejs";

export const GET = tenantRoute<{ id: string }>({}, async ({ ctx, params }) => {
  const db = getDb();
  const rows = await db
    .select()
    .from(files)
    .where(and(eq(files.tenantId, ctx.tenantId), eq(files.id, params.id)))
    .limit(1);
  const row = rows[0];
  if (!row) throw new NotFoundError();
  assertTenantOwnsKey(ctx.tenantId, row.objectKey);
  const downloadUrl = await getSignedDownloadUrl(row.objectKey, 300);
  return ok({ ...row, downloadUrl });
});

export const DELETE = tenantRoute<{ id: string }>({}, async ({ ctx, params }) => {
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
  return ok({ deleted: true });
});
