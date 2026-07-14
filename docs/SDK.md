# StoreAI SDK

Use `@storeai/sdk` for new projects and agent-built integrations. It wraps the StoreAI HTTP API and handles the file upload edge cases that are easy to get wrong in server-side Node code.

```ts
import { StoreAI } from "@storeai/sdk";

const store = new StoreAI({
  baseUrl: process.env.STOREAI_BASE_URL!,
  apiKey: process.env.STOREAI_API_KEY!,
  projectId: process.env.STOREAI_PROJECT_ID!,
  timeoutMs: 10_000,
  maxRetries: 2,
});
```

The SDK applies a bounded timeout to every request and automatically retries
transient read failures (`408`, `425`, `429`, and selected `5xx` responses).
It honors `Retry-After` up to five seconds. Mutations are never retried
automatically; use an `Idempotency-Key` with the HTTP API when your application
needs safe mutation retries. Invalid JSON, proxy error pages, timeouts, and
network failures are normalized into `StoreAIError` with a stable `code`,
`status`, `requestId`, and `retryable` flag.

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

The SDK uses native `FormData` in Node and browsers. Let `fetch` set the multipart boundary; do not hand-roll multipart request bodies.

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

The SDK automatically includes its configured `projectId` in key-based lookups. Keys are unique in new strict-integrity projects. Historical legacy projects may contain duplicate keys and should prefer ID-based access until explicitly upgraded.

For workflows that must commit several records together, use the atomic API:

```ts
await store.records.atomic(
  [
    { op: "create", key: "journal:debit", data: { amount: "100" }, immutable: true },
    { op: "create", key: "journal:credit", data: { amount: "100" }, immutable: true },
  ],
  { idempotencyKey: "transfer:txn_123" },
);
```

Atomic operations commit their records, audit entries, and durable events in one PostgreSQL transaction. Store monetary values as integer strings or integer JSON values; do not use floating point values for financial calculations.

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
