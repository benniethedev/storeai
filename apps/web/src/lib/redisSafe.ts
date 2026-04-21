import "server-only";

/**
 * Run a Redis-dependent operation with a hard timeout and a fallback value.
 * On timeout or error we log once and return `fallback` so the request can
 * proceed — the app degrades (no rate limit, no job enqueue) rather than
 * failing the caller.
 *
 * This is intentional for non-critical Redis calls (rate limit, fanout
 * jobs). Callers that cannot proceed without Redis (e.g. session lookup —
 * we don't currently have any) should NOT use this helper.
 */
export async function redisSafe<T>(
  op: () => Promise<T>,
  fallback: T,
  label: string,
  timeoutMs = 2000,
): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      op(),
      new Promise<T>((_, reject) => {
        timer = setTimeout(() => reject(new Error("redis timeout")), timeoutMs);
      }),
    ]);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    // One line per failure; avoid log spam by not including the full stack.
    console.warn(`[redis-safe:${label}] degraded: ${msg}`);
    return fallback;
  } finally {
    if (timer) clearTimeout(timer);
  }
}
