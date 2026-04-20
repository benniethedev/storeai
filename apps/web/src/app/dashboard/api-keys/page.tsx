"use client";
import { useEffect, useState } from "react";
import { apiFetch, apiJson } from "@/lib/api-client";

interface ApiKey {
  id: string;
  name: string;
  prefix: string;
  createdAt: string;
  lastUsedAt: string | null;
  revokedAt: string | null;
}

export default function ApiKeysPage() {
  const [items, setItems] = useState<ApiKey[]>([]);
  const [name, setName] = useState("");
  const [plaintext, setPlaintext] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function refresh() {
    try {
      const data = await apiJson<ApiKey[]>("/api/api-keys");
      setItems(data);
    } catch (e) {
      setError((e as Error).message);
    }
  }
  useEffect(() => {
    void refresh();
  }, []);

  async function onCreate(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      const data = await apiJson<{ plaintext: string }>("/api/api-keys", {
        method: "POST",
        body: JSON.stringify({ name }),
      });
      setPlaintext(data.plaintext);
      setName("");
      await refresh();
    } catch (e) {
      setError((e as Error).message);
    }
  }

  async function onRevoke(id: string) {
    if (!confirm("Revoke this key?")) return;
    await apiFetch(`/api/api-keys/${id}`, { method: "DELETE" });
    await refresh();
  }

  return (
    <div>
      <div className="topbar">
        <h1>API keys</h1>
      </div>
      {plaintext && (
        <div className="card" style={{ marginBottom: 16, borderColor: "var(--accent)" }}>
          <h2>Your new API key (shown once)</h2>
          <pre>{plaintext}</pre>
          <p className="muted">Store this safely. You won't see it again.</p>
          <button className="secondary" onClick={() => setPlaintext(null)}>
            Dismiss
          </button>
        </div>
      )}
      <form onSubmit={onCreate} className="card" style={{ marginBottom: 16 }}>
        <div className="field">
          <label htmlFor="ak-name">Key name</label>
          <input id="ak-name" required value={name} onChange={(e) => setName(e.target.value)} placeholder="My backend" />
        </div>
        {error && <div className="error">{error}</div>}
        <button type="submit">Create API key</button>
      </form>
      <div className="card">
        <table className="table">
          <thead>
            <tr>
              <th>Name</th>
              <th>Prefix</th>
              <th>Created</th>
              <th>Last used</th>
              <th>Status</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {items.length === 0 ? (
              <tr>
                <td colSpan={6} className="muted">
                  No API keys yet.
                </td>
              </tr>
            ) : (
              items.map((k) => (
                <tr key={k.id}>
                  <td>{k.name}</td>
                  <td>
                    <code>{k.prefix}…</code>
                  </td>
                  <td className="muted">{new Date(k.createdAt).toLocaleString()}</td>
                  <td className="muted">
                    {k.lastUsedAt ? new Date(k.lastUsedAt).toLocaleString() : "never"}
                  </td>
                  <td>
                    {k.revokedAt ? (
                      <span className="pill" style={{ color: "var(--danger)" }}>
                        revoked
                      </span>
                    ) : (
                      <span className="pill" style={{ color: "var(--good)" }}>
                        active
                      </span>
                    )}
                  </td>
                  <td style={{ textAlign: "right" }}>
                    {!k.revokedAt && (
                      <button className="danger" onClick={() => onRevoke(k.id)}>
                        Revoke
                      </button>
                    )}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
