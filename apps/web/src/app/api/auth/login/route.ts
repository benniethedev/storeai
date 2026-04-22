import { NextRequest } from "next/server";
import { createHash } from "node:crypto";
import { eq } from "drizzle-orm";
import { getDb, users, memberships } from "@storeai/db";
import { hashPassword, verifyPassword, createSession, revokeSessionByToken } from "@storeai/auth";
import { loginSchema } from "@storeai/shared";
import { UnauthorizedError } from "@storeai/shared/errors";
import { handleError, ok } from "@/lib/http";
import { sessionCookieOptions } from "@/lib/routeHelpers";
import { env } from "@/env.server";
import { rateLimit } from "@/lib/rateLimit";
import { writeSystemAuditLog } from "@/lib/context";

export const runtime = "nodejs";

// A real argon2id hash, generated once, used as a constant-time decoy so
// unknown-email requests still pay the same CPU cost as known-email requests.
let decoyHashPromise: Promise<string> | null = null;
function getDecoyHash(): Promise<string> {
  if (!decoyHashPromise) decoyHashPromise = hashPassword("decoy-does-not-match-anything");
  return decoyHashPromise;
}

function emailKey(email: string): string {
  return createHash("sha256").update(email.toLowerCase()).digest("hex").slice(0, 16);
}

export async function POST(req: NextRequest) {
  let emailForAudit = "";
  try {
    const body = await req.json();
    const input = loginSchema.parse(body);
    emailForAudit = input.email;
    const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || null;

    // Per-IP bucket (spoofable behind untrusted XFF, but still useful).
    await rateLimit({ key: `login:ip:${ip ?? "unknown"}`, limit: 30, windowSeconds: 60 });
    // Per-account bucket — NOT spoofable; caps brute-force on a single user.
    await rateLimit({ key: `login:email:${emailKey(input.email)}`, limit: 10, windowSeconds: 60 });

    const db = getDb();
    const rows = await db.select().from(users).where(eq(users.email, input.email)).limit(1);
    const user = rows[0];

    // Always run password verification to keep wall-clock time flat.
    const hashToCheck = user?.passwordHash ?? (await getDecoyHash());
    const passwordOk = await verifyPassword(hashToCheck, input.password);

    if (!user || !passwordOk) {
      // Store email hash only — enough to correlate repeated hits, no PII.
      await writeSystemAuditLog({
        action: "auth.login.failed",
        resourceType: "user",
        userId: user?.id ?? null,
        metadata: {
          email_hash: emailKey(input.email),
          reason: user ? "bad_password" : "unknown_email",
        },
      }).catch(() => {});
      throw new UnauthorizedError("Invalid email or password");
    }

    const firstMem = await db
      .select()
      .from(memberships)
      .where(eq(memberships.userId, user.id))
      .limit(1);
    const activeTenantId = firstMem[0]?.tenantId ?? null;

    const existingCookie = req.cookies.get(env.SESSION_COOKIE_NAME)?.value;
    if (existingCookie) await revokeSessionByToken(existingCookie).catch(() => {});

    const { token, csrfToken } = await createSession({
      userId: user.id,
      activeTenantId,
      userAgent: req.headers.get("user-agent"),
      ip,
    });

    // Record successful login as a platform-level audit event. No secrets,
    // no IP, no user agent — those live in the sessions row already.
    await writeSystemAuditLog({
      action: "auth.login",
      resourceType: "user",
      userId: user.id,
      metadata: { email_hash: emailKey(input.email) },
    }).catch(() => {});

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
