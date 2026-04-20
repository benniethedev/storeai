import { NextRequest } from "next/server";
import { eq } from "drizzle-orm";
import { getDb, users, memberships } from "@storeai/db";
import { verifyPassword, createSession, revokeSessionByToken } from "@storeai/auth";
import { loginSchema } from "@storeai/shared";
import { UnauthorizedError } from "@storeai/shared/errors";
import { handleError, ok } from "@/lib/http";
import { sessionCookieOptions } from "@/lib/routeHelpers";
import { env } from "@/env.server";
import { rateLimit } from "@/lib/rateLimit";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  try {
    const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || null;
    await rateLimit({ key: `login:${ip ?? "unknown"}`, limit: 20, windowSeconds: 60 });

    const body = await req.json();
    const input = loginSchema.parse(body);
    const db = getDb();

    const rows = await db.select().from(users).where(eq(users.email, input.email)).limit(1);
    const user = rows[0];
    if (!user) throw new UnauthorizedError("Invalid email or password");
    const okPwd = await verifyPassword(user.passwordHash, input.password);
    if (!okPwd) throw new UnauthorizedError("Invalid email or password");

    // Pick any membership as default active tenant
    const firstMem = await db
      .select()
      .from(memberships)
      .where(eq(memberships.userId, user.id))
      .limit(1);
    const activeTenantId = firstMem[0]?.tenantId ?? null;

    // revoke prior session sent in cookies if present
    const existingCookie = req.cookies.get(env.SESSION_COOKIE_NAME)?.value;
    if (existingCookie) await revokeSessionByToken(existingCookie).catch(() => {});

    const { token, csrfToken } = await createSession({
      userId: user.id,
      activeTenantId,
      userAgent: req.headers.get("user-agent"),
      ip,
    });

    const res = ok({
      user: { id: user.id, email: user.email, name: user.name },
      activeTenantId,
      csrfToken,
    });
    res.cookies.set(env.SESSION_COOKIE_NAME, token, {
      ...sessionCookieOptions(),
      maxAge: 30 * 24 * 60 * 60,
    });
    res.cookies.set("sa_csrf", csrfToken, {
      ...sessionCookieOptions(),
      httpOnly: false,
      maxAge: 30 * 24 * 60 * 60,
    });
    return res;
  } catch (err) {
    return handleError(err);
  }
}
