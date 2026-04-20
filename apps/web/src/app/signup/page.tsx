"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";

export default function SignupPage() {
  const router = useRouter();
  const [form, setForm] = useState({
    name: "",
    email: "",
    password: "",
    tenantName: "",
    tenantSlug: "",
  });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const res = await fetch("/api/auth/signup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
        credentials: "same-origin",
      });
      const body = await res.json();
      if (!res.ok || !body.ok) throw new Error(body.error?.message ?? "Signup failed");
      router.push("/dashboard");
      router.refresh();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="auth-page">
      <div className="auth-card card">
        <h1>Create your account</h1>
        <p className="muted">You'll get a personal workspace to start.</p>
        <form onSubmit={onSubmit} style={{ marginTop: 16 }}>
          <div className="field">
            <label htmlFor="su-name">Name</label>
            <input
              id="su-name"
              required
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
            />
          </div>
          <div className="field">
            <label htmlFor="su-email">Email</label>
            <input
              id="su-email"
              type="email"
              required
              value={form.email}
              onChange={(e) => setForm({ ...form, email: e.target.value })}
            />
          </div>
          <div className="field">
            <label htmlFor="su-password">Password</label>
            <input
              id="su-password"
              type="password"
              required
              minLength={8}
              value={form.password}
              onChange={(e) => setForm({ ...form, password: e.target.value })}
            />
          </div>
          <div className="field">
            <label htmlFor="su-tenant-name">Workspace name</label>
            <input
              id="su-tenant-name"
              required
              value={form.tenantName}
              onChange={(e) => setForm({ ...form, tenantName: e.target.value })}
            />
          </div>
          <div className="field">
            <label htmlFor="su-tenant-slug">Workspace slug</label>
            <input
              id="su-tenant-slug"
              required
              value={form.tenantSlug}
              onChange={(e) => setForm({ ...form, tenantSlug: e.target.value })}
              pattern="[a-z0-9](?:[a-z0-9-]*[a-z0-9])?"
            />
          </div>
          {error && <div className="error">{error}</div>}
          <div className="row" style={{ marginTop: 12, justifyContent: "space-between" }}>
            <button type="submit" disabled={busy}>
              {busy ? "Creating..." : "Create account"}
            </button>
            <a href="/login">Have an account?</a>
          </div>
        </form>
      </div>
    </div>
  );
}
