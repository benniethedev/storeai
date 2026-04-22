/**
 * Issue a new ops token for external read-only monitoring dashboards.
 *
 * Usage:
 *   pnpm ops:issue-token --name "netswagger-dashboard"
 *
 * Prints the token ONCE. Store it securely. Only the argon2id hash is
 * persisted. There is no UI to list, rotate, or recover tokens — operators
 * re-issue and revoke via this CLI over SSH.
 */
import { loadEnvFromRepoRoot } from "./loadEnv.js";
loadEnvFromRepoRoot();

import { issueOpsToken } from "@storeai/auth";
import { closeDb } from "./client.js";

function parseArgs(argv: string[]): { name?: string } {
  const out: { name?: string } = {};
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--name" && argv[i + 1]) {
      out.name = argv[i + 1];
      i++;
    }
  }
  return out;
}

async function main() {
  const { name } = parseArgs(process.argv.slice(2));
  if (!name) {
    console.error("Usage: pnpm ops:issue-token --name <label>");
    process.exit(1);
  }

  const { plaintext, token } = await issueOpsToken({ name });
  console.log();
  console.log("  Ops token issued.");
  console.log();
  console.log(`  Name:  ${token.name}`);
  console.log(`  ID:    ${token.id}`);
  console.log();
  console.log("  Token (shown once — copy now):");
  console.log();
  console.log(`    ${plaintext}`);
  console.log();
  console.log("  Use it as:   Authorization: Bearer <token>");
  console.log("  Revoke via:  UPDATE ops_tokens SET revoked_at = now() WHERE id = '<id>';");
  console.log();

  await closeDb();
}

main().catch(async (err) => {
  console.error(err);
  await closeDb();
  process.exit(1);
});
