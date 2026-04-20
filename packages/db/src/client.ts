import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema.js";

export type DbClient = ReturnType<typeof drizzle<typeof schema>>;

declare global {
  // eslint-disable-next-line no-var
  var __storeai_db: { sql: ReturnType<typeof postgres>; db: DbClient } | undefined;
}

export function getDb(): DbClient {
  if (globalThis.__storeai_db) return globalThis.__storeai_db.db;
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL not set");
  const sql = postgres(url, {
    max: Number(process.env.PG_POOL_SIZE ?? 10),
    idle_timeout: 20,
    max_lifetime: 60 * 30,
    prepare: true,
  });
  const db = drizzle(sql, { schema });
  globalThis.__storeai_db = { sql, db };
  return db;
}

export async function closeDb(): Promise<void> {
  if (globalThis.__storeai_db) {
    await globalThis.__storeai_db.sql.end({ timeout: 5 });
    globalThis.__storeai_db = undefined;
  }
}

export { schema };
