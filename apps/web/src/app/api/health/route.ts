import { ok } from "@/lib/http";

export const runtime = "nodejs";

export async function GET() {
  return ok({ status: "ok", time: new Date().toISOString() });
}
