import "server-only";
import { cookies, headers } from "next/headers";
import type { NextRequest } from "next/server";
import { and, eq } from "drizzle-orm";
import { getDb, memberships, usageLogs, auditLogs, type Session, type User } from "@storeai/db";
import { resolveSession, resolveApiKey } from "@storeai/auth";
import type { TenantRole } from "@storeai/shared";
import { ForbiddenError, UnauthorizedError } from "@storeai/shared/errors";
import { env } from "@/env.server";

export interface UserSessionCtx {
  kind: "user";
  user: User;
  session: Session;
}

async function resolveSessionCtx(token: string | null | undefined): Promise<UserSessionCtx | null> {
  if (!token) return null;
  const resolved = await resolveSession(token);
  if (!resolved) return null;
  return { kind: "user", user: resolved.user, session: resolved.session };
}

/** For server components / pages — uses Next.js `cookies()` dynamic API. */
export async function getUserSession(): Promise<UserSessionCtx | null> {
  const cookieStore = await cookies();
  return resolveSessionCtx(cookieStore.get(env.SESSION_COOKIE_NAME)?.value);
}

/** For route handlers — reads directly off the NextRequest. */
export async function getUserSessionFromRequest(req: NextRequest): Promise<UserSessionCtx | null> {
  return resolveSessionCtx(req.cookies.get(env.SESSION_COOKIE_NAME)?.value);
}

export async function requireUserSession(): Promise<UserSessionCtx> {
  const s = await getUserSession();
  if (!s) throw new UnauthorizedError();
  return s;
}

export async function requireUserSessionFromRequest(req: NextRequest): Promise<UserSessionCtx> {
  const s = await getUserSessionFromRequest(req);
  if (!s) throw new UnauthorizedError();
  return s;
}

export interface TenantCtx {
  kind: "user" | "api_key";
  tenantId: string;
  user: User | null;
  apiKeyId: string | null;
  session: Session | null;
  role: TenantRole;
  actorLabel: string;
}

async function verifyMembership(userId: string, tenantId: string): Promise<TenantRole> {
  const db = getDb();
  const rows = await db
    .select()
    .from(memberships)
    .where(and(eq(memberships.userId, userId), eq(memberships.tenantId, tenantId)))
    .limit(1);
  const m = rows[0];
  if (!m) throw new ForbiddenError("Not a member of this tenant");
  return m.role;
}

export async function requireTenantContext(
  req: NextRequest,
  args?: { allowApiKey?: boolean; overrideTenantId?: string | null },
): Promise<TenantCtx> {
  const auth = req.headers.get("authorization") ?? "";
  if (args?.allowApiKey !== false && auth.toLowerCase().startsWith("bearer ")) {
    const bearer = auth.slice(7).trim();
    const res = await resolveApiKey(bearer);
    if (!res) throw new UnauthorizedError("Invalid API key");
    return {
      kind: "api_key",
      tenantId: res.apiKey.tenantId,
      user: null,
      apiKeyId: res.apiKey.id,
      session: null,
      role: "admin",
      actorLabel: `api_key:${res.apiKey.prefix}`,
    };
  }

  const s = await requireUserSessionFromRequest(req);
  const tenantId = args?.overrideTenantId ?? s.session.activeTenantId;
  if (!tenantId) throw new ForbiddenError("No active tenant selected");
  const role = await verifyMembership(s.user.id, tenantId);
  return {
    kind: "user",
    tenantId,
    user: s.user,
    apiKeyId: null,
    session: s.session,
    role,
    actorLabel: `user:${s.user.id}`,
  };
}

/** Variant for server components / pages where we only have a session cookie. */
export async function requireTenantContextForPage(): Promise<TenantCtx> {
  const s = await requireUserSession();
  const tenantId = s.session.activeTenantId;
  if (!tenantId) throw new ForbiddenError("No active tenant selected");
  const role = await verifyMembership(s.user.id, tenantId);
  return {
    kind: "user",
    tenantId,
    user: s.user,
    apiKeyId: null,
    session: s.session,
    role,
    actorLabel: `user:${s.user.id}`,
  };
}

export async function writeAuditLog(args: {
  ctx: TenantCtx;
  action: string;
  resourceType: string;
  resourceId?: string | null;
  metadata?: Record<string, unknown>;
}): Promise<string> {
  const db = getDb();
  const [row] = await db
    .insert(auditLogs)
    .values({
      tenantId: args.ctx.tenantId,
      actorUserId: args.ctx.user?.id ?? null,
      actorApiKeyId: args.ctx.apiKeyId,
      action: args.action,
      resourceType: args.resourceType,
      resourceId: args.resourceId ?? null,
      metadata: args.metadata ?? {},
    })
    .returning({ id: auditLogs.id });
  return row!.id;
}

export async function writeUsageLog(args: {
  tenantId: string;
  userId: string | null;
  apiKeyId: string | null;
  route: string;
  method: string;
  statusCode: number;
  durationMs: number;
}): Promise<void> {
  const db = getDb();
  await db.insert(usageLogs).values({
    tenantId: args.tenantId,
    actorUserId: args.userId,
    actorApiKeyId: args.apiKeyId,
    route: args.route.slice(0, 255),
    method: args.method,
    statusCode: args.statusCode,
    durationMs: args.durationMs,
  });
}
