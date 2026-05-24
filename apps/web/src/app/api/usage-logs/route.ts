import { and, desc, eq, gte } from "drizzle-orm";
import { getDb, usageLogs } from "@storeai/db";
import { ok } from "@/lib/http";
import { tenantRoute } from "@/lib/routeHelpers";
import { logRetentionCutoff, pruneTenantLogs } from "@/lib/logRetention";

export const runtime = "nodejs";

export const GET = tenantRoute({ requireRole: "admin" }, async ({ ctx }) => {
  const db = getDb();
  await pruneTenantLogs(ctx.tenantId).catch(() => {});
  const cutoff = logRetentionCutoff();
  const rows = await db
    .select()
    .from(usageLogs)
    .where(and(eq(usageLogs.tenantId, ctx.tenantId), gte(usageLogs.createdAt, cutoff)))
    .orderBy(desc(usageLogs.createdAt))
    .limit(200);
  return ok(rows);
});
