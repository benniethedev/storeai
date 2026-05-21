import { NextResponse } from "next/server";
import { storeAiOpenApiSpec } from "@/lib/openapi";

export const runtime = "nodejs";

export async function GET() {
  return NextResponse.json(storeAiOpenApiSpec());
}
