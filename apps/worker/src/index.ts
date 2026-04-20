import path from "node:path";
import fs from "node:fs";
import { config } from "dotenv";

function loadRepoRootEnv() {
  let dir = process.cwd();
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
loadRepoRootEnv();

const { startWorkers } = await import("@storeai/queue");

console.log("[worker] starting...");
const { shutdown } = startWorkers();

const handler = async (sig: string) => {
  console.log(`[worker] ${sig} received, shutting down...`);
  await shutdown();
  process.exit(0);
};
process.on("SIGINT", () => void handler("SIGINT"));
process.on("SIGTERM", () => void handler("SIGTERM"));

console.log("[worker] ready.");
