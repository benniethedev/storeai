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

interface ErrorLog {
  id: string;
  route: string;
  method: string;
  statusCode: number;
  code: string;
  message: string;
  requestId: string | null;
  actorUserId: string | null;
  actorApiKeyId: string | null;
  createdAt: string;
}

type Tab = "audit" | "errors";

function actorLabel(log: { actorUserId: string | null; actorApiKeyId: string | null }) {
  return log.actorUserId ? "user" : log.actorApiKeyId ? "api_key" : "system";
}

export default function LogsPage() {
  const [tab, setTab] = useState<Tab>("audit");
  const [auditLogs, setAuditLogs] = useState<AuditLog[]>([]);
  const [errorLogs, setErrorLogs] = useState<ErrorLog[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const [audit, errors] = await Promise.all([
          apiJson<AuditLog[]>("/api/audit-logs"),
          apiJson<ErrorLog[]>("/api/error-logs"),
        ]);
        setAuditLogs(audit);
        setErrorLogs(errors);
      } catch (e) {
        setError((e as Error).message);
      }
    })();
  }, []);

  return (
    <div>
      <div className="topbar">
        <div>
          <h1>Logs</h1>
          <p className="muted">Showing the last 30 days. Older rows are pruned automatically.</p>
        </div>
      </div>
      {error && <div className="error">{error}</div>}
      <div className="tabs">
        <button className={tab === "audit" ? "active" : ""} onClick={() => setTab("audit")}>
          Audit logs
        </button>
        <button className={tab === "errors" ? "active" : ""} onClick={() => setTab("errors")}>
          Error logs
        </button>
      </div>
      {tab === "audit" ? (
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
              {auditLogs.map((log) => (
                <tr key={log.id}>
                  <td className="muted">{new Date(log.createdAt).toLocaleString()}</td>
                  <td>
                    <code>{log.action}</code>
                  </td>
                  <td>
                    {log.resourceType}
                    {log.resourceId ? `:${log.resourceId.slice(0, 8)}` : ""}
                  </td>
                  <td className="muted">{actorLabel(log)}</td>
                  <td>
                    <pre style={{ maxWidth: 320, overflow: "auto" }}>
                      {JSON.stringify(log.metadata, null, 0)}
                    </pre>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="card">
          <table className="table">
            <thead>
              <tr>
                <th>Time</th>
                <th>Method</th>
                <th>Route</th>
                <th>Status</th>
                <th>Code</th>
                <th>Message</th>
                <th>Actor</th>
                <th>Request</th>
              </tr>
            </thead>
            <tbody>
              {errorLogs.map((log) => (
                <tr key={log.id}>
                  <td className="muted">{new Date(log.createdAt).toLocaleString()}</td>
                  <td>
                    <code>{log.method}</code>
                  </td>
                  <td>
                    <code>{log.route}</code>
                  </td>
                  <td>
                    <span className="pill" style={{ color: log.statusCode >= 500 ? "var(--danger)" : "orange" }}>
                      {log.statusCode}
                    </span>
                  </td>
                  <td>
                    <code>{log.code}</code>
                  </td>
                  <td>{log.message}</td>
                  <td className="muted">{actorLabel(log)}</td>
                  <td className="muted">{log.requestId ?? "-"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
