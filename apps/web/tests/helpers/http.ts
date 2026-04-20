import { NextRequest } from "next/server";
import type { Session } from "@storeai/db";

type Body = unknown;

function buildUrl(path: string): string {
  return `http://localhost:3000${path.startsWith("/") ? path : `/${path}`}`;
}

export interface InvokeOpts {
  method?: string;
  body?: Body;
  formData?: FormData;
  cookies?: Record<string, string>;
  headers?: Record<string, string>;
  search?: Record<string, string>;
}

export function buildRequest(path: string, opts: InvokeOpts = {}): NextRequest {
  const url = new URL(buildUrl(path));
  if (opts.search) {
    for (const [k, v] of Object.entries(opts.search)) url.searchParams.set(k, v);
  }
  const headers = new Headers(opts.headers ?? {});
  if (opts.cookies) {
    const cookieStr = Object.entries(opts.cookies)
      .map(([k, v]) => `${k}=${v}`)
      .join("; ");
    headers.set("cookie", cookieStr);
  }
  let body: BodyInit | null = null;
  if (opts.formData) {
    body = opts.formData;
  } else if (opts.body !== undefined) {
    if (!headers.has("content-type")) headers.set("content-type", "application/json");
    body = JSON.stringify(opts.body);
  }
  return new NextRequest(url, {
    method: opts.method ?? "GET",
    headers,
    body,
  });
}

export function sessionCookies(session: { token: string; csrfToken: string }) {
  return { sa_session: session.token, sa_csrf: session.csrfToken };
}

export function csrfHeader(session: { csrfToken: string }) {
  return { "x-sa-csrf": session.csrfToken };
}

export async function readJson(res: Response): Promise<any> {
  return res.json();
}

export async function expectOk(res: Response): Promise<any> {
  const body = await res.json();
  if (!body.ok) {
    throw new Error(`Expected ok, got ${res.status}: ${JSON.stringify(body.error)}`);
  }
  return body.data;
}
