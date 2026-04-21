import IORedis, { type Redis } from "ioredis";

/**
 * Two Redis connections.
 *
 * - `getBullConnection()` — used by BullMQ queues and workers. MUST set
 *   `maxRetriesPerRequest: null` because BullMQ uses blocking commands
 *   (BRPOPLPUSH). A dropped command here would break job pickup.
 *
 * - `getAppConnection()` — used by non-queue Redis callers (rate limiter,
 *   cache, etc.). We want these calls to FAIL FAST on a Redis hiccup so the
 *   HTTP request path doesn't hang. Combined with `redisSafe()` in the app,
 *   a Redis outage degrades gracefully (no rate limit / no cache) instead
 *   of wedging requests.
 *
 * Both share the same TCP connection per process, but use different option
 * sets so failure semantics suit the caller.
 */

let bullConn: Redis | null = null;
let appConn: Redis | null = null;

function makeConnection(kind: "bull" | "app"): Redis {
  const url = process.env.REDIS_URL;
  if (!url) throw new Error("REDIS_URL not set");
  const base = {
    enableReadyCheck: true,
    retryStrategy(times: number) {
      // cap exponential backoff at 5s so reconnection tries forever
      return Math.min(times * 200, 5000);
    },
  };
  if (kind === "bull") {
    return new IORedis(url, { ...base, maxRetriesPerRequest: null });
  }
  return new IORedis(url, {
    ...base,
    maxRetriesPerRequest: 2,
    connectTimeout: 5000,
    commandTimeout: 2000,
    lazyConnect: false,
  });
}

/**
 * Legacy name kept for BullMQ callers (Queue, Worker, QueueEvents).
 */
export function getRedisConnection(): Redis {
  return getBullConnection();
}

export function getBullConnection(): Redis {
  if (bullConn) return bullConn;
  bullConn = makeConnection("bull");
  bullConn.on("error", (e) => console.warn("[redis:bull] error:", e.message));
  return bullConn;
}

export function getAppConnection(): Redis {
  if (appConn) return appConn;
  appConn = makeConnection("app");
  appConn.on("error", (e) => console.warn("[redis:app] error:", e.message));
  return appConn;
}

export async function closeRedis(): Promise<void> {
  await Promise.all(
    [bullConn, appConn].map(async (c) => {
      if (c) await c.quit().catch(() => undefined);
    }),
  );
  bullConn = null;
  appConn = null;
}
