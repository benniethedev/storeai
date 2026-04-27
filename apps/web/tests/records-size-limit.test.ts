import { describe, it, expect, beforeEach } from "vitest";
import { POST as projectsPOST } from "@/app/api/projects/route";
import { POST as recordsPOST } from "@/app/api/records/route";
import { PATCH as recordPATCH } from "@/app/api/records/[id]/route";
import { buildRequest, expectOk, sessionCookies, csrfHeader } from "./helpers/http";
import { resetDb, createUserAndTenant, uniqueSlug } from "./helpers/db";

beforeEach(async () => {
  await resetDb();
});

async function createProject(session: { token: string; csrfToken: string }, slug: string) {
  const res = await projectsPOST(
    buildRequest("/api/projects", {
      method: "POST",
      body: { name: "P", slug },
      cookies: sessionCookies(session),
      headers: csrfHeader(session),
    }),
    { params: Promise.resolve({}) },
  );
  return expectOk(res);
}

describe("record_too_large", () => {
  it("POST rejects oversize record data with 413 record_too_large", async () => {
    const { session } = await createUserAndTenant({});
    const project = await createProject(session, uniqueSlug("p"));
    const big = "x".repeat(1024 * 1024 + 100);
    const res = await recordsPOST(
      buildRequest("/api/records", {
        method: "POST",
        body: { projectId: project.id, key: "huge", data: { blob: big } },
        cookies: sessionCookies(session),
        headers: csrfHeader(session),
      }),
      { params: Promise.resolve({}) },
    );
    expect(res.status).toBe(413);
    const body = await res.json();
    expect(body.ok).toBe(false);
    expect(body.error.code).toBe("record_too_large");
    expect(body.error.message).toMatch(/maximum allowed size/);
  });

  it("PATCH rejects oversize record data with 413 record_too_large", async () => {
    const { session } = await createUserAndTenant({});
    const project = await createProject(session, uniqueSlug("p"));
    const createRes = await recordsPOST(
      buildRequest("/api/records", {
        method: "POST",
        body: { projectId: project.id, key: "k", data: { v: 1 } },
        cookies: sessionCookies(session),
        headers: csrfHeader(session),
      }),
      { params: Promise.resolve({}) },
    );
    const created = await expectOk(createRes);

    const big = "y".repeat(1024 * 1024 + 100);
    const patchRes = await recordPATCH(
      buildRequest(`/api/records/${created.id}`, {
        method: "PATCH",
        body: { data: { blob: big } },
        cookies: sessionCookies(session),
        headers: csrfHeader(session),
      }),
      { params: Promise.resolve({ id: created.id }) },
    );
    expect(patchRes.status).toBe(413);
    const body = await patchRes.json();
    expect(body.error.code).toBe("record_too_large");
  });
});
