import { and, desc, asc, eq, sql } from "drizzle-orm";
import { getDb, projects } from "@storeai/db";
import { createProjectSchema, paginationSchema } from "@storeai/shared";
import { ConflictError } from "@storeai/shared/errors";
import { ok } from "@/lib/http";
import { tenantRoute } from "@/lib/routeHelpers";
import { writeAuditLog } from "@/lib/context";

export const runtime = "nodejs";

export const GET = tenantRoute({}, async ({ req, ctx }) => {
  const url = new URL(req.url);
  const { page, pageSize, sort } = paginationSchema.parse({
    page: url.searchParams.get("page") ?? undefined,
    pageSize: url.searchParams.get("pageSize") ?? undefined,
    sort: url.searchParams.get("sort") ?? undefined,
  });
  const q = (url.searchParams.get("q") ?? "").trim();
  const db = getDb();

  const orderCol = sort.includes("updated_at") ? projects.updatedAt : projects.createdAt;
  const orderFn = sort.startsWith("-") ? desc : asc;
  const where = q
    ? and(eq(projects.tenantId, ctx.tenantId), sql`${projects.name} ILIKE ${"%" + q + "%"}`)
    : eq(projects.tenantId, ctx.tenantId);

  const [{ count }] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(projects)
    .where(where);

  const rows = await db
    .select()
    .from(projects)
    .where(where)
    .orderBy(orderFn(orderCol))
    .limit(pageSize)
    .offset((page - 1) * pageSize);
  return ok({ items: rows, page, pageSize, total: count ?? 0 });
});

export const POST = tenantRoute({}, async ({ req, ctx }) => {
  const body = await req.json();
  const input = createProjectSchema.parse(body);
  const db = getDb();
  const dupe = await db
    .select()
    .from(projects)
    .where(and(eq(projects.tenantId, ctx.tenantId), eq(projects.slug, input.slug)))
    .limit(1);
  if (dupe[0]) throw new ConflictError("Project slug already exists in this tenant");
  const [p] = await db
    .insert(projects)
    .values({
      tenantId: ctx.tenantId,
      name: input.name,
      slug: input.slug,
      description: input.description ?? null,
      createdByUserId: ctx.user?.id ?? null,
    })
    .returning();
  if (!p) throw new Error("create project failed");
  await writeAuditLog({
    ctx,
    action: "project.create",
    resourceType: "project",
    resourceId: p.id,
    metadata: { slug: p.slug },
  });
  return ok(p);
});
