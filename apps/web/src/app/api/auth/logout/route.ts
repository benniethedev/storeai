import { NextRequest } from "next/server";
import { revokeSessionByToken } from "@storeai/auth";
import { ok, handleError } from "@/lib/http";
import { env } from "@/env.server";
import { sessionCookieOptions } from "@/lib/routeHelpers";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  try {
    const token = req.cookies.get(env.SESSION_COOKIE_NAME)?.value;
    if (token) await revokeSessionByToken(token);
    const res = ok({ loggedOut: true });
    res.cookies.set(env.SESSION_COOKIE_NAME, "", {
      ...sessionCookieOptions(),
      maxAge: 0,
    });
    res.cookies.set("sa_csrf", "", {
      ...sessionCookieOptions(),
      httpOnly: false,
      maxAge: 0,
    });
    return res;
  } catch (err) {
    return handleError(err);
  }
}
