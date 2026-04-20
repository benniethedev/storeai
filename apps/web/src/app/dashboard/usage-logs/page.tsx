"use client";
import { useEffect, useState } from "react";
import { apiJson } from "@/lib/api-client";

interface UsageLog {
  id: string;
  route: string;
  method: string;
  statusCode: number;
  durationMs: number;
  actorUserId: string | null;
  actorApiKeyId: string | null;
  createdAt: string;
}

export default function UsageLogsPage() {
  const [items, setItems] = useState<UsageLog[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      try {
        setItems(await apiJson<UsageLog[]>("/api/usage-logs"));
      } catch (e) {
        setError((e as Error).message);
      }
    })();
  }, []);

  return (
    <div>
      <div className="topbar">
        <h1>Usage logs</h1>
      </div>
      {error && <div className="error">{error}</div>}
      <div className="card">
        <table className="table">
          <thead>
            <tr>
              <th>Time</th>
              <th>Method</th>
              <th>Route</th>
              <th>Status</th>
              <th>Duration</th>
              <th>Actor</th>
            </tr>
          </thead>
          <tbody>
            {items.map((l) => (
              <tr key={l.id}>
                <td className="muted">{new Date(l.createdAt).toLocaleString()}</td>
                <td>
                  <code>{l.method}</code>
                </td>
                <td>
                  <code>{l.route}</code>
                </td>
                <td>
                  <span
                    className="pill"
                    style={{
                      color: l.statusCode >= 500 ? "var(--danger)" : l.statusCode >= 400 ? "orange" : "var(--good)",
                    }}
                  >
                    {l.statusCode}
                  </span>
                </td>
                <td className="muted">{l.durationMs}ms</td>
                <td className="muted">
                  {l.actorUserId ? "user" : l.actorApiKeyId ? "api_key" : "-"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
