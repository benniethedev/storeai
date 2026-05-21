import { and, asc, eq, gt } from "drizzle-orm";
import { getDb, events } from "@storeai/db";
import { ok } from "@/lib/http";
import { tenantRoute } from "@/lib/routeHelpers";

export const runtime = "nodejs";

export const GET = tenantRoute({ requiredScope: "records:read" }, async ({ req, ctx }) => {
  const url = new URL(req.url);
  const after = url.searchParams.get("after");
  const limit = Math.min(Number(url.searchParams.get("limit") ?? 100) || 100, 500);
  const conds = [eq(events.tenantId, ctx.tenantId)];
  if (after) conds.push(gt(events.id, after));

  const rows = await getDb()
    .select()
    .from(events)
    .where(and(...conds))
    .orderBy(asc(events.createdAt))
    .limit(limit);
  return ok({ items: rows });
});
