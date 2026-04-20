"use client";

function getCsrf(): string {
  if (typeof document === "undefined") return "";
  const m = document.cookie.match(/(?:^|;\s*)sa_csrf=([^;]+)/);
  return m ? decodeURIComponent(m[1]!) : "";
}

export async function apiFetch(path: string, init: RequestInit = {}): Promise<Response> {
  const method = (init.method ?? "GET").toUpperCase();
  const headers = new Headers(init.headers);
  if (!headers.has("Content-Type") && init.body && !(init.body instanceof FormData)) {
    headers.set("Content-Type", "application/json");
  }
  if (["POST", "PUT", "PATCH", "DELETE"].includes(method)) {
    const csrf = getCsrf();
    if (csrf) headers.set("x-sa-csrf", csrf);
  }
  return fetch(path, { ...init, headers, credentials: "same-origin" });
}

export async function apiJson<T>(path: string, init: RequestInit = {}): Promise<T> {
  const res = await apiFetch(path, init);
  const body = await res.json().catch(() => ({ ok: false }));
  if (!res.ok || !body?.ok) {
    const msg = body?.error?.message ?? `Request failed (${res.status})`;
    throw new Error(msg);
  }
  return body.data as T;
}
