import path from "node:path";
import fs from "node:fs";
import { config as dotenvConfig } from "dotenv";
import { defineConfig } from "drizzle-kit";

// Walk up to find .env (drizzle-kit loads this config directly with no
// bundler — can't use workspace-local helpers with .js extensions).
(function loadRootEnv() {
  let dir = process.cwd();
  for (let i = 0; i < 6; i++) {
    const candidate = path.join(dir, ".env");
    if (fs.existsSync(candidate)) { dotenvConfig({ path: candidate }); return; }
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  dotenvConfig();
})();

export default defineConfig({
  schema: "./src/schema.ts",
  out: "./drizzle",
  dialect: "postgresql",
  dbCredentials: {
    url: process.env.DATABASE_URL ?? "",
  },
  strict: true,
  verbose: true,
});
