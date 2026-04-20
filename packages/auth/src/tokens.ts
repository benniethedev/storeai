import { randomBytes, createHash, createHmac, timingSafeEqual } from "node:crypto";

export function randomToken(bytes = 32): string {
  return randomBytes(bytes).toString("base64url");
}

export function sha256Hex(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function getAuthSecret(): string {
  const s = process.env.AUTH_SECRET;
  if (!s || s.length < 32) {
    throw new Error(
      "AUTH_SECRET is not set or is too short (<32 chars). " +
        "Run `pnpm bootstrap` or generate one with " +
        `node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))".`,
    );
  }
  return s;
}

/**
 * HMAC-SHA256 a secret value with the server's AUTH_SECRET, return hex.
 * Used for session-token and API-key hashing so a DB leak alone cannot be
 * replayed — the attacker would also need AUTH_SECRET.
 */
export function hmacHex(value: string): string {
  return createHmac("sha256", getAuthSecret()).update(value).digest("hex");
}

export function constantTimeEqual(a: string, b: string): boolean {
  const aBuf = Buffer.from(a);
  const bBuf = Buffer.from(b);
  if (aBuf.length !== bBuf.length) return false;
  return timingSafeEqual(aBuf, bBuf);
}
