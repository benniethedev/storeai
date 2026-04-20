import { and, eq, gt } from "drizzle-orm";
import { getDb, sessions, users, memberships, type User, type Session } from "@storeai/db";
import { randomToken, hmacHex } from "./tokens.js";

export const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

export interface CreatedSession {
  token: string;
  csrfToken: string;
  session: Session;
}

export async function createSession(args: {
  userId: string;
  activeTenantId?: string | null;
  userAgent?: string | null;
  ip?: string | null;
}): Promise<CreatedSession> {
  const token = randomToken(32);
  const csrfToken = randomToken(24);
  const tokenHash = hmacHex(token);
  const expiresAt = new Date(Date.now() + SESSION_TTL_MS);
  const db = getDb();
  const [session] = await db
    .insert(sessions)
    .values({
      tokenHash,
      userId: args.userId,
      activeTenantId: args.activeTenantId ?? null,
      csrfToken,
      expiresAt,
      userAgent: args.userAgent ?? null,
      ip: args.ip ?? null,
    })
    .returning();
  if (!session) throw new Error("Failed to create session");
  return { token, csrfToken, session };
}

export async function revokeSessionByToken(token: string): Promise<void> {
  const tokenHash = hmacHex(token);
  const db = getDb();
  await db.delete(sessions).where(eq(sessions.tokenHash, tokenHash));
}

export async function revokeSessionById(sessionId: string): Promise<void> {
  const db = getDb();
  await db.delete(sessions).where(eq(sessions.id, sessionId));
}

export interface ResolvedSession {
  session: Session;
  user: User;
}

export async function resolveSession(token: string): Promise<ResolvedSession | null> {
  if (!token) return null;
  const tokenHash = hmacHex(token);
  const db = getDb();
  const rows = await db
    .select({ session: sessions, user: users })
    .from(sessions)
    .innerJoin(users, eq(users.id, sessions.userId))
    .where(and(eq(sessions.tokenHash, tokenHash), gt(sessions.expiresAt, new Date())))
    .limit(1);
  const row = rows[0];
  if (!row) return null;
  // Slide last-seen (non-critical if this fails)
  await db
    .update(sessions)
    .set({ lastSeenAt: new Date() })
    .where(eq(sessions.id, row.session.id));
  return { session: row.session, user: row.user };
}

export async function setActiveTenant(args: {
  sessionId: string;
  userId: string;
  tenantId: string;
}): Promise<void> {
  const db = getDb();
  // verify membership
  const mem = await db
    .select()
    .from(memberships)
    .where(and(eq(memberships.userId, args.userId), eq(memberships.tenantId, args.tenantId)))
    .limit(1);
  if (!mem[0]) throw new Error("User is not a member of this tenant");
  await db
    .update(sessions)
    .set({ activeTenantId: args.tenantId })
    .where(eq(sessions.id, args.sessionId));
}
