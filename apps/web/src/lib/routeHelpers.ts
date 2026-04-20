import "server-only";
import { NextResponse, type NextRequest } from "next/server";
import { handleError } from "./http.js";
import {
  getUserSessionFromRequest,
  requireTenantContext,
  writeUsageLog,
  type TenantCtx,
  type UserSessionCtx,
} from "./context.js";
import { ForbiddenError } from "@storeai/shared/errors";
import { Permissions, type TenantRole } from "@storeai/shared";
import { env } from "@/env.server";

type Handler<T = unknown> = (args: {
  req: NextRequest;
  ctx: TenantCtx;
  params: T;
}) => Promise<NextResponse>;

export interface TenantRouteOptions {
  requireRole?: TenantRole;
  allowApiKey?: boolean;
  csrfExempt?: boolean;
}

const MUTATING = new Set(["POST", "PUT", "PATCH", "DELETE"]);

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

      const params = (await routeCtx.params) as T;
      const res = await handler({ req, ctx, params });
      status = res.status;
      return res;
    } catch (err) {
      const res = handleError(err);
      status = res.status;
      return res;
    } finally {
      const duration = Date.now() - started;
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

export function userRoute<T = unknown>(
  handler: (args: {
    req: NextRequest;
    user: UserSessionCtx;
    params: T;
  }) => Promise<NextResponse>,
  opts: { csrfExempt?: boolean } = {},
) {
  return async (req: NextRequest, routeCtx: { params: Promise<T> }): Promise<NextResponse> => {
    try {
      const s = await getUserSessionFromRequest(req);
      if (!s)
        return NextResponse.json(
          { ok: false, error: { code: "unauthorized", message: "Unauthorized" } },
          { status: 401 },
        );
      if (!opts.csrfExempt && MUTATING.has(req.method.toUpperCase())) {
        const header = req.headers.get("x-sa-csrf");
        if (!header || header !== s.session.csrfToken) {
          throw new ForbiddenError("Missing or invalid CSRF token");
        }
      }
      const params = (await routeCtx.params) as T;
      return await handler({ req, user: s, params });
    } catch (err) {
      return handleError(err);
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
