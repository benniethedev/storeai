import { NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { getDb, files } from "@storeai/db";
import { getObject, assertTenantOwnsKey } from "@storeai/storage";
import { NotFoundError } from "@storeai/shared/errors";
import { tenantRoute } from "@/lib/routeHelpers";

export const runtime = "nodejs";

async function bodyToBuffer(body: unknown): Promise<Buffer> {
  if (!body) return Buffer.alloc(0);
  if (typeof (body as { transformToByteArray?: () => Promise<Uint8Array> }).transformToByteArray === "function") {
    const bytes = await (body as { transformToByteArray: () => Promise<Uint8Array> }).transformToByteArray();
    return Buffer.from(bytes);
  }
  const chunks: Buffer[] = [];
  for await (const chunk of body as AsyncIterable<Uint8Array | Buffer | string>) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
}

export const GET = tenantRoute<{ id: string }>({}, async ({ ctx, params }) => {
  const db = getDb();
  const rows = await db
    .select()
    .from(files)
    .where(and(eq(files.tenantId, ctx.tenantId), eq(files.id, params.id)))
    .limit(1);
  const row = rows[0];
  if (!row) throw new NotFoundError();
  assertTenantOwnsKey(ctx.tenantId, row.objectKey);

  const response = await getObject(row.objectKey);
  const body = await bodyToBuffer(response.Body);
  const webBody = new Uint8Array(body);
  return new NextResponse(webBody, {
    status: 200,
    headers: {
      "Content-Type": row.contentType || "application/octet-stream",
      "Content-Disposition": `inline; filename="${encodeURIComponent(row.originalName || "file")}"`,
      "Cache-Control": "public, max-age=300",
    },
  });
});
