import "server-only";
import { NextResponse, type NextRequest } from "next/server";
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
import { ForbiddenError } from "@storeai/shared/errors";
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
}

const MUTATING = new Set(["POST", "PUT", "PATCH", "DELETE"]);
const IDEMPOTENCY_KEY_MAX = 120;

export function tenantRoute<T = unknown>(opts: TenantRouteOptions, handler: Handler<T>) {
  return async (req: NextRequest, routeCtx: { params: Promise<T> }): Promise<NextResponse> => {
    const started = Date.now();
    let status = 500;
    let ctx: TenantCtx | null = null;
    try {
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
      const idempotency = await findIdempotentReplay(req, ctx).catch((error) => {
        console.error("[idempotency] replay lookup failed", {
          route: new URL(req.url).pathname,
          method: req.method,
          error: error instanceof Error ? error.message : String(error),
        });
        return null;
      });
      if (idempotency) {
        status = idempotency.status;
        return NextResponse.json(idempotency.body, {
          status,
          headers: { "x-storeai-idempotent-replay": "true" },
        });
      }

      const res = await handler({ req, ctx, params });
      status = res.status;
      await storeIdempotentResponse(req, ctx, res).catch(() => {});
      return res;
    } catch (err) {
      const res = handleError(err);
      status = res.status;
      if (ctx) {
        void writeErrorLogFromResponse(req, ctx, res).catch(() => {});
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
): Promise<void> {
  const body = (await res.clone().json().catch(() => null)) as
    | { error?: { code?: string; message?: string; requestId?: string; stack?: string } }
    | null;
  await writeErrorLog({
    tenantId: ctx.tenantId,
    userId: ctx.user?.id ?? null,
    apiKeyId: ctx.apiKeyId,
    route: new URL(req.url).pathname,
    method: req.method,
    statusCode: res.status,
    code: body?.error?.code ?? `http_${res.status}`,
    message: body?.error?.message ?? "Request failed",
    requestId: body?.error?.requestId ?? res.headers.get("x-request-id"),
    stack: body?.error?.stack,
  });
}

async function findIdempotentReplay(
  req: NextRequest,
  ctx: TenantCtx,
): Promise<{ status: number; body: unknown } | null> {
  const key = normalizedIdempotencyKey(req);
  if (!key) return null;
  const route = new URL(req.url).pathname;
  const rows = await getDb()
    .select({
      statusCode: idempotencyKeys.statusCode,
      responseBody: idempotencyKeys.responseBody,
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
  return row ? { status: row.statusCode, body: row.responseBody } : null;
}

async function storeIdempotentResponse(
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
    .insert(idempotencyKeys)
    .values({
      tenantId: ctx.tenantId,
      actorUserId: ctx.user?.id ?? null,
      actorApiKeyId: ctx.apiKeyId,
      key,
      method: req.method.toUpperCase(),
      route: new URL(req.url).pathname,
      statusCode: res.status,
      responseBody: body,
    })
    .onConflictDoNothing();
}

function normalizedIdempotencyKey(req: NextRequest): string | null {
  if (!MUTATING.has(req.method.toUpperCase())) return null;
  const key = req.headers.get("idempotency-key")?.trim();
  if (!key) return null;
  return key.slice(0, IDEMPOTENCY_KEY_MAX);
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
