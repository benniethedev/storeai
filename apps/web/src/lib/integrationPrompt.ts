interface IntegrationProject {
  id: string;
  name: string;
  slug: string;
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
  return [
    "You are integrating an application with StoreAI, a self-hosted multi-tenant backend (alternative to Supabase/Firebase).",
    "",
    "Connection details:",
    `- Base URL: ${baseUrl}`,
    `- Default project ID: ${project.id}   (slug: ${project.slug}, name: ${project.name})`,
    `- Auth: Bearer API key in the "Authorization" header`,
    `- Get an API key at ${baseUrl}/dashboard/api-keys (ask the user for one; it is shown only once at creation)`,
    "",
    "Data model (important — read before coding):",
    "- Storage is schemaless. You do NOT create tables or columns.",
    '- A "project" is a namespace that contains "records".',
    '- Each record: { id: uuid, projectId, key: string, data: any JSON, createdAt, updatedAt }.',
    '- Use the "key" field to namespace record types. Recommended convention: "<type>:<id>" (e.g. "user:42", "order:abc-123", "settings:default").',
    "- Tenant isolation is automatic. An API key is bound to one tenant; it can only see/write that tenant's data.",
    "",
    "Preferred client:",
    "- Use the `@storeai/sdk` package when it is available. It handles records, projects, file uploads, large JSON offloading, response envelopes, and Node-safe multipart uploads.",
    "- If you cannot use the SDK, follow the endpoint details below exactly. For server-side Node uploads, do not rely on naive global FormData; use a client that sends a stable multipart body with Content-Length.",
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
    "4. Keep records under a few MB of JSON. For anything larger, upload via /api/files and store the file id in a record.",
    '5. Use multiple projects to separate environments (e.g. "app-prod", "app-staging") or unrelated domains within the same tenant.',
    "6. Every response carries { ok, data|error }. Check ok before using data.",
    "",
    "Start by:",
    "- Installing/importing `@storeai/sdk` when possible, then creating a StoreAI client with baseUrl, apiKey, and projectId.",
    `- Confirming the API key works: GET ${baseUrl}/api/projects should return the list (including ${project.name}).`,
    "- Sketching the keys you will use for each entity before writing code.",
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
export const deleteRecord = store.records.delete;
export const uploadFile = store.files.upload;
export const createSmartRecord = store.createSmartRecord;

// Files are for images, screenshots, docs, Markdown, HTML exports, logs,
// transcripts, and other large payloads. Store file.id inside a record.
// createSmartRecord keeps JSON <= ${INLINE_LIMIT_BYTES} bytes inline and offloads larger JSON to /api/files.
`;
}
