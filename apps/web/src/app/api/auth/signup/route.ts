import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { getDb, users, tenants, memberships } from "@storeai/db";
import { hashPassword, createSession } from "@storeai/auth";
import { signupSchema } from "@storeai/shared";
import { ConflictError } from "@storeai/shared/errors";
import { handleError, ok } from "@/lib/http";
import { sessionCookieOptions } from "@/lib/routeHelpers";
import { env } from "@/env.server";
import { rateLimit } from "@/lib/rateLimit";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  try {
    const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || null;
    await rateLimit({ key: `signup:${ip ?? "unknown"}`, limit: 10, windowSeconds: 60 });

    const body = await req.json();
    const input = signupSchema.parse(body);
    const db = getDb();

    const existing = await db.select().from(users).where(eq(users.email, input.email)).limit(1);
    if (existing[0]) throw new ConflictError("Email already registered");
    const slugExisting = await db
      .select()
      .from(tenants)
      .where(eq(tenants.slug, input.tenantSlug))
      .limit(1);
    if (slugExisting[0]) throw new ConflictError("Tenant slug already taken");

    const passwordHash = await hashPassword(input.password);
    const [user] = await db
      .insert(users)
      .values({ email: input.email, passwordHash, name: input.name })
      .returning();
    if (!user) throw new Error("user creation failed");

    const [tenant] = await db
      .insert(tenants)
      .values({ slug: input.tenantSlug, name: input.tenantName })
      .returning();
    if (!tenant) throw new Error("tenant creation failed");

    await db
      .insert(memberships)
      .values({ userId: user.id, tenantId: tenant.id, role: "owner" });

    const { token, csrfToken } = await createSession({
      userId: user.id,
      activeTenantId: tenant.id,
      userAgent: req.headers.get("user-agent"),
      ip,
    });

    const res = ok({
      user: { id: user.id, email: user.email, name: user.name },
      tenant: { id: tenant.id, slug: tenant.slug, name: tenant.name },
      csrfToken,
    });
    res.cookies.set(env.SESSION_COOKIE_NAME, token, {
      ...sessionCookieOptions(),
      maxAge: 30 * 24 * 60 * 60,
    });
    res.cookies.set("sa_csrf", csrfToken, {
      ...sessionCookieOptions(),
      httpOnly: false, // client JS needs to read this to set the header
      maxAge: 30 * 24 * 60 * 60,
    });
    return res;
  } catch (err) {
    return handleError(err);
  }
}
