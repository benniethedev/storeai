import { Worker, type Processor } from "bullmq";
import { eq } from "drizzle-orm";
import { getRedisConnection } from "./connection.js";
import { QUEUE_NAMES } from "./queues.js";
import { getDb, files } from "@storeai/db";
import type { FilePostProcessJob, AuditFanoutJob } from "./jobs.js";

const fileProcessor: Processor<FilePostProcessJob> = async (job) => {
  const { fileId, tenantId } = job.data;
  const db = getDb();
  const [row] = await db.select().from(files).where(eq(files.id, fileId)).limit(1);
  if (!row) throw new Error(`file ${fileId} not found`);
  if (row.tenantId !== tenantId) throw new Error("tenant mismatch");
  // Simulate post-processing (e.g., thumbnailing, virus scan). Just mark processedAt.
  await db.update(files).set({ processedAt: new Date() }).where(eq(files.id, fileId));
  return { ok: true, fileId };
};

const auditProcessor: Processor<AuditFanoutJob> = async (job) => {
  // In a real system: fan out to webhooks, external log stores, etc.
  // For v1: no-op beyond acking the job. Returning the payload is useful for tests.
  return { ok: true, action: job.data.action };
};

export function startWorkers() {
  const connection = getRedisConnection();
  const fileWorker = new Worker<FilePostProcessJob>(QUEUE_NAMES.filePostProcess, fileProcessor, {
    connection,
    concurrency: 5,
  });
  const auditWorker = new Worker<AuditFanoutJob>(QUEUE_NAMES.auditFanout, auditProcessor, {
    connection,
    concurrency: 10,
  });

  for (const w of [fileWorker, auditWorker]) {
    w.on("failed", (job, err) => {
      console.error(`[worker] ${w.name} job ${job?.id} failed:`, err.message);
    });
    w.on("completed", (job) => {
      console.log(`[worker] ${w.name} job ${job.id} completed`);
    });
  }

  const shutdown = async () => {
    await Promise.all([fileWorker.close(), auditWorker.close()]);
  };
  return { fileWorker, auditWorker, shutdown };
}
