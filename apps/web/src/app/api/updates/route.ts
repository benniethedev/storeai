import { ok } from "@/lib/http";
import { tenantRoute } from "@/lib/routeHelpers";
import { getUpdatesSnapshot } from "@/lib/updates";

export const runtime = "nodejs";

export const GET = tenantRoute({ requireRole: "admin" }, async () => {
  return ok(await getUpdatesSnapshot());
});
