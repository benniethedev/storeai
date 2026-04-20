import "server-only";
import path from "node:path";
import fs from "node:fs";
import { getEnv } from "@storeai/shared/env";

function loadRepoRootEnv() {
  if (process.env.__STOREAI_ROOT_ENV_LOADED === "1") return;
  // Walk up to find a .env at the repo root if Next.js didn't see it
  const startDir = process.cwd();
  let dir = startDir;
  for (let i = 0; i < 5; i++) {
    const candidate = path.join(dir, ".env");
    if (fs.existsSync(candidate) && !process.env.DATABASE_URL) {
      const text = fs.readFileSync(candidate, "utf8");
      for (const line of text.split("\n")) {
        const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
        if (m && !process.env[m[1]!]) {
          process.env[m[1]!] = m[2]!.replace(/^["']|["']$/g, "");
        }
      }
      break;
    }
    dir = path.dirname(dir);
    if (dir === "/") break;
  }
  process.env.__STOREAI_ROOT_ENV_LOADED = "1";
}

loadRepoRootEnv();

export const env = getEnv();
