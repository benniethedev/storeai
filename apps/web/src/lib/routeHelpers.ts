import "server-only";
import { NextRequest, NextResponse } from "next/server";
import { createHash } from "node:crypto";
import { handleError } from "./http.js";
import {
  getUserSessionFromRequest,
  requireTenantContext,
  writeErrorLog,
  writeUsageLog,
  type TenantCtx,
  type UserSessionCtx,
} from "./context.js";
import { and, eq } from "drizzle-orm";
import { getDb, idempotencyKeys } from "@storeai/db";
import { AppError, ForbiddenError } from "@storeai/shared/errors";
import { Permissions, type ApiKeyScope, type TenantRole } from "@storeai/shared";
import { env } from "@/env.server";
import { incrHashField, statusClass } from "./metrics.js";

type Handler<T = unknown> = (args: {
  req: NextRequest;
  ctx: TenantCtx;
  params: T;
}) => Promise<NextResponse>;

export interface TenantRouteOptions {
  requireRole?: TenantRole;
  allowApiKey?: boolean;
  csrfExempt?: boolean;
  requiredScope?: ApiKeyScope;
  eagerRequestBody?: boolean;
}

const MUTATING = new Set(["POST", "PUT", "PATCH", "DELETE"]);
const IDEMPOTENCY_KEY_MAX = 120;
const IDEMPOTENCY_LEASE_MS = 5 * 60 * 1000;

export function tenantRoute<T = unknown>(opts: TenantRouteOptions, handler: Handler<T>) {
  return async (req: NextRequest, routeCtx: { params: Promise<T> }): Promise<NextResponse> => {
    const started = Date.now();
    let status = 500;
    let ctx: TenantCtx | null = null;
    let ownsIdempotencyReservation = false;
    try {
      if (opts.eagerRequestBody && MUTATING.has(req.method.toUpperCase())) {
        const body = await req.arrayBuffer();
        req = new NextRequest(req.url, {
          method: req.method,
          headers: req.headers,
          body,
        });
      }
      ctx = await requireTenantContext(req, { allowApiKey: opts.allowApiKey });
      if (
        ctx.kind === "user" &&
        !opts.csrfExempt &&
        MUTATING.has(req.method.toUpperCase())
      ) {
        const header = req.headers.get("x-sa-csrf");
        if (!header || !ctx.session || header !== ctx.session.csrfToken) {
          throw new ForbiddenError("Missing or invalid CSRF token");
        }
      }

      if (opts.requireRole) {
        const required = opts.requireRole;
        const ok =
          required === "owner"
            ? Permissions.canManageTenant(ctx.role)
            : required === "admin"
              ? Permissions.canManageMembers(ctx.role)
              : Permissions.canRead(ctx.role);
        if (!ok) throw new ForbiddenError("Insufficient role");
      }

      if (ctx.kind === "api_key" && opts.requiredScope && ctx.apiKeyScopes) {
        if (!ctx.apiKeyScopes.includes(opts.requiredScope)) {
          throw new ForbiddenError(`API key missing required scope: ${opts.requiredScope}`);
        }
      }

      const params = (await routeCtx.params) as T;
      const idempotency = await reserveIdempotency(req, ctx);
      if (idempotency) {
        status = idempotency.status;
        return NextResponse.json(idempotency.body, {
          status,
          headers: { "x-storeai-idempotent-replay": "true" },
        });
      }
      ownsIdempotencyReservation = normalizedIdempotencyKey(req) !== null;

      const res = await handler({ req, ctx, params });
      status = res.status;
      if (res.status >= 200 && res.status < 300) {
        await completeIdempotency(req, ctx, res);
      } else {
        if (ownsIdempotencyReservation) await releasePendingIdempotency(req, ctx);
      }
      return res;
    } catch (err) {
      if (ctx && ownsIdempotencyReservation) {
        await releasePendingIdempotency(req, ctx).catch(() => {});
      }
      const res = handleError(err);
      status = res.status;
      if (ctx) {
        void writeErrorLogFromResponse(req, ctx, res, err).catch(() => {});
      }
      return res;
    } finally {
      const duration = Date.now() - started;
      // Aggregate status-class counter for the ops endpoint.
      void incrHashField("http", statusClass(status));
      if (ctx) {
        void writeUsageLog({
          tenantId: ctx.tenantId,
          userId: ctx.user?.id ?? null,
          apiKeyId: ctx.apiKeyId,
          route: new URL(req.url).pathname,
          method: req.method,
          statusCode: status,
          durationMs: duration,
        }).catch(() => {});
      }
    }
  };
}

async function writeErrorLogFromResponse(
  req: NextRequest,
  ctx: TenantCtx,
  res: NextResponse,
  err?: unknown,
): Promise<void> {
  const body = (await res.clone().json().catch(() => null)) as
    | { error?: { code?: string; message?: string; requestId?: string; stack?: string } }
    | null;
  const rawError = err instanceof Error ? err : null;
  const responseCode = body?.error?.code ?? `http_${res.status}`;
  await writeErrorLog({
    tenantId: ctx.tenantId,
    userId: ctx.user?.id ?? null,
    apiKeyId: ctx.apiKeyId,
    route: new URL(req.url).pathname,
    method: req.method,
    statusCode: res.status,
    code: responseCode,
    message:
      responseCode === "internal_error" && rawError?.message
        ? rawError.message
        : body?.error?.message ?? "Request failed",
    requestId: body?.error?.requestId ?? res.headers.get("x-request-id"),
    stack: body?.error?.stack ?? rawError?.stack,
  });
}

async function reserveIdempotency(
  req: NextRequest,
  ctx: TenantCtx,
): Promise<{ status: number; body: unknown } | null> {
  const key = normalizedIdempotencyKey(req);
  if (!key) return null;
  const route = new URL(req.url).pathname;
  const requestHash = await idempotencyRequestHash(req);
  const leaseExpiresAt = new Date(Date.now() + IDEMPOTENCY_LEASE_MS);
  const inserted = await getDb()
    .insert(idempotencyKeys)
    .values({
      tenantId: ctx.tenantId,
      actorUserId: ctx.user?.id ?? null,
      actorApiKeyId: ctx.apiKeyId,
      key,
      method: req.method.toUpperCase(),
      route,
      requestHash,
      state: "pending",
      leaseExpiresAt,
    })
    .onConflictDoNothing()
    .returning({ id: idempotencyKeys.id });
  if (inserted[0]) return null;

  const rows = await getDb()
    .select({
      state: idempotencyKeys.state,
      requestHash: idempotencyKeys.requestHash,
      statusCode: idempotencyKeys.statusCode,
      responseBody: idempotencyKeys.responseBody,
      leaseExpiresAt: idempotencyKeys.leaseExpiresAt,
    })
    .from(idempotencyKeys)
    .where(
      and(
        eq(idempotencyKeys.tenantId, ctx.tenantId),
        eq(idempotencyKeys.key, key),
        eq(idempotencyKeys.method, req.method.toUpperCase()),
        eq(idempotencyKeys.route, route),
      ),
    )
    .limit(1);
  const row = rows[0];
  if (!row) throw new AppError(409, "idempotency_conflict", "Idempotency reservation changed; retry");
  if (row.requestHash && row.requestHash !== requestHash) {
    throw new AppError(
      409,
      "idempotency_conflict",
      "Idempotency key was already used with a different request",
    );
  }
  if (row.state === "completed" && row.statusCode !== null && row.responseBody !== null) {
    return { status: row.statusCode, body: row.responseBody };
  }
  const stale = row.leaseExpiresAt !== null && row.leaseExpiresAt.getTime() <= Date.now();
  throw new AppError(
    409,
    stale ? "idempotency_recovery_required" : "idempotency_in_progress",
    stale
      ? "The original request may have completed; inspect state before retrying with a new key"
      : "A request with this idempotency key is already in progress",
  );
}

async function completeIdempotency(
  req: NextRequest,
  ctx: TenantCtx,
  res: NextResponse,
): Promise<void> {
  const key = normalizedIdempotencyKey(req);
  if (!key || res.status < 200 || res.status >= 300) return;
  const contentType = res.headers.get("content-type") ?? "";
  if (!contentType.includes("application/json")) return;

  const body = await res.clone().json().catch(() => null);
  if (!body) return;
  await getDb()
    .update(idempotencyKeys)
    .set({
      state: "completed",
      statusCode: res.status,
      responseBody: body,
      completedAt: new Date(),
      leaseExpiresAt: null,
    })
    .where(idempotencyIdentity(req, ctx, key));
}

async function releasePendingIdempotency(req: NextRequest, ctx: TenantCtx): Promise<void> {
  const key = normalizedIdempotencyKey(req);
  if (!key) return;
  await getDb()
    .delete(idempotencyKeys)
    .where(and(idempotencyIdentity(req, ctx, key), eq(idempotencyKeys.state, "pending")));
}

function idempotencyIdentity(req: NextRequest, ctx: TenantCtx, key: string) {
  return and(
    eq(idempotencyKeys.tenantId, ctx.tenantId),
    eq(idempotencyKeys.key, key),
    eq(idempotencyKeys.method, req.method.toUpperCase()),
    eq(idempotencyKeys.route, new URL(req.url).pathname),
  );
}

async function idempotencyRequestHash(req: NextRequest): Promise<string> {
  const url = new URL(req.url);
  const bytes = Buffer.from(await req.clone().arrayBuffer());
  return createHash("sha256")
    .update(req.method.toUpperCase())
    .update("\n")
    .update(url.pathname)
    .update("\n")
    .update(url.search)
    .update("\n")
    .update(bytes)
    .digest("hex");
}

function normalizedIdempotencyKey(req: NextRequest): string | null {
  if (!MUTATING.has(req.method.toUpperCase())) return null;
  const key = req.headers.get("idempotency-key")?.trim();
  if (!key) return null;
  if (key.length > IDEMPOTENCY_KEY_MAX) {
    throw new AppError(
      400,
      "invalid_idempotency_key",
      `Idempotency key cannot exceed ${IDEMPOTENCY_KEY_MAX} characters`,
    );
  }
  return key;
}

export function userRoute<T = unknown>(
  handler: (args: {
    req: NextRequest;
    user: UserSessionCtx;
    params: T;
  }) => Promise<NextResponse>,
  opts: { csrfExempt?: boolean } = {},
) {
  return async (req: NextRequest, routeCtx: { params: Promise<T> }): Promise<NextResponse> => {
    let status = 500;
    try {
      const s = await getUserSessionFromRequest(req);
      if (!s) {
        status = 401;
        return NextResponse.json(
          { ok: false, error: { code: "unauthorized", message: "Unauthorized" } },
          { status: 401 },
        );
      }
      if (!opts.csrfExempt && MUTATING.has(req.method.toUpperCase())) {
        const header = req.headers.get("x-sa-csrf");
        if (!header || header !== s.session.csrfToken) {
          throw new ForbiddenError("Missing or invalid CSRF token");
        }
      }
      const params = (await routeCtx.params) as T;
      const res = await handler({ req, user: s, params });
      status = res.status;
      return res;
    } catch (err) {
      const res = handleError(err);
      status = res.status;
      return res;
    } finally {
      void incrHashField("http", statusClass(status));
    }
  };
}

export function sessionCookieOptions() {
  return {
    httpOnly: true,
    sameSite: "lax" as const,
    secure: env.NODE_ENV === "production",
    path: "/",
  };
}
