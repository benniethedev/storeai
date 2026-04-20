import { Queue } from "bullmq";
import { getRedisConnection } from "./connection.js";

export const QUEUE_NAMES = {
  filePostProcess: "file-post-process",
  auditFanout: "audit-fanout",
} as const;

export type QueueName = (typeof QUEUE_NAMES)[keyof typeof QUEUE_NAMES];

let queues: Partial<Record<QueueName, Queue>> = {};

export function getQueue<T = unknown>(name: QueueName): Queue<T> {
  if (!queues[name]) {
    queues[name] = new Queue(name, {
      connection: getRedisConnection(),
      defaultJobOptions: {
        attempts: 3,
        backoff: { type: "exponential", delay: 1000 },
        removeOnComplete: { count: 1000 },
        removeOnFail: { count: 1000 },
      },
    });
  }
  return queues[name] as Queue<T>;
}

export async function closeQueues(): Promise<void> {
  await Promise.all(Object.values(queues).map((q) => q?.close()));
  queues = {};
}
