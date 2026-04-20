import IORedis, { type Redis } from "ioredis";

let cached: Redis | null = null;

export function getRedisConnection(): Redis {
  if (cached) return cached;
  const url = process.env.REDIS_URL;
  if (!url) throw new Error("REDIS_URL not set");
  cached = new IORedis(url, {
    maxRetriesPerRequest: null,
    enableReadyCheck: true,
  });
  return cached;
}

export async function closeRedis(): Promise<void> {
  if (cached) {
    await cached.quit();
    cached = null;
  }
}
