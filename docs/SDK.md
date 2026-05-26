# StoreAI SDK

Use `@storeai/sdk` for new projects and agent-built integrations. It wraps the StoreAI HTTP API and handles the file upload edge cases that are easy to get wrong in server-side Node code.

```ts
import { StoreAI } from "@storeai/sdk";

const store = new StoreAI({
  baseUrl: process.env.STOREAI_BASE_URL!,
  apiKey: process.env.STOREAI_API_KEY!,
  projectId: process.env.STOREAI_PROJECT_ID!,
});
```

## Files

Files are for images, screenshots, design assets, PDFs, Markdown, HTML exports, transcripts, logs, and any large blob. Store the returned `file.id` inside a record.

```ts
import { readFile } from "node:fs/promises";

const file = await store.files.upload({
  filename: "screen.png",
  contentType: "image/png",
  body: await readFile("screen.png"),
  meta: { kind: "design-screenshot" },
});

await store.records.create("project-doc:spinrec", {
  title: "SpinRec redesign",
  screenshotFileId: file.id,
});
```

The SDK uses a stable multipart upload path in Node and browser-safe `FormData` in the browser.

## Records

```ts
await store.records.create("settings:default", { theme: "dark" });

const records = await store.records.list({
  keyPrefix: "project-doc:",
  pageSize: 50,
});

const doc = await store.records.getByKey("project-doc:spinrec");

await store.records.update(doc.id, {
  data: { ...doc.data, status: "ready" },
  expectedVersion: doc.version,
});
```

## Smart Records

`createSmartRecord()` stores small JSON inline. If the serialized JSON is large, it uploads the JSON to `/api/files` and creates a small pointer record.

```ts
await store.createSmartRecord("analysis:run-123", largeAnalysisObject);
```

Pointer records look like this:

```json
{
  "storage": "file",
  "fileId": "...",
  "kind": "json",
  "originalBytes": 1234567
}
```

## Agent Instruction

Tell future agents:

> Use `@storeai/sdk` for StoreAI. Use records for structured JSON state. Use files for images, screenshots, documents, Markdown, HTML exports, logs, transcripts, and large payloads. Store `file.id` in a record. Use `createSmartRecord()` for large JSON.
