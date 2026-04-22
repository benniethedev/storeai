import argon2 from "argon2";
import { and, eq, isNull } from "drizzle-orm";
import { getDb, opsTokens, type OpsToken } from "@storeai/db";
import { randomToken } from "./tokens.js";

export const OPS_TOKEN_PREFIX = "sa_ops_";

export interface IssuedOpsToken {
  plaintext: string;
  token: OpsToken;
}

export async function issueOpsToken(args: { name: string }): Promise<IssuedOpsToken> {
  if (!args.name || args.name.length < 1 || args.name.length > 120) {
    throw new Error("Ops token name must be 1-120 characters");
  }
  const secret = randomToken(48); // 48 random bytes → 64 base64url chars
  const plaintext = `${OPS_TOKEN_PREFIX}${secret}`;
  const tokenHash = await argon2.hash(secret, { type: argon2.argon2id });
  const db = getDb();
  const [row] = await db
    .insert(opsTokens)
    .values({ name: args.name, tokenHash })
    .returning();
  if (!row) throw new Error("Failed to create ops token");
  return { plaintext, token: row };
}

export async function revokeOpsToken(args: { id: string }): Promise<void> {
  const db = getDb();
  await db
    .update(opsTokens)
    .set({ revokedAt: new Date() })
    .where(eq(opsTokens.id, args.id));
}

export interface ResolvedOpsToken {
  token: OpsToken;
}

/**
 * Verify a bearer token against the ops_tokens table.
 *
 * Tokens are argon2id-hashed with random salts, so we can't look up by hash.
 * Instead we fetch all non-revoked tokens and verify against each. For a
 * low-volume endpoint (dashboard polls every 30-60s, handful of issued
 * tokens) this is fine. If the table ever grows past ~50 rows, switch to
 * an HMAC prefix for O(1) lookup.
 */
export async function resolveOpsToken(bearer: string): Promise<ResolvedOpsToken | null> {
  if (!bearer || !bearer.startsWith(OPS_TOKEN_PREFIX)) return null;
  const secret = bearer.slice(OPS_TOKEN_PREFIX.length);
  if (secret.length < 32) return null;

  const db = getDb();
  const rows = await db
    .select()
    .from(opsTokens)
    .where(isNull(opsTokens.revokedAt));

  for (const row of rows) {
    let valid = false;
    try {
      valid = await argon2.verify(row.tokenHash, secret);
    } catch {
      valid = false;
    }
    if (valid) {
      await db
        .update(opsTokens)
        .set({ lastUsedAt: new Date() })
        .where(eq(opsTokens.id, row.id));
      return { token: row };
    }
  }
  return null;
}
