"use client";
import { useEffect, useState } from "react";
import { apiJson } from "@/lib/api-client";

interface AuditLog {
  id: string;
  action: string;
  resourceType: string;
  resourceId: string | null;
  actorUserId: string | null;
  actorApiKeyId: string | null;
  metadata: Record<string, unknown>;
  createdAt: string;
}

export default function AuditLogsPage() {
  const [items, setItems] = useState<AuditLog[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      try {
        setItems(await apiJson<AuditLog[]>("/api/audit-logs"));
      } catch (e) {
        setError((e as Error).message);
      }
    })();
  }, []);

  return (
    <div>
      <div className="topbar">
        <h1>Audit logs</h1>
      </div>
      {error && <div className="error">{error}</div>}
      <div className="card">
        <table className="table">
          <thead>
            <tr>
              <th>Time</th>
              <th>Action</th>
              <th>Resource</th>
              <th>Actor</th>
              <th>Metadata</th>
            </tr>
          </thead>
          <tbody>
            {items.map((l) => (
              <tr key={l.id}>
                <td className="muted">{new Date(l.createdAt).toLocaleString()}</td>
                <td>
                  <code>{l.action}</code>
                </td>
                <td>
                  {l.resourceType}
                  {l.resourceId ? `:${l.resourceId.slice(0, 8)}` : ""}
                </td>
                <td className="muted">
                  {l.actorUserId ? `user` : l.actorApiKeyId ? `api_key` : "system"}
                </td>
                <td>
                  <pre style={{ maxWidth: 320, overflow: "auto" }}>
                    {JSON.stringify(l.metadata, null, 0)}
                  </pre>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
