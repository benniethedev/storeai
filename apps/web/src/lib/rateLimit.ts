import "server-only";
import { getAppConnection } from "@storeai/queue";
import { RateLimitedError } from "@storeai/shared/errors";
import { redisSafe } from "./redisSafe.js";
import { incrCounter } from "./metrics.js";

/**
 * Fixed-window rate limiter in Redis. Simple and good-enough for v1.
 * Fails OPEN if Redis is unavailable — we'd rather serve legitimate traffic
 * through a Redis outage than hard-fail auth flows. Absolute rate limits
 * should be enforced upstream (reverse proxy / WAF) in production.
 *
 * In tests the limiter is a no-op by default (so counters don't leak across
 * test runs). Set FORCE_RATE_LIMIT=1 for tests that want to exercise it.
 */
function isBypassed(): boolean {
  const force = process.env.FORCE_RATE_LIMIT === "1";
  if (force) return false;
  return process.env.NODE_ENV === "test" || process.env.DISABLE_RATE_LIMIT === "1";
}

export async function rateLimit(args: {
  key: string;
  limit: number;
  windowSeconds: number;
}): Promise<void> {
  if (isBypassed()) return;

  const count = await redisSafe<number | null>(
    async () => {
      const redis = getAppConnection();
      const bucket = Math.floor(Date.now() / 1000 / args.windowSeconds);
      const redisKey = `rl:${args.key}:${bucket}`;
      const pipeline = redis.multi();
      pipeline.incr(redisKey);
      pipeline.expire(redisKey, args.windowSeconds + 1);
      const res = await pipeline.exec();
      const c = res?.[0]?.[1] as number | undefined;
      return typeof c === "number" ? c : null;
    },
    null,
    `rl:${args.key}`,
  );

  if (count !== null && count > args.limit) {
    void incrCounter("rate_limited");
    throw new RateLimitedError();
  }
}

/**
 * Seconds remaining in the current fixed window — handy for `Retry-After`.
 */
export function retryAfterSeconds(windowSeconds: number): number {
  const nowSec = Date.now() / 1000;
  const boundary = Math.ceil(nowSec / windowSeconds) * windowSeconds;
  return Math.max(1, Math.ceil(boundary - nowSec));
}
