interface IntegrationProject {
  id: string;
  name: string;
  slug: string;
  integrityMode?: "legacy" | "strict";
}

interface IntegrationContext {
  baseUrl: string;
  project: IntegrationProject;
}

const INLINE_LIMIT_BYTES = 900_000;

function largeContentStrategy(): string {
  return `Large content strategy:
- Keep \`record.data\` lean and operational.
- If a payload is long-form content, transcript text, report exports, or another large blob, upload it through \`POST /api/files\`.
- Store the returned \`fileId\` in a small record, e.g. \`{ "storage": "file", "fileId": "...", "kind": "spec" }\`.
- Keep the primary record under the 1 MB ceiling and use the file record as the canonical blob store.
- Good candidates for files: prompts, docs, transcripts, exports, logs, generated reports, attachments.`;
}

export function buildIntegrationPrompt({ baseUrl, project }: IntegrationContext): string {
  const integrityMode = project.integrityMode ?? "strict";
  const strict = integrityMode === "strict";
  return [
    "You are integrating an application with StoreAI, a self-hosted multi-tenant backend (alternative to Supabase/Firebase).",
    "",
    "Connection details:",
    `- Base URL: ${baseUrl}`,
    `- Default project ID: ${project.id}   (slug: ${project.slug}, name: ${project.name})`,
    `- Project integrity mode: ${integrityMode}`,
    `- Auth: Bearer API key in the "Authorization" header`,
    `- Get an API key at ${baseUrl}/dashboard/api-keys (ask the user for one; it is shown only once at creation)`,
    "",
    "Data model (important — read before coding):",
    "- Storage is schemaless. You do NOT create tables or columns.",
    '- A "project" is a namespace that contains "records".',
    '- Each record: { id: uuid, projectId, key: string, data: any JSON, immutable: boolean, version: integer, createdAt, updatedAt }.',
    '- Use the "key" field to namespace record types. Recommended convention: "<type>:<id>" (e.g. "user:42", "order:abc-123", "settings:default").',
    strict
      ? "- This is a STRICT project: keys are unique inside this project. The same key can safely exist in another project."
      : "- This is a LEGACY project: duplicate keys may exist for backward compatibility. Prefer ID-based access and do not assume key uniqueness.",
    "- Tenant isolation is automatic. An API key is bound to one tenant; it can only see/write that tenant's data.",
    "",
    "Preferred client:",
    "- Use the `@storeai/sdk` package when it is available. It handles records, projects, file uploads, large JSON offloading, response envelopes, and Node/browser-safe FormData uploads.",
    "- If you cannot use the SDK, follow the endpoint details below exactly. For file uploads, let fetch/FormData set the multipart boundary; do not hand-roll multipart bodies.",
    "",
    largeContentStrategy(),
    "",
    "All responses have this envelope:",
    '  Success: { "ok": true, "data": ... }',
    '  Error:   { "ok": false, "error": { "code": "...", "message": "..." } }',
    "",
    "Endpoints you will use:",
    "",
    "POST   /api/records                  Create a record",
    '  Body: { "projectId": "<uuid>", "key": "type:id", "data": { ... } }',
    "",
    "GET    /api/records?projectId=<uuid>&page=1&pageSize=20&sort=-created_at",
    '  Returns: { "items": [...], "page", "pageSize", "total" }',
    '  Sort values: "created_at", "-created_at", "updated_at", "-updated_at"',
    "",
    "GET    /api/records/:id              Fetch one record",
    "PATCH  /api/records/:id              Partial update",
    '  Body: { "key"?: "...", "data"?: { ... } }',
    "DELETE /api/records/:id              Delete",
    "",
    "GET    /api/records/by-key/:key?projectId=<uuid>  Fetch one project-scoped key",
    "PUT    /api/records/by-key/:key?projectId=<uuid>  Upsert one project-scoped key",
    "  Always include projectId for new integrations.",
    "",
    "POST   /api/atomic/records           Atomically mutate 1-100 records (strict projects only)",
    '  Header: Idempotency-Key: "<stable operation id>" (required)',
    '  Body: { "projectId": "<uuid>", "operations": [{ "op": "create|update|delete", ... }] }',
    "  Record changes, audit rows, and durable events all commit or all roll back.",
    "  Create with immutable: true for journal entries or other append-only facts.",
    strict
      ? "  Use this endpoint for every multi-record invariant, financial journal, reservation, or state transition."
      : "  This project is legacy, so atomic operations are disabled until it passes an explicit strict-mode upgrade audit.",
    "",
    "Project management (if you need more namespaces):",
    'POST   /api/projects                 Body: { "name": "...", "slug": "lowercase-kebab" }',
    "GET    /api/projects                 List projects in this tenant",
    'PATCH  /api/projects/:id             Body: { "name"?, "slug"?, "description"? }',
    "DELETE /api/projects/:id",
    "",
    "Files (if the app needs binary storage):",
    'POST   /api/files                    multipart/form-data with "file" field and "meta" JSON',
    "GET    /api/files                    List files; responses include an app-hosted downloadUrl",
    "GET    /api/files/:id                Same, single file",
    "DELETE /api/files/:id",
    "",
    "Image handling notes:",
    "- Use the returned `downloadUrl` for previews and downloads. It is canonical and app-hosted.",
    "- Do not assume object-store or localhost URLs will be stable or public.",
    "- For image files, render thumbnails directly from `downloadUrl` when `contentType` starts with `image/` (this includes `image/svg+xml`).",
    "- For non-image files, show a generic file tile or link, not an image tag.",
    "- If an app needs to persist branding or avatar previews, store the file record ID and use `downloadUrl` at render time instead of copying the binary URL into app data.",
    "",
    "Working style:",
    '1. When modeling a new domain, pick a short "type" prefix for the key (e.g. "user:", "post:", "comment:"). Reuse consistently.',
    "2. Store the record's domain id INSIDE data.id if you want a stable external id, or use the returned record.id.",
    '3. For lookups "by some field" in v1, fetch a page and filter client-side, OR maintain an index record (e.g. key "user-by-email:ada@x.com" -> { userId }). There is no server-side arbitrary query yet.',
    "4. Keep record data under 1 MB of JSON. For anything larger, upload via /api/files and store the file id in a record.",
    '5. Use multiple projects to separate environments (e.g. "app-prod", "app-staging") or unrelated domains within the same tenant.',
    "6. Every response carries { ok, data|error }. Check ok before using data.",
    strict
      ? "7. Use If-Match/expectedVersion for concurrent updates and atomic records for multi-record invariants."
      : "7. Use record IDs and If-Match/expectedVersion for updates. Never pick an arbitrary duplicate from a key lookup.",
    "8. Reuse an idempotency key only with the exact same request; different content returns idempotency_conflict.",
    "9. Keep API keys server-side. Never embed a StoreAI secret in browser bundles, public repositories, logs, or generated client code.",
    "10. Store financial amounts as integer atomic units or integer strings; never use floating-point math for money.",
    "11. Treat immutable records as append-only facts. Corrections must be new compensating records, not edits.",
    "",
    "Start by:",
    "- Installing/importing `@storeai/sdk` when possible, then creating a StoreAI client with baseUrl, apiKey, and projectId.",
    `- Confirming the API key works: GET ${baseUrl}/api/projects should return the list (including ${project.name}).`,
    "- Sketching the keys you will use for each entity before writing code.",
    strict
      ? "- Using store.records.atomic(...) with a stable idempotency key for related writes."
      : "- Treating this project as legacy-compatible; do not assume strict-only guarantees.",
    "",
    "Do not invent endpoints — only the ones above exist. Do not attempt to create tables or alter schemas; the store is JSON-per-record by design.",
  ].join("\n");
}

export function buildIntegrationJsSnippet({ baseUrl, project }: IntegrationContext): string {
  return `// storeai.ts — preferred StoreAI client for this project
import { StoreAI } from "@storeai/sdk";

export const store = new StoreAI({
  baseUrl: "${baseUrl}",
  projectId: "${project.id}",
  apiKey: process.env.STOREAI_KEY!, // set in your env
});

export const createRecord = store.records.create;
export const listRecords = store.records.list;
export const updateRecord = store.records.update;
export const atomicRecords = store.records.atomic;
export const deleteRecord = store.records.delete;
export const uploadFile = store.files.upload;
export const createSmartRecord = store.createSmartRecord;

// Files are for images, screenshots, docs, Markdown, HTML exports, logs,
// transcripts, and other large payloads. Store file.id as fileId inside a record.
// createSmartRecord keeps JSON <= ${INLINE_LIMIT_BYTES} bytes inline and offloads larger JSON to /api/files.
// This selected project uses ${project.integrityMode ?? "strict"} integrity mode.
`;
}
