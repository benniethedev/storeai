"use client";
import { useEffect, useState } from "react";
import { apiJson } from "@/lib/api-client";

interface LastDeploy {
  status?: string;
  timestamp?: string;
  from?: string;
  to?: string;
  log?: string;
  reason?: string;
  migrations_ran?: boolean;
  [key: string]: unknown;
}

interface DeployRun {
  filename: string;
  path: string;
  mtime: string;
  size: number;
  shortSha: string | null;
}

interface UpdatesSnapshot {
  lastDeploy: LastDeploy | null;
  failure: string | null;
  recentRuns: DeployRun[];
  selectedLogTail: string | null;
}

function shortSha(value?: string): string {
  if (!value) return "-";
  return value.length > 12 ? value.slice(0, 12) : value;
}

function formatBytes(value: number): string {
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`;
  return `${(value / (1024 * 1024)).toFixed(1)} MB`;
}

function statusColor(status?: string): string {
  const normalized = status?.toLowerCase() || "";
  if (["success", "ok", "deployed", "complete", "completed"].includes(normalized)) {
    return "var(--good)";
  }
  if (["failed", "failure", "error"].includes(normalized)) return "var(--danger)";
  return "orange";
}

export default function UpdatesPage() {
  const [snapshot, setSnapshot] = useState<UpdatesSnapshot | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      try {
        setSnapshot(await apiJson<UpdatesSnapshot>("/api/updates"));
      } catch (e) {
        setError((e as Error).message);
      }
    })();
  }, []);

  const last = snapshot?.lastDeploy ?? null;
  const noData =
    snapshot &&
    !snapshot.lastDeploy &&
    !snapshot.failure &&
    snapshot.recentRuns.length === 0 &&
    !snapshot.selectedLogTail;

  return (
    <div>
      <div className="topbar">
        <h1>Updates</h1>
      </div>
      {error && <div className="error">{error}</div>}
      {noData && <div className="card muted">No deploy data found.</div>}

      <div className="card">
        <h2>Last deploy</h2>
        {last ? (
          <div className="grid">
            <div>
              <span className="muted">Status</span>
              <p>
                <span className="pill" style={{ color: statusColor(last.status) }}>
                  {last.status ?? "unknown"}
                </span>
              </p>
            </div>
            <div>
              <span className="muted">Timestamp</span>
              <p>{last.timestamp ? new Date(last.timestamp).toLocaleString() : "-"}</p>
            </div>
            <div>
              <span className="muted">Range</span>
              <p>
                <code>{shortSha(last.from)}</code> {" -> "} <code>{shortSha(last.to)}</code>
              </p>
            </div>
            <div>
              <span className="muted">Migrations</span>
              <p>{last.migrations_ran ? "ran" : "not run"}</p>
            </div>
            <div>
              <span className="muted">Reason</span>
              <p>{last.reason || "-"}</p>
            </div>
            <div>
              <span className="muted">Log</span>
              <p>{last.log || "-"}</p>
            </div>
          </div>
        ) : (
          <p className="muted">No last deploy data found.</p>
        )}
      </div>

      {snapshot?.failure && (
        <div className="card" style={{ borderColor: "var(--danger)" }}>
          <h2>Failure</h2>
          <pre style={{ whiteSpace: "pre-wrap", overflowX: "auto" }}>{snapshot.failure}</pre>
        </div>
      )}

      <div className="card">
        <h2>Recent deploy runs</h2>
        {snapshot && snapshot.recentRuns.length > 0 ? (
          <table className="table">
            <thead>
              <tr>
                <th>Time</th>
                <th>File</th>
                <th>Short SHA</th>
                <th>Size</th>
                <th>Path</th>
              </tr>
            </thead>
            <tbody>
              {snapshot.recentRuns.map((run) => (
                <tr key={run.path}>
                  <td className="muted">{new Date(run.mtime).toLocaleString()}</td>
                  <td>
                    <code>{run.filename}</code>
                  </td>
                  <td>
                    <code>{run.shortSha ?? "-"}</code>
                  </td>
                  <td className="muted">{formatBytes(run.size)}</td>
                  <td className="muted">
                    <code>{run.path}</code>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <p className="muted">No deploy runs found.</p>
        )}
      </div>

      <div className="card">
        <h2>Latest log tail</h2>
        {snapshot?.selectedLogTail ? (
          <pre style={{ whiteSpace: "pre-wrap", overflowX: "auto", maxHeight: 520 }}>
            {snapshot.selectedLogTail}
          </pre>
        ) : (
          <p className="muted">No deploy log found.</p>
        )}
      </div>
    </div>
  );
}
