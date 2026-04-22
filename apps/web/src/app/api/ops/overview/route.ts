/**
 * Read-only ops endpoint for external monitoring dashboards.
 *
 * Bearer auth against ops_tokens. All fields are aggregate — no row-level
 * data, no PII, no secrets, no path detail. Per-subsystem probes fail
 * closed (catch the error, report "degraded") so the endpoint stays 200
 * even when a dependency is down.
 *
 * The CI preflight (.github/workflows/deploy-preflight.yml) greps this
 * directory for forbidden identifiers to catch drift.
 */
import { NextRequest, NextResponse } from "next/server";
import { and, count, eq, gt, isNull, sql } from "drizzle-orm";
import {
  getDb,
  users,
  tenants,
  projects,
  records,
  files,
  apiKeys,
  sessions,
  auditLogs,
  usageLogs,
} from "@storeai/db";
import { resolveOpsToken } from "@storeai/auth";
import { getAppConnection, getQueue, QUEUE_NAMES } from "@storeai/queue";
import { probeBucket } from "@storeai/storage";
import { writeSystemAuditLog } from "@/lib/context";
import { sumLast24h, sumHashLast24h } from "@/lib/metrics";
import { getBuildInfo } from "@/lib/buildInfo";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type ProbeResult = "ok" | "degraded";

async function probe(fn: () => Promise<void>, timeoutMs = 2000): Promise<ProbeResult> {
  try {
    await Promise.race([
      fn(),
      new Promise<never>((_, reject) => setTimeout(() => reject(new Error("timeout")), timeoutMs)),
    ]);
    return "ok";
  } catch {
    return "degraded";
  }
}

async function probePostgres(): Promise<ProbeResult> {
  return probe(async () => {
    await getDb().execute(sql`select 1`);
  });
}

async function probeRedis(): Promise<ProbeResult> {
  return probe(async () => {
    const r = getAppConnection();
    const res = await r.ping();
    if (res !== "PONG") throw new Error("unexpected");
  });
}

async function probeStorage(): Promise<ProbeResult> {
  return probe(async () => {
    await probeBucket();
  });
}

interface DbTotals {
  tenants: number;
  users: number;
  projects: number;
  records: number;
  files: number;
  api_keys_active: number;
  sessions_active: number;
  signups_24h: number;
  logins_success_24h: number;
  logins_failed_24h: number;
  api_key_auth_failed_24h: number;
  audit_events_24h: number;
  usage_events_24h: number;
}

const EMPTY_TOTALS: DbTotals = {
  tenants: 0,
  users: 0,
  projects: 0,
  records: 0,
  files: 0,
  api_keys_active: 0,
  sessions_active: 0,
  signups_24h: 0,
  logins_success_24h: 0,
  logins_failed_24h: 0,
  api_key_auth_failed_24h: 0,
  audit_events_24h: 0,
  usage_events_24h: 0,
};

async function gatherDbTotals(): Promise<DbTotals> {
  try {
    const db = getDb();
    const since = sql`now() - interval '24 hours'`;

    const [
      tenantsC,
      usersC,
      projectsC,
      recordsC,
      filesC,
      activeKeysC,
      activeSessionsC,
      signupsC,
      loginsOkC,
      loginsFailedC,
      apiKeyFailedC,
      auditC,
      usageC,
    ] = await Promise.all([
      db.select({ n: count() }).from(tenants),
      db.select({ n: count() }).from(users),
      db.select({ n: count() }).from(projects),
      db.select({ n: count() }).from(records),
      db.select({ n: count() }).from(files),
      db.select({ n: count() }).from(apiKeys).where(isNull(apiKeys.revokedAt)),
      db.select({ n: count() }).from(sessions).where(gt(sessions.expiresAt, new Date())),
      db.select({ n: count() }).from(users).where(gt(users.createdAt, sql`${since}`)),
      db
        .select({ n: count() })
        .from(auditLogs)
        .where(and(eq(auditLogs.action, "auth.login"), gt(auditLogs.createdAt, sql`${since}`))),
      db
        .select({ n: count() })
        .from(auditLogs)
        .where(
          and(eq(auditLogs.action, "auth.login.failed"), gt(auditLogs.createdAt, sql`${since}`)),
        ),
      db
        .select({ n: count() })
        .from(auditLogs)
        .where(
          and(
            eq(auditLogs.action, "auth.api_key.failed"),
            gt(auditLogs.createdAt, sql`${since}`),
          ),
        ),
      db.select({ n: count() }).from(auditLogs).where(gt(auditLogs.createdAt, sql`${since}`)),
      db.select({ n: count() }).from(usageLogs).where(gt(usageLogs.createdAt, sql`${since}`)),
    ]);

    return {
      tenants: tenantsC[0]?.n ?? 0,
      users: usersC[0]?.n ?? 0,
      projects: projectsC[0]?.n ?? 0,
      records: recordsC[0]?.n ?? 0,
      files: filesC[0]?.n ?? 0,
      api_keys_active: activeKeysC[0]?.n ?? 0,
      sessions_active: activeSessionsC[0]?.n ?? 0,
      signups_24h: signupsC[0]?.n ?? 0,
      logins_success_24h: loginsOkC[0]?.n ?? 0,
      logins_failed_24h: loginsFailedC[0]?.n ?? 0,
      api_key_auth_failed_24h: apiKeyFailedC[0]?.n ?? 0,
      audit_events_24h: auditC[0]?.n ?? 0,
      usage_events_24h: usageC[0]?.n ?? 0,
    };
  } catch {
    return EMPTY_TOTALS;
  }
}

interface QueueDepth {
  waiting: number;
  active: number;
  failed: number;
}

async function gatherQueueDepths(): Promise<{
  file_post_process: QueueDepth;
  audit_fanout: QueueDepth;
}> {
  const empty: QueueDepth = { waiting: 0, active: 0, failed: 0 };
  async function depth(name: (typeof QUEUE_NAMES)[keyof typeof QUEUE_NAMES]): Promise<QueueDepth> {
    try {
      const q = getQueue(name);
      const counts = await q.getJobCounts("waiting", "active", "failed");
      return {
        waiting: Number(counts.waiting ?? 0),
        active: Number(counts.active ?? 0),
        failed: Number(counts.failed ?? 0),
      };
    } catch {
      return empty;
    }
  }
  const [fileQ, auditQ] = await Promise.all([
    depth(QUEUE_NAMES.filePostProcess),
    depth(QUEUE_NAMES.auditFanout),
  ]);
  return { file_post_process: fileQ, audit_fanout: auditQ };
}

export async function GET(req: NextRequest) {
  // 1. Authenticate. Any failure returns 401 without a body beyond the
  //    error envelope — no hints about token format, no timing quirks.
  const auth = req.headers.get("authorization") ?? "";
  if (!auth.toLowerCase().startsWith("bearer ")) {
    return NextResponse.json(
      { ok: false, error: { code: "unauthorized" } },
      { status: 401 },
    );
  }
  const resolved = await resolveOpsToken(auth.slice(7).trim());
  if (!resolved) {
    return NextResponse.json(
      { ok: false, error: { code: "unauthorized" } },
      { status: 401 },
    );
  }

  // 2. Gather per-subsystem health (fail-closed). All three run in parallel.
  const [pg, redis, storage] = await Promise.all([
    probePostgres(),
    probeRedis(),
    probeStorage(),
  ]);

  // 3. Worker health: infer from queue reachability — if we can read queue
  //    counts, BullMQ + Redis are up; the worker running is a separate
  //    liveness concern we can't verify remotely without a heartbeat.
  const workerReachable = redis === "ok" ? "ok" : "degraded";

  const overallStatus: ProbeResult =
    pg === "ok" && redis === "ok" && storage === "ok" ? "ok" : "degraded";

  // 4. Aggregate counts — from DB (fail-closed) and Redis (fail-open).
  const [dbTotals, queueDepth, rateLimited24h, probeHits24h, httpStatusClasses] =
    await Promise.all([
      pg === "ok" ? gatherDbTotals() : Promise.resolve(EMPTY_TOTALS),
      redis === "ok" ? gatherQueueDepths() : Promise.resolve({
        file_post_process: { waiting: 0, active: 0, failed: 0 },
        audit_fanout: { waiting: 0, active: 0, failed: 0 },
      }),
      sumLast24h("rate_limited"),
      sumLast24h("probe_hits"),
      sumHashLast24h("http"),
    ]);

  // 5. Write the ops-read audit row. Platform-level; no tenant.
  await writeSystemAuditLog({
    action: "ops.read",
    resourceType: "ops",
    metadata: { token_id: resolved.token.id, token_name: resolved.token.name },
  }).catch(() => {});

  const payload = {
    ok: true,
    service: "storeai" as const,
    generated_at: new Date().toISOString(),
    build: getBuildInfo(),
    health: {
      status: overallStatus,
      postgres: pg,
      redis,
      storage,
      worker: workerReachable,
    },
    totals: {
      tenants: dbTotals.tenants,
      users: dbTotals.users,
      projects: dbTotals.projects,
      records: dbTotals.records,
      files: dbTotals.files,
      api_keys_active: dbTotals.api_keys_active,
      sessions_active: dbTotals.sessions_active,
    },
    counts_24h: {
      signups: dbTotals.signups_24h,
      logins_success: dbTotals.logins_success_24h,
      logins_failed: dbTotals.logins_failed_24h,
      api_key_auth_failed: dbTotals.api_key_auth_failed_24h,
      probe_hits: probeHits24h,
      rate_limited: rateLimited24h,
      audit_events: dbTotals.audit_events_24h,
      usage_events: dbTotals.usage_events_24h,
    },
    http_24h: {
      "2xx": httpStatusClasses["2xx"] ?? 0,
      "3xx": httpStatusClasses["3xx"] ?? 0,
      "4xx": httpStatusClasses["4xx"] ?? 0,
      "5xx": httpStatusClasses["5xx"] ?? 0,
      p95_latency_ms: null as number | null,
    },
    queue: queueDepth,
  };

  return NextResponse.json(payload);
}
