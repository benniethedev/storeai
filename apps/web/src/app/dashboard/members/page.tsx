"use client";
import { useEffect, useState } from "react";
import { apiFetch, apiJson } from "@/lib/api-client";

interface Member {
  membershipId: string;
  userId: string;
  email: string;
  name: string;
  role: "owner" | "admin" | "member";
  createdAt: string;
}

export default function MembersPage() {
  const [items, setItems] = useState<Member[]>([]);
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<"owner" | "admin" | "member">("member");
  const [error, setError] = useState<string | null>(null);

  async function refresh() {
    try {
      setItems(await apiJson<Member[]>("/api/members"));
    } catch (e) {
      setError((e as Error).message);
    }
  }
  useEffect(() => {
    void refresh();
  }, []);

  async function onInvite(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      await apiJson("/api/members", {
        method: "POST",
        body: JSON.stringify({ email, role }),
      });
      setEmail("");
      await refresh();
    } catch (e) {
      setError((e as Error).message);
    }
  }

  async function onRemove(id: string) {
    if (!confirm("Remove member?")) return;
    await apiFetch(`/api/members/${id}`, { method: "DELETE" });
    await refresh();
  }

  async function onChangeRole(id: string, r: Member["role"]) {
    await apiFetch(`/api/members/${id}`, {
      method: "PATCH",
      body: JSON.stringify({ role: r }),
    });
    await refresh();
  }

  return (
    <div>
      <div className="topbar">
        <h1>Members</h1>
      </div>
      <form onSubmit={onInvite} className="card" style={{ marginBottom: 16 }}>
        <div className="row">
          <div className="field" style={{ flex: 1 }}>
            <label>Email of existing user</label>
            <input required type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
          </div>
          <div className="field" style={{ width: 160 }}>
            <label>Role</label>
            <select value={role} onChange={(e) => setRole(e.target.value as Member["role"])}>
              <option value="member">member</option>
              <option value="admin">admin</option>
              <option value="owner">owner</option>
            </select>
          </div>
          <div>
            <button type="submit">Add</button>
          </div>
        </div>
        {error && <div className="error">{error}</div>}
        <p className="muted" style={{ fontSize: 12 }}>
          v1 does not support email invites — user must already have an account.
        </p>
      </form>
      <div className="card">
        <table className="table">
          <thead>
            <tr>
              <th>Name</th>
              <th>Email</th>
              <th>Role</th>
              <th>Joined</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {items.map((m) => (
              <tr key={m.membershipId}>
                <td>{m.name}</td>
                <td>{m.email}</td>
                <td>
                  <select
                    value={m.role}
                    onChange={(e) => onChangeRole(m.membershipId, e.target.value as Member["role"])}
                  >
                    <option value="member">member</option>
                    <option value="admin">admin</option>
                    <option value="owner">owner</option>
                  </select>
                </td>
                <td className="muted">{new Date(m.createdAt).toLocaleString()}</td>
                <td style={{ textAlign: "right" }}>
                  <button className="secondary" onClick={() => onRemove(m.membershipId)}>
                    Remove
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
