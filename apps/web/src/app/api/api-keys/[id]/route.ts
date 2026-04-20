import { and, eq } from "drizzle-orm";
import { getDb, apiKeys } from "@storeai/db";
import { NotFoundError } from "@storeai/shared/errors";
import { ok } from "@/lib/http";
import { tenantRoute } from "@/lib/routeHelpers";
import { writeAuditLog } from "@/lib/context";

export const runtime = "nodejs";

export const DELETE = tenantRoute<{ id: string }>(
  { requireRole: "admin", allowApiKey: false },
  async ({ ctx, params }) => {
    const db = getDb();
    const rows = await db
      .update(apiKeys)
      .set({ revokedAt: new Date() })
      .where(and(eq(apiKeys.id, params.id), eq(apiKeys.tenantId, ctx.tenantId)))
      .returning({ id: apiKeys.id });
    if (!rows[0]) throw new NotFoundError();
    await writeAuditLog({
      ctx,
      action: "api_key.revoke",
      resourceType: "api_key",
      resourceId: params.id,
    });
    return ok({ revoked: true });
  },
);
