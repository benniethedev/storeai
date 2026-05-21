import "server-only";
import { getDb, events, type Event } from "@storeai/db";
import { getAppConnection } from "@storeai/queue";
import { redisSafe } from "./redisSafe";
import type { TenantCtx } from "./context";

export type StoreAiEventType =
  | "project.created"
  | "project.updated"
  | "project.deleted"
  | "record.created"
  | "record.updated"
  | "record.deleted"
  | "file.uploaded"
  | "file.deleted";

export async function writeEvent(args: {
  ctx: TenantCtx;
  type: StoreAiEventType;
  resourceType: string;
  resourceId?: string | null;
  projectId?: string | null;
  payload?: Record<string, unknown>;
}): Promise<Event> {
  const [row] = await getDb()
    .insert(events)
    .values({
      tenantId: args.ctx.tenantId,
      actorUserId: args.ctx.user?.id ?? null,
      actorApiKeyId: args.ctx.apiKeyId,
      type: args.type,
      resourceType: args.resourceType,
      resourceId: args.resourceId ?? null,
      projectId: args.projectId ?? null,
      payload: args.payload ?? {},
    })
    .returning();
  if (!row) throw new Error("event write failed");

  await redisSafe(
    async () => {
      await getAppConnection().publish(eventChannel(args.ctx.tenantId), row.id);
    },
    null,
    "events:publish",
  );
  return row;
}

export function eventChannel(tenantId: string): string {
  return `storeai:tenant:${tenantId}:events`;
}
