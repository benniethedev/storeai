import { desc, eq } from "drizzle-orm";
import { getDb, auditLogs } from "@storeai/db";
import { ok } from "@/lib/http";
import { tenantRoute } from "@/lib/routeHelpers";

export const runtime = "nodejs";

export const GET = tenantRoute({ requireRole: "admin" }, async ({ ctx }) => {
  const db = getDb();
  const rows = await db
    .select()
    .from(auditLogs)
    .where(eq(auditLogs.tenantId, ctx.tenantId))
    .orderBy(desc(auditLogs.createdAt))
    .limit(200);
  return ok(rows);
});
