"use client";
import { use, useEffect, useState } from "react";
import { apiFetch, apiJson } from "@/lib/api-client";
import { IntegrateModal } from "./_components/IntegrateModal";

interface RecordRow {
  id: string;
  key: string;
  data: Record<string, unknown>;
  createdAt: string;
}
interface Project {
  id: string;
  name: string;
  slug: string;
}

export default function ProjectDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const [project, setProject] = useState<Project | null>(null);
  const [records, setRecords] = useState<RecordRow[]>([]);
  const [key, setKey] = useState("");
  const [json, setJson] = useState(`{"hello":"world"}`);
  const [error, setError] = useState<string | null>(null);
  const [integrateOpen, setIntegrateOpen] = useState(false);

  async function refresh() {
    try {
      const p = await apiJson<Project>(`/api/projects/${id}`);
      setProject(p);
      const list = await apiJson<{ items: RecordRow[] }>(`/api/records?projectId=${id}`);
      setRecords(list.items);
    } catch (e) {
      setError((e as Error).message);
    }
  }
  useEffect(() => {
    void refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  async function onAdd(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      const parsed = JSON.parse(json);
      await apiJson("/api/records", {
        method: "POST",
        body: JSON.stringify({ projectId: id, key, data: parsed }),
      });
      setKey("");
      setJson(`{"hello":"world"}`);
      await refresh();
    } catch (e) {
      setError((e as Error).message);
    }
  }

  async function onDelete(rid: string) {
    if (!confirm("Delete record?")) return;
    await apiFetch(`/api/records/${rid}`, { method: "DELETE" });
    await refresh();
  }

  if (!project) return <div>Loading…</div>;
  return (
    <div>
      <div className="topbar">
        <h1>{project.name}</h1>
        <div className="row" style={{ gap: 12 }}>
          <button onClick={() => setIntegrateOpen(true)}>Integrate</button>
          <a href="/dashboard/projects">← All projects</a>
        </div>
      </div>
      <IntegrateModal
        open={integrateOpen}
        onClose={() => setIntegrateOpen(false)}
        project={project}
      />
      <div className="card" style={{ marginBottom: 16 }}>
        <h2>Add record</h2>
        <form onSubmit={onAdd}>
          <div className="field">
            <label>Key</label>
            <input required value={key} onChange={(e) => setKey(e.target.value)} />
          </div>
          <div className="field">
            <label>Data (JSON)</label>
            <textarea rows={4} value={json} onChange={(e) => setJson(e.target.value)} />
          </div>
          {error && <div className="error">{error}</div>}
          <button type="submit">Add record</button>
        </form>
      </div>
      <div className="card">
        <h2>Records</h2>
        {records.length === 0 ? (
          <div className="muted">No records yet.</div>
        ) : (
          <table className="table">
            <thead>
              <tr>
                <th>Key</th>
                <th>Data</th>
                <th>Created</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {records.map((r) => (
                <tr key={r.id}>
                  <td>
                    <code>{r.key}</code>
                  </td>
                  <td>
                    <pre style={{ maxWidth: 400, overflow: "auto" }}>
                      {JSON.stringify(r.data, null, 2)}
                    </pre>
                  </td>
                  <td className="muted">{new Date(r.createdAt).toLocaleString()}</td>
                  <td style={{ textAlign: "right" }}>
                    <button className="secondary" onClick={() => onDelete(r.id)}>
                      Delete
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
