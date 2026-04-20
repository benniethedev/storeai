"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
        credentials: "same-origin",
      });
      const body = await res.json();
      if (!res.ok || !body.ok) throw new Error(body.error?.message ?? "Login failed");
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
        <h1>Sign in to StoreAI</h1>
        <p className="muted">Self-hosted backend platform</p>
        <form onSubmit={onSubmit} style={{ marginTop: 16 }}>
          <div className="field">
            <label htmlFor="email">Email</label>
            <input
              id="email"
              type="email"
              autoComplete="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </div>
          <div className="field">
            <label htmlFor="password">Password</label>
            <input
              id="password"
              type="password"
              autoComplete="current-password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </div>
          {error && <div className="error">{error}</div>}
          <div className="row" style={{ marginTop: 12, justifyContent: "space-between" }}>
            <button type="submit" disabled={busy}>
              {busy ? "Signing in..." : "Sign in"}
            </button>
            <a href="/signup">Create account</a>
          </div>
        </form>
      </div>
    </div>
  );
}
