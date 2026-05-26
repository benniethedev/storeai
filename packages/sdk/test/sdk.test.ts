import assert from "node:assert/strict";
import { StoreAI, StoreAIError } from "../src/index.js";

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

async function main() {
  const calls: Array<{ url: string; init: RequestInit & { headers: Record<string, string>; body?: BodyInit } }> = [];
  const store = new StoreAI({
    baseUrl: "https://storeai.example/",
    apiKey: "sk_test",
    projectId: "project-123",
    fetch: (async (url, init) => {
      calls.push({ url: String(url), init: init as RequestInit & { headers: Record<string, string>; body?: Uint8Array } });
      if (String(url).endsWith("/api/files")) {
        return json({
          ok: true,
          data: {
            id: "file-1",
            projectId: "project-123",
            originalName: "screen.png",
            contentType: "image/png",
            sizeBytes: 3,
            downloadUrl: "/api/files/file-1/download",
            createdAt: new Date().toISOString(),
          },
        });
      }
      if (String(url).endsWith("/api/records")) {
        return json({
          ok: true,
          data: {
            id: "rec-1",
            projectId: "project-123",
            key: "asset:1",
            data: {},
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
          },
        });
      }
      return json({ ok: false, error: { code: "not_found", message: "Nope", requestId: "req-1" } }, 404);
    }) as typeof fetch,
  });

  const file = await store.files.upload({
    filename: "screen.png",
    contentType: "image/png",
    body: new Uint8Array([1, 2, 3]),
    meta: { kind: "screenshot" },
  });
  assert.equal(file.id, "file-1");

  const upload = calls[0]!;
  assert.equal(upload.init.headers.Authorization, "Bearer sk_test");
  assert.ok(upload.init.body instanceof FormData);
  assert.equal(upload.init.headers["Content-Type"], undefined);
  assert.equal(upload.init.headers["Content-Length"], undefined);

  const form = upload.init.body;
  assert.equal(form.get("projectId"), "project-123");
  assert.equal(form.get("meta"), JSON.stringify({ kind: "screenshot" }));
  const uploadedFile = form.get("file");
  assert.ok(uploadedFile instanceof File);
  assert.equal(uploadedFile.name, "screen.png");
  assert.equal(uploadedFile.type, "image/png");
  assert.deepEqual(new Uint8Array(await uploadedFile.arrayBuffer()), new Uint8Array([1, 2, 3]));

  const record = await store.records.create("asset:1", { fileId: file.id });
  assert.equal(record.id, "rec-1");

  await assert.rejects(
    () => store.records.get("missing"),
    (error) => {
      assert.ok(error instanceof StoreAIError);
      assert.equal(error.code, "not_found");
      assert.equal(error.status, 404);
      assert.equal(error.requestId, "req-1");
      return true;
    },
  );
}

await main();
