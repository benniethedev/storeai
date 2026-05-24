import "server-only";
import { and, eq, lt } from "drizzle-orm";
import { getDb, auditLogs, errorLogs, usageLogs } from "@storeai/db";

export const LOG_RETENTION_DAYS = 30;

export function logRetentionCutoff(now = new Date()): Date {
  return new Date(now.getTime() - LOG_RETENTION_DAYS * 24 * 60 * 60 * 1000);
}

export async function pruneTenantLogs(tenantId: string): Promise<void> {
  const db = getDb();
  const cutoff = logRetentionCutoff();
  await Promise.all([
    db.delete(auditLogs).where(and(eq(auditLogs.tenantId, tenantId), lt(auditLogs.createdAt, cutoff))),
    db.delete(errorLogs).where(and(eq(errorLogs.tenantId, tenantId), lt(errorLogs.createdAt, cutoff))),
    db.delete(usageLogs).where(and(eq(usageLogs.tenantId, tenantId), lt(usageLogs.createdAt, cutoff))),
  ]);
}
