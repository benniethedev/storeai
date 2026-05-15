"use client";
import { useEffect, useMemo, useState } from "react";
import { buildIntegrationJsSnippet, buildIntegrationPrompt } from "@/lib/integrationPrompt";

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

  const js = buildIntegrationJsSnippet({ baseUrl, project });
  const agentPrompt = buildIntegrationPrompt({ baseUrl, project });

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
              <div>
                <label>Large content strategy</label>
                <p className="muted" style={{ margin: "4px 0" }}>
                  Keep records lean and operational. If your app needs to store long prompts,
                  transcripts, exports, or other large blobs, upload them through{" "}
                  <code>/api/files</code> and keep only a small <code>fileId</code> pointer in
                  the record.
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
