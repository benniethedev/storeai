import { and, eq, sql } from "drizzle-orm";
import { getDb, auditLogs, events, projects, records } from "@storeai/db";
import {
  atomicOperationsSchema,
  MAX_RECORD_DATA_BYTES,
  type AtomicOperation,
} from "@storeai/shared";
import { AppError, NotFoundError } from "@storeai/shared/errors";
import { ok } from "@/lib/http";
import { tenantRoute } from "@/lib/routeHelpers";
import { getAppConnection } from "@storeai/queue";
import { redisSafe } from "@/lib/redisSafe";
import { eventChannel } from "@/lib/events";

export const runtime = "nodejs";

function assertDataSize(data: unknown): void {
  if (Buffer.byteLength(JSON.stringify(data ?? {}), "utf8") > MAX_RECORD_DATA_BYTES) {
    throw new AppError(
      413,
      "record_too_large",
      `Record data exceeds the maximum allowed size of ${MAX_RECORD_DATA_BYTES} bytes`,
    );
  }
}

function assertDistinctKeys(operations: AtomicOperation[]): void {
  const seen = new Set<string>();
  for (const operation of operations) {
    if (seen.has(operation.key)) {
      throw new AppError(
        400,
        "duplicate_operation_key",
        `Atomic request contains more than one operation for key ${operation.key}`,
      );
    }
    seen.add(operation.key);
  }
}

export const POST = tenantRoute(
  { requiredScope: "records:write" },
  async ({ req, ctx }) => {
    if (!req.headers.get("idempotency-key")?.trim()) {
      throw new AppError(
        400,
        "idempotency_key_required",
        "Atomic operations require an Idempotency-Key header",
      );
    }
    const input = atomicOperationsSchema.parse(await req.json());
    assertDistinctKeys(input.operations);
    for (const operation of input.operations) {
      if (operation.op !== "delete") assertDataSize(operation.data);
    }

    const committed = await getDb().transaction(async (tx) => {
      const project = await tx
        .select({ id: projects.id, integrityMode: projects.integrityMode })
        .from(projects)
        .where(and(eq(projects.id, input.projectId), eq(projects.tenantId, ctx.tenantId)))
        .limit(1);
      if (!project[0]) throw new NotFoundError("Project not found");
      if (project[0].integrityMode !== "strict") {
        throw new AppError(
          409,
          "strict_integrity_required",
          "Atomic record operations are available only for strict-integrity projects",
        );
      }

      const results: Array<Record<string, unknown>> = [];
      const eventIds: string[] = [];

      for (const operation of input.operations) {
        if (operation.op === "create") {
          const inserted = await tx
            .insert(records)
            .values({
              tenantId: ctx.tenantId,
              projectId: input.projectId,
              key: operation.key,
              data: operation.data,
              immutable: operation.immutable,
              createdByUserId: ctx.user?.id ?? null,
              createdByApiKeyId: ctx.apiKeyId,
            })
            .onConflictDoNothing({
              target: [records.tenantId, records.projectId, records.key],
              where: eq(records.strictIdentity, true),
            })
            .returning();
          if (!inserted[0]) {
            throw new AppError(409, "record_exists", `Record ${operation.key} already exists`);
          }
          await tx.insert(auditLogs).values({
            tenantId: ctx.tenantId,
            actorUserId: ctx.user?.id ?? null,
            actorApiKeyId: ctx.apiKeyId,
            action: "record.create",
            resourceType: "record",
            resourceId: inserted[0].id,
            metadata: { key: operation.key, projectId: input.projectId, atomic: true },
          });
          const event = await tx
            .insert(events)
            .values({
              tenantId: ctx.tenantId,
              actorUserId: ctx.user?.id ?? null,
              actorApiKeyId: ctx.apiKeyId,
              type: "record.created",
              resourceType: "record",
              resourceId: inserted[0].id,
              projectId: input.projectId,
              payload: { key: operation.key, version: inserted[0].version, atomic: true },
            })
            .returning({ id: events.id });
          eventIds.push(event[0]!.id);
          results.push({ op: operation.op, record: inserted[0] });
          continue;
        }

        const conditions = [
          eq(records.tenantId, ctx.tenantId),
          eq(records.projectId, input.projectId),
          eq(records.key, operation.key),
        ];
        if (operation.expectedVersion !== undefined) {
          conditions.push(eq(records.version, operation.expectedVersion));
        }
        conditions.push(eq(records.immutable, false));

        if (operation.op === "update") {
          const updated = await tx
            .update(records)
            .set({
              data: operation.data,
              updatedAt: new Date(),
              version: sql`${records.version} + 1`,
            })
            .where(and(...conditions))
            .returning();
          if (!updated[0]) {
            const immutable = await tx
              .select({ immutable: records.immutable })
              .from(records)
              .where(and(
                eq(records.tenantId, ctx.tenantId),
                eq(records.projectId, input.projectId),
                eq(records.key, operation.key),
              ))
              .limit(1);
            if (immutable[0]?.immutable) {
              throw new AppError(409, "immutable_record", `Record ${operation.key} is immutable`);
            }
            throw new AppError(
              409,
              operation.expectedVersion === undefined ? "record_not_found" : "version_conflict",
              operation.expectedVersion === undefined
                ? `Record ${operation.key} does not exist`
                : `Record ${operation.key} version does not match`,
            );
          }
          await tx.insert(auditLogs).values({
            tenantId: ctx.tenantId,
            actorUserId: ctx.user?.id ?? null,
            actorApiKeyId: ctx.apiKeyId,
            action: "record.update",
            resourceType: "record",
            resourceId: updated[0].id,
            metadata: { key: operation.key, projectId: input.projectId, atomic: true },
          });
          const event = await tx
            .insert(events)
            .values({
              tenantId: ctx.tenantId,
              actorUserId: ctx.user?.id ?? null,
              actorApiKeyId: ctx.apiKeyId,
              type: "record.updated",
              resourceType: "record",
              resourceId: updated[0].id,
              projectId: input.projectId,
              payload: { key: operation.key, version: updated[0].version, atomic: true },
            })
            .returning({ id: events.id });
          eventIds.push(event[0]!.id);
          results.push({ op: operation.op, record: updated[0] });
          continue;
        }

        const deleted = await tx
          .delete(records)
          .where(and(...conditions))
          .returning({ id: records.id, key: records.key, version: records.version });
        if (!deleted[0]) {
          const immutable = await tx
            .select({ immutable: records.immutable })
            .from(records)
            .where(and(
              eq(records.tenantId, ctx.tenantId),
              eq(records.projectId, input.projectId),
              eq(records.key, operation.key),
            ))
            .limit(1);
          if (immutable[0]?.immutable) {
            throw new AppError(409, "immutable_record", `Record ${operation.key} is immutable`);
          }
          throw new AppError(
            409,
            operation.expectedVersion === undefined ? "record_not_found" : "version_conflict",
            operation.expectedVersion === undefined
              ? `Record ${operation.key} does not exist`
              : `Record ${operation.key} version does not match`,
          );
        }
        await tx.insert(auditLogs).values({
          tenantId: ctx.tenantId,
          actorUserId: ctx.user?.id ?? null,
          actorApiKeyId: ctx.apiKeyId,
          action: "record.delete",
          resourceType: "record",
          resourceId: deleted[0].id,
          metadata: { key: operation.key, projectId: input.projectId, atomic: true },
        });
        const event = await tx
          .insert(events)
          .values({
            tenantId: ctx.tenantId,
            actorUserId: ctx.user?.id ?? null,
            actorApiKeyId: ctx.apiKeyId,
            type: "record.deleted",
            resourceType: "record",
            resourceId: deleted[0].id,
            projectId: input.projectId,
            payload: { key: operation.key, version: deleted[0].version, atomic: true },
          })
          .returning({ id: events.id });
        eventIds.push(event[0]!.id);
        results.push({ op: operation.op, key: operation.key, deleted: true });
      }

      return { results, eventIds };
    });

    for (const eventId of committed.eventIds) {
      await redisSafe(
        () => getAppConnection().publish(eventChannel(ctx.tenantId), eventId),
        0,
        "events:publish",
      );
    }

    return ok({ results: committed.results });
  },
);
