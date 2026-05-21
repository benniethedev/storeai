import { asc, eq } from "drizzle-orm";
import { getDb, auditLogs, events, files, projects, records, tenants, usageLogs } from "@storeai/db";
import { ok } from "@/lib/http";
import { tenantRoute } from "@/lib/routeHelpers";

export const runtime = "nodejs";

export const GET = tenantRoute({ requireRole: "admin", allowApiKey: false }, async ({ ctx }) => {
  const db = getDb();
  const [tenantRows, projectRows, recordRows, fileRows, eventRows, auditRows, usageRows] =
    await Promise.all([
      db.select().from(tenants).where(eq(tenants.id, ctx.tenantId)).limit(1),
      db.select().from(projects).where(eq(projects.tenantId, ctx.tenantId)).orderBy(asc(projects.createdAt)),
      db.select().from(records).where(eq(records.tenantId, ctx.tenantId)).orderBy(asc(records.createdAt)),
      db.select().from(files).where(eq(files.tenantId, ctx.tenantId)).orderBy(asc(files.createdAt)),
      db.select().from(events).where(eq(events.tenantId, ctx.tenantId)).orderBy(asc(events.createdAt)),
      db
        .select()
        .from(auditLogs)
        .where(eq(auditLogs.tenantId, ctx.tenantId))
        .orderBy(asc(auditLogs.createdAt)),
      db
        .select()
        .from(usageLogs)
        .where(eq(usageLogs.tenantId, ctx.tenantId))
        .orderBy(asc(usageLogs.createdAt)),
    ]);

  return ok({
    exportedAt: new Date().toISOString(),
    format: "storeai.tenant-export.v1",
    tenant: tenantRows[0] ?? null,
    projects: projectRows,
    records: recordRows,
    files: fileRows.map((file) => ({
      ...file,
      note: "File export includes metadata only. Object bytes remain in configured S3/MinIO storage.",
    })),
    events: eventRows,
    auditLogs: auditRows,
    usageLogs: usageRows,
  });
});
