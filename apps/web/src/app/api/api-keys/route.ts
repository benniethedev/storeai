import { and, desc, eq } from "drizzle-orm";
import { getDb, apiKeys } from "@storeai/db";
import { createApiKey } from "@storeai/auth";
import { createApiKeySchema } from "@storeai/shared";
import { ok } from "@/lib/http";
import { tenantRoute } from "@/lib/routeHelpers";
import { writeAuditLog } from "@/lib/context";

export const runtime = "nodejs";

export const GET = tenantRoute({ requireRole: "admin", allowApiKey: false }, async ({ ctx }) => {
  const db = getDb();
  const rows = await db
    .select({
      id: apiKeys.id,
      name: apiKeys.name,
      prefix: apiKeys.prefix,
      createdAt: apiKeys.createdAt,
      lastUsedAt: apiKeys.lastUsedAt,
      revokedAt: apiKeys.revokedAt,
    })
    .from(apiKeys)
    .where(eq(apiKeys.tenantId, ctx.tenantId))
    .orderBy(desc(apiKeys.createdAt));
  return ok(rows);
});

export const POST = tenantRoute(
  { requireRole: "admin", allowApiKey: false },
  async ({ req, ctx }) => {
    const body = await req.json();
    const input = createApiKeySchema.parse(body);
    const created = await createApiKey({
      tenantId: ctx.tenantId,
      createdByUserId: ctx.user!.id,
      name: input.name,
    });
    await writeAuditLog({
      ctx,
      action: "api_key.create",
      resourceType: "api_key",
      resourceId: created.apiKey.id,
      metadata: { name: created.apiKey.name },
    });
    return ok({
      id: created.apiKey.id,
      name: created.apiKey.name,
      prefix: created.apiKey.prefix,
      plaintext: created.plaintext, // shown ONCE
      createdAt: created.apiKey.createdAt,
    });
  },
);
