"use client";
import { useEffect, useState } from "react";
import { apiFetch, apiJson } from "@/lib/api-client";

interface Project {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  createdAt: string;
}

export default function ProjectsPage() {
  const [items, setItems] = useState<Project[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ name: "", slug: "", description: "" });
  const [error, setError] = useState<string | null>(null);

  async function refresh() {
    setLoading(true);
    try {
      const data = await apiJson<{ items: Project[] }>("/api/projects");
      setItems(data.items);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => {
    void refresh();
  }, []);

  async function onCreate(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      await apiJson("/api/projects", { method: "POST", body: JSON.stringify(form) });
      setForm({ name: "", slug: "", description: "" });
      setShowForm(false);
      await refresh();
    } catch (e) {
      setError((e as Error).message);
    }
  }

  async function onDelete(id: string) {
    if (!confirm("Delete project? This removes records too.")) return;
    const res = await apiFetch(`/api/projects/${id}`, { method: "DELETE" });
    if (res.ok) await refresh();
  }

  return (
    <div>
      <div className="topbar">
        <h1>Projects</h1>
        <button onClick={() => setShowForm((s) => !s)}>
          {showForm ? "Cancel" : "New project"}
        </button>
      </div>
      {showForm && (
        <form onSubmit={onCreate} className="card" style={{ marginBottom: 16 }}>
          <div className="field">
            <label>Name</label>
            <input required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
          </div>
          <div className="field">
            <label>Slug</label>
            <input
              required
              value={form.slug}
              pattern="[a-z0-9](?:[a-z0-9-]*[a-z0-9])?"
              onChange={(e) => setForm({ ...form, slug: e.target.value })}
            />
          </div>
          <div className="field">
            <label>Description (optional)</label>
            <textarea
              rows={2}
              value={form.description}
              onChange={(e) => setForm({ ...form, description: e.target.value })}
            />
          </div>
          {error && <div className="error">{error}</div>}
          <button type="submit">Create</button>
        </form>
      )}
      <div className="card">
        {loading ? (
          <div className="muted">Loading...</div>
        ) : items.length === 0 ? (
          <div className="muted">No projects yet.</div>
        ) : (
          <table className="table">
            <thead>
              <tr>
                <th>Name</th>
                <th>Slug</th>
                <th>Created</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {items.map((p) => (
                <tr key={p.id}>
                  <td>
                    <a href={`/dashboard/projects/${p.id}`}>{p.name}</a>
                  </td>
                  <td>
                    <code>{p.slug}</code>
                  </td>
                  <td className="muted">{new Date(p.createdAt).toLocaleString()}</td>
                  <td style={{ textAlign: "right" }}>
                    <button className="secondary" onClick={() => onDelete(p.id)}>
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
