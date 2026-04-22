import "server-only";
import { getAppConnection } from "@storeai/queue";
import { redisSafe } from "./redisSafe.js";

/**
 * Daily bucket key. UTC so the dashboard agrees with whatever process is
 * reading. We keep daily counters with a modest TTL; the ops endpoint sums
 * today + yesterday for "last ~24h" numbers.
 */
export function todayKey(date: Date = new Date()): string {
  const y = date.getUTCFullYear();
  const m = String(date.getUTCMonth() + 1).padStart(2, "0");
  const d = String(date.getUTCDate()).padStart(2, "0");
  return `${y}${m}${d}`;
}

function yesterdayKey(): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - 1);
  return todayKey(d);
}

const TTL_SECONDS = 60 * 60 * 24 * 2; // 2 days — enough for "last 24h" windows

export async function incrCounter(name: string, by = 1): Promise<void> {
  await redisSafe(
    async () => {
      const r = getAppConnection();
      const key = `metrics:${name}:${todayKey()}`;
      const pipeline = r.multi();
      pipeline.incrby(key, by);
      pipeline.expire(key, TTL_SECONDS);
      await pipeline.exec();
      return null;
    },
    null,
    `metrics:incr:${name}`,
  );
}

export async function incrHashField(name: string, field: string, by = 1): Promise<void> {
  await redisSafe(
    async () => {
      const r = getAppConnection();
      const key = `metrics:${name}:${todayKey()}`;
      const pipeline = r.multi();
      pipeline.hincrby(key, field, by);
      pipeline.expire(key, TTL_SECONDS);
      await pipeline.exec();
      return null;
    },
    null,
    `metrics:hincrby:${name}:${field}`,
  );
}

export async function sumLast24h(name: string): Promise<number> {
  const val = await redisSafe<number | null>(
    async () => {
      const r = getAppConnection();
      const keys = [`metrics:${name}:${todayKey()}`, `metrics:${name}:${yesterdayKey()}`];
      const vals = await r.mget(...keys);
      return vals.reduce((acc, v) => acc + (v ? parseInt(v, 10) || 0 : 0), 0);
    },
    null,
    `metrics:sum:${name}`,
  );
  return val ?? 0;
}

export async function sumHashLast24h(name: string): Promise<Record<string, number>> {
  return (
    (await redisSafe<Record<string, number> | null>(
      async () => {
        const r = getAppConnection();
        const [today, yesterday] = await Promise.all([
          r.hgetall(`metrics:${name}:${todayKey()}`),
          r.hgetall(`metrics:${name}:${yesterdayKey()}`),
        ]);
        const out: Record<string, number> = {};
        for (const src of [today, yesterday]) {
          for (const [k, v] of Object.entries(src ?? {})) {
            out[k] = (out[k] ?? 0) + (parseInt(v, 10) || 0);
          }
        }
        return out;
      },
      null,
      `metrics:sum-hash:${name}`,
    )) ?? {}
  );
}

export function statusClass(status: number): "2xx" | "3xx" | "4xx" | "5xx" | "other" {
  if (status >= 200 && status < 300) return "2xx";
  if (status >= 300 && status < 400) return "3xx";
  if (status >= 400 && status < 500) return "4xx";
  if (status >= 500 && status < 600) return "5xx";
  return "other";
}
