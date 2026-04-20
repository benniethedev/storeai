import "server-only";
import { getRedisConnection } from "@storeai/queue";
import { RateLimitedError } from "@storeai/shared/errors";

/**
 * Fixed-window rate limiter in Redis. Simple and good-enough for v1.
 * key: a stable identifier (e.g. `auth:ip:1.2.3.4` or `api:<keyId>`)
 */
export async function rateLimit(args: {
  key: string;
  limit: number;
  windowSeconds: number;
}): Promise<void> {
  if (process.env.NODE_ENV === "test" || process.env.DISABLE_RATE_LIMIT === "1") return;
  const redis = getRedisConnection();
  const bucket = Math.floor(Date.now() / 1000 / args.windowSeconds);
  const redisKey = `rl:${args.key}:${bucket}`;
  const pipeline = redis.multi();
  pipeline.incr(redisKey);
  pipeline.expire(redisKey, args.windowSeconds + 1);
  const res = await pipeline.exec();
  const count = res?.[0]?.[1] as number | undefined;
  if (!count) return;
  if (count > args.limit) throw new RateLimitedError();
}
