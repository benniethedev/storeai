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
    `- Confirming the API key works: GET ${baseUrl}/api/projects should return the list (including ${project.name}).`,
    "- Writing a small typed client wrapping the endpoints above.",
    "- Sketching the keys you will use for each entity before writing code.",
    "",
    "Do not invent endpoints — only the ones above exist. Do not attempt to create tables or alter schemas; the store is JSON-per-record by design.",
  ].join("\n");
}

export function buildIntegrationJsSnippet({ baseUrl, project }: IntegrationContext): string {
  return `// storeai.ts — tiny client for this project
const BASE_URL = "${baseUrl}";
const PROJECT_ID = "${project.id}";
const API_KEY = process.env.STOREAI_KEY!; // set in your env
const INLINE_LIMIT_BYTES = ${INLINE_LIMIT_BYTES};

async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(\`\${BASE_URL}\${path}\`, {
    ...init,
    headers: {
      Authorization: \`Bearer \${API_KEY}\`,
      "Content-Type": "application/json",
      ...(init.headers ?? {}),
    },
  });
  const body = await res.json();
  if (!body.ok) throw new Error(body.error?.message ?? \`\${res.status}\`);
  return body.data as T;
}

export async function createRecord(key: string, data: unknown) {
  return api<{ id: string }>("/api/records", {
    method: "POST",
    body: JSON.stringify({ projectId: PROJECT_ID, key, data }),
  });
}

export async function listRecords(opts: { page?: number; pageSize?: number } = {}) {
  const qs = new URLSearchParams({
    projectId: PROJECT_ID,
    page: String(opts.page ?? 1),
    pageSize: String(opts.pageSize ?? 20),
    sort: "-created_at",
  });
  return api<{ items: unknown[]; total: number }>(\`/api/records?\${qs}\`);
}

export async function updateRecord(id: string, patch: { key?: string; data?: unknown }) {
  return api(\`/api/records/\${id}\`, { method: "PATCH", body: JSON.stringify(patch) });
}

export async function deleteRecord(id: string) {
  return api(\`/api/records/\${id}\`, { method: "DELETE" });
}

function multipartSafeName(value: string) {
  return value.replace(/[\\r\\n"]/g, "_").replace(/\\\\/g, "\\\\\\\\");
}

async function multipartUploadBody(input: {
  value: Blob | Buffer | string;
  filename: string;
  contentType: string;
  fields?: Record<string, string>;
}) {
  const boundary = \`------------------------\${Math.random().toString(16).slice(2)}\${Date.now().toString(16)}\`;
  const chunks: Buffer[] = [];
  for (const [name, value] of Object.entries(input.fields ?? {})) {
    chunks.push(Buffer.from(
      \`--\${boundary}\\r\\nContent-Disposition: form-data; name="\${multipartSafeName(name)}"\\r\\n\\r\\n\${value}\\r\\n\`,
      "utf8",
    ));
  }
  chunks.push(Buffer.from(
    \`--\${boundary}\\r\\nContent-Disposition: form-data; name="file"; filename="\${multipartSafeName(input.filename)}"\\r\\nContent-Type: \${input.contentType}\\r\\n\\r\\n\`,
    "utf8",
  ));
  if (input.value instanceof Blob) chunks.push(Buffer.from(await input.value.arrayBuffer()));
  else chunks.push(Buffer.isBuffer(input.value) ? input.value : Buffer.from(input.value, "utf8"));
  chunks.push(Buffer.from(\`\\r\\n--\${boundary}--\\r\\n\`, "utf8"));
  const body = Buffer.concat(chunks);
  return {
    body,
    headers: {
      "Content-Type": \`multipart/form-data; boundary=\${boundary}\`,
      "Content-Length": String(body.byteLength),
      Connection: "close",
    },
  };
}

async function uploadJsonFile(name: string, value: string) {
  const upload = await multipartUploadBody({
    value,
    filename: name,
    contentType: "application/json",
    fields: { projectId: PROJECT_ID },
  });
  const res = await fetch(\`\${BASE_URL}/api/files\`, {
    method: "POST",
    headers: { Authorization: \`Bearer \${API_KEY}\`, ...upload.headers },
    body: upload.body,
  });
  const body = await res.json();
  if (!body.ok) throw new Error(body.error?.message ?? \`\${res.status}\`);
  return body.data as { id: string; downloadUrl: string };
}

export async function createSmartRecord(key: string, data: unknown) {
  const serialized = JSON.stringify(data ?? {});
  const bytes = new Blob([serialized]).size;
  if (bytes <= INLINE_LIMIT_BYTES) {
    return createRecord(key, data);
  }
  const file = await uploadJsonFile(\`\${key}.json\`, serialized);
  return createRecord(key, {
    storage: "file",
    fileId: file.id,
    kind: "json",
    originalBytes: bytes,
  });
}
`;
}
