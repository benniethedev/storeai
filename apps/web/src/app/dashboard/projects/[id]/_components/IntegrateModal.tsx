"use client";
import { useEffect, useMemo, useState } from "react";

interface Props {
  open: boolean;
  onClose: () => void;
  project: { id: string; name: string; slug: string };
}

type Tab = "overview" | "curl" | "js" | "prompt";

export function IntegrateModal({ open, onClose, project }: Props) {
  const [tab, setTab] = useState<Tab>("overview");
  const baseUrl = useMemo(
    () => (typeof window === "undefined" ? "" : window.location.origin),
    [],
  );

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  const curl = `# Set your API key (create one at ${baseUrl}/dashboard/api-keys)
export STOREAI_KEY="sk_..."
export PROJECT_ID="${project.id}"
export BASE_URL="${baseUrl}"

# Create a record (schemaless JSON)
curl -sS -X POST "$BASE_URL/api/records" \\
  -H "Authorization: Bearer $STOREAI_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{
    "projectId": "'"$PROJECT_ID"'",
    "key": "users:123",
    "data": { "name": "Ada", "email": "ada@example.com" }
  }'

# List records in this project
curl -sS "$BASE_URL/api/records?projectId=$PROJECT_ID&page=1&pageSize=20&sort=-created_at" \\
  -H "Authorization: Bearer $STOREAI_KEY"

# Update a record (PATCH)
curl -sS -X PATCH "$BASE_URL/api/records/<record-id>" \\
  -H "Authorization: Bearer $STOREAI_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{ "data": { "name": "Ada Lovelace" } }'

# Delete a record
curl -sS -X DELETE "$BASE_URL/api/records/<record-id>" \\
  -H "Authorization: Bearer $STOREAI_KEY"
`;

  const js = `// storeai.ts — tiny client for this project
const BASE_URL = "${baseUrl}";
const PROJECT_ID = "${project.id}";
const API_KEY = process.env.STOREAI_KEY!; // set in your env

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
`;

  const agentPrompt = `You are integrating an application with StoreAI, a self-hosted multi-tenant backend (alternative to Supabase/Firebase).

Connection details:
- Base URL: ${baseUrl}
- Default project ID: ${project.id}   (slug: ${project.slug}, name: ${project.name})
- Auth: Bearer API key in the "Authorization" header
- Get an API key at ${baseUrl}/dashboard/api-keys (ask the user for one; it is shown only once at creation)

Data model (important — read before coding):
- Storage is schemaless. You do NOT create tables or columns.
- A "project" is a namespace that contains "records".
- Each record: { id: uuid, projectId, key: string, data: any JSON, createdAt, updatedAt }.
- Use the "key" field to namespace record types. Recommended convention: "<type>:<id>" (e.g. "user:42", "order:abc-123", "settings:default").
- Tenant isolation is automatic. An API key is bound to one tenant; it can only see/write that tenant's data.

All responses have this envelope:
  Success: { "ok": true, "data": ... }
  Error:   { "ok": false, "error": { "code": "...", "message": "..." } }

Endpoints you will use:

POST   /api/records                  Create a record
  Body: { "projectId": "<uuid>", "key": "type:id", "data": { ... } }

GET    /api/records?projectId=<uuid>&page=1&pageSize=20&sort=-created_at
  Returns: { "items": [...], "page", "pageSize", "total" }
  Sort values: "created_at", "-created_at", "updated_at", "-updated_at"

GET    /api/records/:id              Fetch one record
PATCH  /api/records/:id              Partial update
  Body: { "key"?: "...", "data"?: { ... } }
DELETE /api/records/:id              Delete

Project management (if you need more namespaces):
POST   /api/projects                 Body: { "name": "...", "slug": "lowercase-kebab" }
GET    /api/projects                 List projects in this tenant
PATCH  /api/projects/:id             Body: { "name"?, "slug"?, "description"? }
DELETE /api/projects/:id

Files (if the app needs binary storage):
POST   /api/files                    multipart/form-data with "file" field and "meta" JSON
GET    /api/files                    List files; responses include a short-lived signed downloadUrl
GET    /api/files/:id                Same, single file
DELETE /api/files/:id

Working style:
1. When modeling a new domain, pick a short "type" prefix for the key (e.g. "user:", "post:", "comment:"). Reuse consistently.
2. Store the record's domain id INSIDE data.id if you want a stable external id, or use the returned record.id.
3. For lookups "by some field" in v1, fetch a page and filter client-side, OR maintain an index record (e.g. key "user-by-email:ada@x.com" -> { userId }). There is no server-side arbitrary query yet.
4. Keep records under a few MB of JSON. For anything larger, upload via /api/files and store the file id in a record.
5. Use multiple projects to separate environments (e.g. "app-prod", "app-staging") or unrelated domains within the same tenant.
6. Every response carries { ok, data|error }. Check ok before using data.

Start by:
- Confirming the API key works: GET ${baseUrl}/api/projects should return the list (including ${project.name}).
- Writing a small typed client wrapping the endpoints above.
- Sketching the keys you will use for each entity before writing code.

Do not invent endpoints — only the ones above exist. Do not attempt to create tables or alter schemas; the store is JSON-per-record by design.`;

  function copy(text: string) {
    navigator.clipboard?.writeText(text);
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h2 style={{ margin: 0 }}>Integrate with {project.name}</h2>
          <button className="secondary" onClick={onClose}>
            Close
          </button>
        </div>

        <div className="modal-tabs">
          <button
            className={tab === "overview" ? "tab active" : "tab"}
            onClick={() => setTab("overview")}
          >
            Overview
          </button>
          <button
            className={tab === "curl" ? "tab active" : "tab"}
            onClick={() => setTab("curl")}
          >
            curl
          </button>
          <button className={tab === "js" ? "tab active" : "tab"} onClick={() => setTab("js")}>
            JavaScript
          </button>
          <button
            className={tab === "prompt" ? "tab active" : "tab"}
            onClick={() => setTab("prompt")}
          >
            AI-agent prompt
          </button>
        </div>

        <div className="modal-body">
          {tab === "overview" && (
            <div className="stack" style={{ gap: 12 }}>
              <div>
                <label>Base URL</label>
                <div className="code-row">
                  <code style={{ flex: 1 }}>{baseUrl}</code>
                  <button className="secondary" onClick={() => copy(baseUrl)}>
                    Copy
                  </button>
                </div>
              </div>
              <div>
                <label>Project ID</label>
                <div className="code-row">
                  <code style={{ flex: 1 }}>{project.id}</code>
                  <button className="secondary" onClick={() => copy(project.id)}>
                    Copy
                  </button>
                </div>
              </div>
              <div>
                <label>Auth</label>
                <p className="muted" style={{ margin: "4px 0" }}>
                  Bearer API key on every request.{" "}
                  <a href="/dashboard/api-keys">Create a key →</a>
                </p>
              </div>
              <div>
                <label>Storage model</label>
                <p className="muted" style={{ margin: "4px 0" }}>
                  Schemaless. This project holds <b>records</b>: each a JSON blob with a{" "}
                  <code>key</code> you choose and a <code>data</code> object. Use key prefixes
                  like <code>user:123</code> to group record types. No tables or columns to
                  define.
                </p>
              </div>
              <div>
                <label>Can an AI agent add tables / fields?</label>
                <p className="muted" style={{ margin: "4px 0" }}>
                  No DDL needed. Just <code>POST /api/records</code> with any JSON shape — the
                  agent can invent whatever schema it wants inside <code>data</code>.
                </p>
              </div>
            </div>
          )}

          {tab === "curl" && (
            <div>
              <div className="code-row" style={{ marginBottom: 8 }}>
                <span className="muted" style={{ flex: 1 }}>
                  Paste into a terminal. Fill in your API key.
                </span>
                <button className="secondary" onClick={() => copy(curl)}>
                  Copy all
                </button>
              </div>
              <pre>{curl}</pre>
            </div>
          )}

          {tab === "js" && (
            <div>
              <div className="code-row" style={{ marginBottom: 8 }}>
                <span className="muted" style={{ flex: 1 }}>
                  A minimal TypeScript client for this project.
                </span>
                <button className="secondary" onClick={() => copy(js)}>
                  Copy all
                </button>
              </div>
              <pre>{js}</pre>
            </div>
          )}

          {tab === "prompt" && (
            <div>
              <div className="code-row" style={{ marginBottom: 8 }}>
                <span className="muted" style={{ flex: 1 }}>
                  Paste this into Claude, Cursor, Copilot, etc. to bootstrap an integration.
                </span>
                <button onClick={() => copy(agentPrompt)}>Copy prompt</button>
              </div>
              <pre>{agentPrompt}</pre>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
