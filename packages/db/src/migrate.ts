import { loadEnvFromRepoRoot } from "./loadEnv.js";
loadEnvFromRepoRoot();
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";
import path from "node:path";
import { fileURLToPath } from "node:url";

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL not set");
  const sql = postgres(url, { max: 1 });
  const db = drizzle(sql);
  const here = path.dirname(fileURLToPath(import.meta.url));
  const migrationsFolder = path.resolve(here, "../drizzle");
  console.log(`Running migrations from ${migrationsFolder}`);
  await migrate(db, { migrationsFolder });
  await sql.end({ timeout: 5 });
  console.log("Migrations applied.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
