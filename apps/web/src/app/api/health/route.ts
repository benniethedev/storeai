import { NextRequest, NextResponse } from "next/server";
import { sql } from "drizzle-orm";
import { getDb } from "@storeai/db";
import { getAppConnection } from "@storeai/queue";
import { probeBucket } from "@storeai/storage";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type CheckResult = { ok: true; latencyMs: number } | { ok: false; error: string };

async function timed<T>(fn: () => Promise<T>, timeoutMs = 2000): Promise<CheckResult> {
  const start = Date.now();
  try {
    await Promise.race([
      fn(),
      new Promise<never>((_, reject) => setTimeout(() => reject(new Error("timeout")), timeoutMs)),
    ]);
    return { ok: true, latencyMs: Date.now() - start };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

/**
 * GET /api/health              — shallow (process-up) check, always 200.
 * GET /api/health?deep=1       — checks Postgres, Redis, and S3/MinIO.
 *                                Returns 503 if any dependency is down.
 *
 * Use the shallow check for load balancers that should not drop the
 * instance during a Redis hiccup; use the deep check for alerting.
 */
export async function GET(req: NextRequest) {
  const deep = req.nextUrl.searchParams.has("deep");
  const shallow = {
    ok: true,
    status: "ok" as const,
    time: new Date().toISOString(),
    version: "0.1.0",
    uptimeSec: Math.round(process.uptime()),
  };

  if (!deep) return NextResponse.json(shallow);

  const [postgres, redis, s3] = await Promise.all([
    timed(async () => {
      await getDb().execute(sql`select 1`);
    }),
    timed(async () => {
      const r = getAppConnection();
      const pong = await r.ping();
      if (pong !== "PONG") throw new Error(`unexpected ping response: ${pong}`);
    }),
    timed(async () => {
      await probeBucket();
    }),
  ]);

  const allOk = postgres.ok && redis.ok && s3.ok;
  return NextResponse.json(
    { ...shallow, ok: allOk, checks: { postgres, redis, s3 } },
    { status: allOk ? 200 : 503 },
  );
}
