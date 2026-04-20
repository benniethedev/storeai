import path from "node:path";
import fs from "node:fs";
import { config } from "dotenv";

/**
 * Walk up from the current file until we find a .env at a parent.
 * Works whether the script is run from the package dir or the repo root.
 */
export function loadEnvFromRepoRoot(): void {
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
  config();
}
