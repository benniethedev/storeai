import { NextRequest } from "next/server";
import { z } from "zod";
import { setActiveTenant } from "@storeai/auth";
import { ok, handleError } from "@/lib/http";
import { requireUserSessionFromRequest } from "@/lib/context";

export const runtime = "nodejs";

const schema = z.object({ tenantId: z.string().uuid() });

export async function POST(req: NextRequest) {
  try {
    const s = await requireUserSessionFromRequest(req);
    const header = req.headers.get("x-sa-csrf");
    if (!header || header !== s.session.csrfToken)
      return handleError(new Error("CSRF"));
    const body = await req.json();
    const { tenantId } = schema.parse(body);
    await setActiveTenant({ sessionId: s.session.id, userId: s.user.id, tenantId });
    return ok({ tenantId });
  } catch (err) {
    return handleError(err);
  }
}
