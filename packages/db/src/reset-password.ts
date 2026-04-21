/**
 * Rotate a single user's password. Useful when you signed up through the
 * UI, forgot the password, and don't want to nuke the whole DB.
 *
 * Usage:
 *   pnpm --filter @storeai/db run reset-password -- --email you@example.com --password 'newpass1234'
 *   # or interactive (prompts):
 *   pnpm --filter @storeai/db run reset-password
 */
import { loadEnvFromRepoRoot } from "./loadEnv.js";
loadEnvFromRepoRoot();

import argon2 from "argon2";
import { eq } from "drizzle-orm";
import readline from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import { getDb, closeDb } from "./client.js";
import { users } from "./schema.js";

function parseArgs(argv: string[]): { email?: string; password?: string } {
  const out: { email?: string; password?: string } = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--email" && argv[i + 1]) {
      out.email = argv[i + 1];
      i++;
    } else if (a === "--password" && argv[i + 1]) {
      out.password = argv[i + 1];
      i++;
    }
  }
  return out;
}

async function promptIfMissing(email: string | undefined, password: string | undefined) {
  if (email && password) return { email, password };
  const rl = readline.createInterface({ input, output });
  try {
    const e = email ?? (await rl.question("Email: "));
    const p = password ?? (await rl.question("New password (8+ chars): "));
    return { email: e.trim().toLowerCase(), password: p };
  } finally {
    rl.close();
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const { email, password } = await promptIfMissing(args.email, args.password);

  if (!email || !email.includes("@")) {
    console.error("Invalid email.");
    process.exit(1);
  }
  if (!password || password.length < 8) {
    console.error("Password must be 8+ characters.");
    process.exit(1);
  }

  const db = getDb();
  const existing = await db
    .select({ id: users.id, email: users.email })
    .from(users)
    .where(eq(users.email, email.toLowerCase()))
    .limit(1);
  if (!existing[0]) {
    console.error(`No user with email ${email} — have you run the app and signed up, or run 'pnpm db:seed'?`);
    await closeDb();
    process.exit(1);
  }

  const passwordHash = await argon2.hash(password, { type: argon2.argon2id });
  await db
    .update(users)
    .set({ passwordHash, updatedAt: new Date() })
    .where(eq(users.id, existing[0].id));

  console.log(`Password updated for ${existing[0].email}.`);
  await closeDb();
}

main().catch(async (err) => {
  console.error(err);
  await closeDb();
  process.exit(1);
});
