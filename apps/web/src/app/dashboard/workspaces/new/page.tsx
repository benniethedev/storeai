"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { apiFetch } from "@/lib/api-client";

export default function NewWorkspacePage() {
  const router = useRouter();
  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const res = await apiFetch("/api/tenants", {
        method: "POST",
        body: JSON.stringify({ name, slug }),
      });
      const body = await res.json();
      if (!res.ok || !body.ok) throw new Error(body.error?.message ?? "Failed");
      const switchRes = await apiFetch("/api/tenants/switch", {
        method: "POST",
        body: JSON.stringify({ tenantId: body.data.id }),
      });
      if (!switchRes.ok) throw new Error("Failed to switch to new tenant");
      router.push("/dashboard");
      router.refresh();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div style={{ maxWidth: 480 }}>
      <h1>New workspace</h1>
      <form onSubmit={onSubmit} className="card" style={{ marginTop: 16 }}>
        <div className="field">
          <label>Name</label>
          <input required value={name} onChange={(e) => setName(e.target.value)} />
        </div>
        <div className="field">
          <label>Slug</label>
          <input
            required
            value={slug}
            pattern="[a-z0-9](?:[a-z0-9-]*[a-z0-9])?"
            onChange={(e) => setSlug(e.target.value)}
          />
        </div>
        {error && <div className="error">{error}</div>}
        <button type="submit" disabled={busy}>
          {busy ? "Creating..." : "Create workspace"}
        </button>
      </form>
    </div>
  );
}
