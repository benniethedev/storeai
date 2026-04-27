import { z } from "zod";
import { and, desc, asc, eq, like, sql } from "drizzle-orm";
import { getDb, records, projects } from "@storeai/db";
import { createRecordSchema, paginationSchema } from "@storeai/shared";
import { NotFoundError } from "@storeai/shared/errors";
import { ok } from "@/lib/http";
import { tenantRoute } from "@/lib/routeHelpers";
import { writeAuditLog } from "@/lib/context";
import { enqueueAuditFanout } from "@storeai/queue";
import { redisSafe } from "@/lib/redisSafe";

export const runtime = "nodejs";

async function assertProjectInTenant(tenantId: string, projectId: string) {
  const db = getDb();
  const rows = await db
    .select({ id: projects.id })
    .from(projects)
    .where(and(eq(projects.id, projectId), eq(projects.tenantId, tenantId)))
    .limit(1);
  if (!rows[0]) throw new NotFoundError("Project not found");
}

const projectIdQuerySchema = z.string().uuid().optional();
const keyFilterSchema = z.string().min(1).max(255).optional();

// Postgres LIKE metacharacters need escaping so a prefix like "abc%" only
// matches the literal string, not a wildcard pattern.
function escapeLikePattern(input: string): string {
  return input.replace(/[\\%_]/g, (ch) => `\\${ch}`);
}

export const GET = tenantRoute({}, async ({ req, ctx }) => {
  const url = new URL(req.url);
  const projectId = projectIdQuerySchema.parse(
    url.searchParams.get("projectId") ?? undefined,
  );
  const key = keyFilterSchema.parse(url.searchParams.get("key") ?? undefined);
  const keyPrefix = keyFilterSchema.parse(
    url.searchParams.get("keyPrefix") ?? undefined,
  );
  const { page, pageSize, sort } = paginationSchema.parse({
    page: url.searchParams.get("page") ?? undefined,
    pageSize: url.searchParams.get("pageSize") ?? undefined,
    sort: url.searchParams.get("sort") ?? undefined,
  });
  const db = getDb();
  const conds = [eq(records.tenantId, ctx.tenantId)];
  if (projectId) {
    await assertProjectInTenant(ctx.tenantId, projectId);
    conds.push(eq(records.projectId, projectId));
  }
  if (key !== undefined) conds.push(eq(records.key, key));
  if (keyPrefix !== undefined) {
    conds.push(like(records.key, `${escapeLikePattern(keyPrefix)}%`));
  }

  const orderCol = sort.includes("updated_at") ? records.updatedAt : records.createdAt;
  const orderFn = sort.startsWith("-") ? desc : asc;

  const [countRow] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(records)
    .where(and(...conds));
  const count = countRow?.count ?? 0;

  const rows = await db
    .select()
    .from(records)
    .where(and(...conds))
    .orderBy(orderFn(orderCol))
    .limit(pageSize)
    .offset((page - 1) * pageSize);
  return ok({ items: rows, page, pageSize, total: count });
});

export const POST = tenantRoute({}, async ({ req, ctx }) => {
  const body = await req.json();
  const input = createRecordSchema.parse(body);
  await assertProjectInTenant(ctx.tenantId, input.projectId);
  const db = getDb();
  const [row] = await db
    .insert(records)
    .values({
      tenantId: ctx.tenantId,
      projectId: input.projectId,
      key: input.key,
      data: input.data,
      createdByUserId: ctx.user?.id ?? null,
      createdByApiKeyId: ctx.apiKeyId,
    })
    .returning();
  if (!row) throw new Error("create record failed");
  const auditId = await writeAuditLog({
    ctx,
    action: "record.create",
    resourceType: "record",
    resourceId: row.id,
    metadata: { key: row.key, projectId: row.projectId },
  });
  await redisSafe(
    () => enqueueAuditFanout({ tenantId: ctx.tenantId, auditLogId: auditId, action: "record.create" }),
    null,
    "enqueue:audit-fanout",
  );
  return ok(row);
});
