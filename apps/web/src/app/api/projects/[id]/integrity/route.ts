import { and, count, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { auditLogs, events, getDb, projects, records } from "@storeai/db";
import { AppError, NotFoundError } from "@storeai/shared/errors";
import { ok } from "@/lib/http";
import { tenantRoute } from "@/lib/routeHelpers";
import { eventChannel } from "@/lib/events";
import { getAppConnection } from "@storeai/queue";
import { redisSafe } from "@/lib/redisSafe";

export const runtime = "nodejs";

const upgradeSchema = z.object({ integrityMode: z.literal("strict") });

async function readiness(tenantId: string, projectId: string) {
  const db = getDb();
  const project = await db
    .select({ id: projects.id, integrityMode: projects.integrityMode })
    .from(projects)
    .where(and(eq(projects.tenantId, tenantId), eq(projects.id, projectId)))
    .limit(1);
  if (!project[0]) throw new NotFoundError("Project not found");

  const [recordCount] = await db
    .select({ value: count() })
    .from(records)
    .where(and(eq(records.tenantId, tenantId), eq(records.projectId, projectId)));
  const duplicates = await db
    .select({ key: records.key })
    .from(records)
    .where(and(eq(records.tenantId, tenantId), eq(records.projectId, projectId)))
    .groupBy(records.key)
    .having(sql`count(*) > 1`);

  return {
    integrityMode: project[0].integrityMode,
    recordCount: recordCount?.value ?? 0,
    duplicateKeyGroups: duplicates.length,
    canUpgrade: project[0].integrityMode === "strict" || duplicates.length === 0,
  };
}

export const GET = tenantRoute<{ id: string }>(
  { requiredScope: "projects:read" },
  async ({ ctx, params }) => ok(await readiness(ctx.tenantId, params.id)),
);

export const POST = tenantRoute<{ id: string }>(
  { requireRole: "admin", requiredScope: "projects:write" },
  async ({ req, ctx, params }) => {
    upgradeSchema.parse(await req.json());

    const committed = await getDb().transaction(async (tx) => {
      const project = await tx
        .select({ id: projects.id, integrityMode: projects.integrityMode })
        .from(projects)
        .where(and(eq(projects.tenantId, ctx.tenantId), eq(projects.id, params.id)))
        .for("update")
        .limit(1);
      if (!project[0]) throw new NotFoundError("Project not found");
      if (project[0].integrityMode === "strict") return { alreadyStrict: true, eventId: null };

      const duplicate = await tx
        .select({ key: records.key })
        .from(records)
        .where(and(eq(records.tenantId, ctx.tenantId), eq(records.projectId, params.id)))
        .groupBy(records.key)
        .having(sql`count(*) > 1`)
        .limit(1);
      if (duplicate[0]) {
        throw new AppError(
          409,
          "integrity_upgrade_blocked",
          "Project contains duplicate record keys; resolve them before upgrading",
        );
      }

      await tx
        .update(projects)
        .set({ integrityMode: "strict", updatedAt: new Date() })
        .where(and(eq(projects.tenantId, ctx.tenantId), eq(projects.id, params.id)));
      await tx
        .update(records)
        .set({ strictIdentity: true })
        .where(and(eq(records.tenantId, ctx.tenantId), eq(records.projectId, params.id)));
      await tx.insert(auditLogs).values({
        tenantId: ctx.tenantId,
        actorUserId: ctx.user?.id ?? null,
        actorApiKeyId: ctx.apiKeyId,
        action: "project.integrity.upgrade",
        resourceType: "project",
        resourceId: params.id,
        metadata: { from: "legacy", to: "strict" },
      });
      const event = await tx
        .insert(events)
        .values({
          tenantId: ctx.tenantId,
          actorUserId: ctx.user?.id ?? null,
          actorApiKeyId: ctx.apiKeyId,
          type: "project.integrity.upgraded",
          resourceType: "project",
          resourceId: params.id,
          payload: { from: "legacy", to: "strict" },
        })
        .returning({ id: events.id });
      return { alreadyStrict: false, eventId: event[0]!.id };
    });

    if (committed.eventId) {
      await redisSafe(
        () => getAppConnection().publish(eventChannel(ctx.tenantId), committed.eventId!),
        0,
        "events:publish",
      );
    }
    return ok({ integrityMode: "strict", upgraded: !committed.alreadyStrict });
  },
);
