import { describe, it, expect, afterAll, beforeAll, beforeEach } from "vitest";
import { Worker } from "bullmq";
import { eq } from "drizzle-orm";
import {
  enqueueFilePostProcess,
  enqueueAuditFanout,
  QUEUE_NAMES,
  getRedisConnection,
  getQueue,
  closeQueues,
} from "@storeai/queue";
import { getDb, files } from "@storeai/db";
import { resetDb, createUserAndTenant, uniqueSlug } from "./helpers/db";
import { buildObjectKey, ensureBucket, putObject } from "@storeai/storage";

const workers: Worker[] = [];

async function waitFor<T>(fn: () => Promise<T | null | undefined>, timeoutMs = 10_000): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const v = await fn();
    if (v) return v;
    await new Promise((r) => setTimeout(r, 150));
  }
  throw new Error("timeout");
}

beforeAll(async () => {
  await ensureBucket();
  // Drain any leftover jobs from previous runs
  const fileQ = getQueue(QUEUE_NAMES.filePostProcess);
  const auditQ = getQueue(QUEUE_NAMES.auditFanout);
  await fileQ.obliterate({ force: true }).catch(() => {});
  await auditQ.obliterate({ force: true }).catch(() => {});

  workers.push(
    new Worker(
      QUEUE_NAMES.filePostProcess,
      async (job) => {
        const { fileId } = job.data as { fileId: string };
        const db = getDb();
        await db.update(files).set({ processedAt: new Date() }).where(eq(files.id, fileId));
        return { ok: true };
      },
      { connection: getRedisConnection() },
    ),
  );
  workers.push(
    new Worker(
      QUEUE_NAMES.auditFanout,
      async (job) => ({ ok: true, action: (job.data as { action: string }).action }),
      { connection: getRedisConnection() },
    ),
  );

  await Promise.all(workers.map((w) => w.waitUntilReady()));
});

afterAll(async () => {
  await Promise.all(workers.map((w) => w.close()));
  await closeQueues();
});

beforeEach(async () => {
  await resetDb();
});

describe("queue job execution", () => {
  it("file post-process job marks the file as processed", async () => {
    const { tenant, user } = await createUserAndTenant({ tenantSlug: uniqueSlug("q") });
    const db = getDb();
    const objectKey = buildObjectKey({ tenantId: tenant.id, originalName: "a.txt" });
    await putObject({ objectKey, body: Buffer.from("hi"), contentType: "text/plain" });
    const [row] = await db
      .insert(files)
      .values({
        tenantId: tenant.id,
        objectKey,
        originalName: "a.txt",
        sizeBytes: 2,
        contentType: "text/plain",
        uploadedByUserId: user.id,
      })
      .returning();
    await enqueueFilePostProcess({ tenantId: tenant.id, fileId: row!.id });

    const updated = await waitFor(async () => {
      const [r] = await db.select().from(files).where(eq(files.id, row!.id));
      return r?.processedAt ? r : null;
    });
    expect(updated.processedAt).not.toBeNull();
  });

  it("audit fanout job returns ok", async () => {
    const auditQ = getQueue(QUEUE_NAMES.auditFanout);
    const job = await enqueueAuditFanout({
      tenantId: "00000000-0000-0000-0000-000000000000",
      auditLogId: "00000000-0000-0000-0000-000000000000",
      action: "test",
    });
    const result = await waitFor(async () => {
      const fresh = await auditQ.getJob(job.id!);
      if (!fresh) return null;
      const state = await fresh.getState();
      if (state === "completed") return fresh.returnvalue;
      if (state === "failed") throw new Error("job failed");
      return null;
    });
    expect(result).toMatchObject({ ok: true, action: "test" });
  });
});
