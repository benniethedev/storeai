"use client";
import { useEffect, useRef, useState } from "react";
import { apiFetch, apiJson } from "@/lib/api-client";

interface FileRow {
  id: string;
  originalName: string;
  sizeBytes: number;
  contentType: string;
  createdAt: string;
  downloadUrl: string;
}

export default function FilesPage() {
  const [items, setItems] = useState<FileRow[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  async function refresh() {
    try {
      const data = await apiJson<FileRow[]>("/api/files");
      setItems(data);
    } catch (e) {
      setError((e as Error).message);
    }
  }
  useEffect(() => {
    void refresh();
  }, []);

  async function onUpload(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const file = fileRef.current?.files?.[0];
    if (!file) return;
    setUploading(true);
    try {
      const fd = new FormData();
      fd.append("file", file);
      fd.append("meta", JSON.stringify({}));
      const res = await apiFetch("/api/files", { method: "POST", body: fd });
      const body = await res.json();
      if (!res.ok || !body.ok) throw new Error(body.error?.message ?? "Upload failed");
      if (fileRef.current) fileRef.current.value = "";
      await refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setUploading(false);
    }
  }

  async function onDelete(id: string) {
    if (!confirm("Delete file?")) return;
    await apiFetch(`/api/files/${id}`, { method: "DELETE" });
    await refresh();
  }

  return (
    <div>
      <div className="topbar">
        <h1>Files</h1>
      </div>
      <form onSubmit={onUpload} className="card" style={{ marginBottom: 16 }}>
        <div className="field">
          <label>Upload file</label>
          <input type="file" ref={fileRef} required />
        </div>
        {error && <div className="error">{error}</div>}
        <button type="submit" disabled={uploading}>
          {uploading ? "Uploading…" : "Upload"}
        </button>
      </form>
      <div className="card">
        <table className="table">
          <thead>
            <tr>
              <th>Name</th>
              <th>Type</th>
              <th>Size</th>
              <th>Uploaded</th>
              <th></th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {items.length === 0 ? (
              <tr>
                <td colSpan={6} className="muted">
                  No files yet.
                </td>
              </tr>
            ) : (
              items.map((f) => (
                <tr key={f.id}>
                  <td>{f.originalName}</td>
                  <td>
                    <code>{f.contentType}</code>
                  </td>
                  <td className="muted">{(f.sizeBytes / 1024).toFixed(1)} KB</td>
                  <td className="muted">{new Date(f.createdAt).toLocaleString()}</td>
                  <td>
                    <a href={f.downloadUrl} target="_blank" rel="noopener">
                      Download
                    </a>
                  </td>
                  <td style={{ textAlign: "right" }}>
                    <button className="secondary" onClick={() => onDelete(f.id)}>
                      Delete
                    </button>
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
