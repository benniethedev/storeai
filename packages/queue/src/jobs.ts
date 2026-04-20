import { getQueue, QUEUE_NAMES } from "./queues.js";

export interface FilePostProcessJob {
  tenantId: string;
  fileId: string;
}

export interface AuditFanoutJob {
  tenantId: string;
  auditLogId: string;
  action: string;
}

export async function enqueueFilePostProcess(data: FilePostProcessJob, jobId?: string) {
  return getQueue<FilePostProcessJob>(QUEUE_NAMES.filePostProcess).add(
    "process",
    data,
    jobId ? { jobId } : undefined,
  );
}

export async function enqueueAuditFanout(data: AuditFanoutJob) {
  return getQueue<AuditFanoutJob>(QUEUE_NAMES.auditFanout).add("fanout", data);
}
