import { randomBytes } from "node:crypto";
import { and, eq, isNull } from "drizzle-orm";
import { getDb, apiKeys, type ApiKey } from "@storeai/db";
import { randomToken, sha256Hex, constantTimeEqual } from "./tokens.js";

export const API_KEY_PUBLIC_PREFIX = "sk_";
const PREFIX_LENGTH = 10; // after "sk_", so full visible prefix is 13 chars
const PREFIX_ALPHABET = "abcdefghijklmnopqrstuvwxyz0123456789";

function randomAlphanum(length: number): string {
  const bytes = randomBytes(length);
  let out = "";
  for (let i = 0; i < length; i++) {
    out += PREFIX_ALPHABET[bytes[i]! % PREFIX_ALPHABET.length];
  }
  return out;
}

export interface CreatedApiKey {
  plaintext: string;
  prefix: string;
  apiKey: ApiKey;
}

export async function createApiKey(args: {
  tenantId: string;
  createdByUserId: string;
  name: string;
}): Promise<CreatedApiKey> {
  const secret = randomToken(24);
  const prefixRaw = randomAlphanum(PREFIX_LENGTH);
  const prefix = `${API_KEY_PUBLIC_PREFIX}${prefixRaw}`;
  const plaintext = `${prefix}_${secret}`;
  const secretHash = sha256Hex(secret);
  const db = getDb();
  const [row] = await db
    .insert(apiKeys)
    .values({
      tenantId: args.tenantId,
      createdByUserId: args.createdByUserId,
      name: args.name,
      prefix,
      secretHash,
    })
    .returning();
  if (!row) throw new Error("Failed to create API key");
  return { plaintext, prefix, apiKey: row };
}

export async function revokeApiKey(args: { apiKeyId: string; tenantId: string }): Promise<void> {
  const db = getDb();
  await db
    .update(apiKeys)
    .set({ revokedAt: new Date() })
    .where(and(eq(apiKeys.id, args.apiKeyId), eq(apiKeys.tenantId, args.tenantId)));
}

export interface ResolvedApiKey {
  apiKey: ApiKey;
}

/**
 * Bearer formats accepted:
 *   sk_<10chars>_<secret>
 * The prefix is looked up unique; the secret is compared with constant time.
 */
export async function resolveApiKey(bearer: string): Promise<ResolvedApiKey | null> {
  if (!bearer || !bearer.startsWith(API_KEY_PUBLIC_PREFIX)) return null;
  // Format: sk_<10-char-alphanum>_<secret>. The secret itself may contain '_'
  // (base64url alphabet), so we only split off the prefix portion.
  const afterSk = bearer.slice(API_KEY_PUBLIC_PREFIX.length);
  const sep = afterSk.indexOf("_");
  if (sep !== PREFIX_LENGTH) return null;
  const prefixBody = afterSk.slice(0, sep);
  const secret = afterSk.slice(sep + 1);
  if (!prefixBody || !secret) return null;
  const prefix = `${API_KEY_PUBLIC_PREFIX}${prefixBody}`;
  const db = getDb();
  const rows = await db
    .select()
    .from(apiKeys)
    .where(and(eq(apiKeys.prefix, prefix), isNull(apiKeys.revokedAt)))
    .limit(1);
  const row = rows[0];
  if (!row) return null;
  const hashed = sha256Hex(secret);
  if (!constantTimeEqual(hashed, row.secretHash)) return null;
  // update last_used_at (best effort)
  await db.update(apiKeys).set({ lastUsedAt: new Date() }).where(eq(apiKeys.id, row.id));
  return { apiKey: row };
}
