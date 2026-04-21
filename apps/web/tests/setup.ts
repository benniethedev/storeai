import path from "node:path";
import fs from "node:fs";
import { config } from "dotenv";
import { beforeAll, afterAll } from "vitest";

function loadEnv() {
  const start = process.cwd();
  let dir = start;
  for (let i = 0; i < 6; i++) {
    const candidate = path.join(dir, ".env");
    if (fs.existsSync(candidate)) {
      config({ path: candidate });
      return;
    }
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
}
loadEnv();
Object.assign(process.env, { NODE_ENV: "test" });

beforeAll(async () => {
  const { getDb } = await import("@storeai/db");
  const { sql } = await import("drizzle-orm");
  const db = getDb();
  await db.execute(sql`select 1`);
});

afterAll(async () => {
  const { closeDb } = await import("@storeai/db");
  const { closeRedis, closeQueues } = await import("@storeai/queue");
  await closeQueues().catch(() => {});
  await closeRedis().catch(() => {});
  await closeDb().catch(() => {});
});
