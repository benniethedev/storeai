# @storeai/sdk

Tiny TypeScript client for StoreAI records, files, projects, and large-payload smart records.

```ts
import { StoreAI } from "@storeai/sdk";

const store = new StoreAI({
  baseUrl: process.env.STOREAI_BASE_URL!,
  apiKey: process.env.STOREAI_API_KEY!,
  projectId: process.env.STOREAI_PROJECT_ID!,
});

const screenshot = await store.files.upload({
  filename: "screen.png",
  contentType: "image/png",
  body: await fs.promises.readFile("screen.png"),
  meta: { kind: "design-screenshot" },
});

await store.records.create("project-doc:spinrec", {
  title: "SpinRec redesign",
  screenshotFileId: screenshot.id,
});
```

Use records for structured JSON state. Use files for images, screenshots, documents, Markdown, HTML exports, logs, transcripts, and any payload that should not live inline inside a JSON record. Store the returned `file.id` inside a record.

`createSmartRecord()` stores small JSON inline and automatically uploads large JSON as a file, then creates a pointer record.

For related changes that must commit together, use `store.records.atomic(operations, { idempotencyKey })`. Atomic operations commit records, audit rows, and durable events in one PostgreSQL transaction. Create append-only facts with `immutable: true`.
