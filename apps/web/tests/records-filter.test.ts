import { describe, it, expect, beforeEach } from "vitest";
import { POST as projectsPOST } from "@/app/api/projects/route";
import { POST as recordsPOST, GET as recordsGET } from "@/app/api/records/route";
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

async function createRecord(
  session: { token: string; csrfToken: string },
  projectId: string,
  key: string,
  data: unknown = { v: 1 },
) {
  const res = await recordsPOST(
    buildRequest("/api/records", {
      method: "POST",
      body: { projectId, key, data },
      cookies: sessionCookies(session),
      headers: csrfHeader(session),
    }),
    { params: Promise.resolve({}) },
  );
  return expectOk(res);
}

describe("GET /api/records — key + keyPrefix filters", () => {
  it("returns the record matching ?key=", async () => {
    const { session } = await createUserAndTenant({});
    const project = await createProject(session, uniqueSlug("p"));
    await createRecord(session, project.id, "alpha");
    await createRecord(session, project.id, "beta");
    await createRecord(session, project.id, "alpha-2");

    const res = await recordsGET(
      buildRequest("/api/records", {
        cookies: sessionCookies(session),
        search: { projectId: project.id, key: "alpha" },
      }),
      { params: Promise.resolve({}) },
    );
    const body = await expectOk(res);
    expect(body.items.length).toBe(1);
    expect(body.items[0].key).toBe("alpha");
    expect(body.total).toBe(1);
  });

  it("returns prefix matches with ?keyPrefix=", async () => {
    const { session } = await createUserAndTenant({});
    const project = await createProject(session, uniqueSlug("p"));
    await createRecord(session, project.id, "user:1");
    await createRecord(session, project.id, "user:2");
    await createRecord(session, project.id, "session:1");

    const res = await recordsGET(
      buildRequest("/api/records", {
        cookies: sessionCookies(session),
        search: { projectId: project.id, keyPrefix: "user:" },
      }),
      { params: Promise.resolve({}) },
    );
    const body = await expectOk(res);
    const keys = body.items.map((r: { key: string }) => r.key).sort();
    expect(keys).toEqual(["user:1", "user:2"]);
  });

  it("escapes LIKE wildcards in keyPrefix", async () => {
    const { session } = await createUserAndTenant({});
    const project = await createProject(session, uniqueSlug("p"));
    // The literal string "ab%" should NOT match "abXc" — % is escaped.
    await createRecord(session, project.id, "abXc");
    await createRecord(session, project.id, "ab%c");

    const res = await recordsGET(
      buildRequest("/api/records", {
        cookies: sessionCookies(session),
        search: { projectId: project.id, keyPrefix: "ab%" },
      }),
      { params: Promise.resolve({}) },
    );
    const body = await expectOk(res);
    expect(body.items.length).toBe(1);
    expect(body.items[0].key).toBe("ab%c");
  });

  it("backward-compat: no key/keyPrefix returns all records (paginated)", async () => {
    const { session } = await createUserAndTenant({});
    const project = await createProject(session, uniqueSlug("p"));
    await createRecord(session, project.id, "a");
    await createRecord(session, project.id, "b");
    await createRecord(session, project.id, "c");

    const res = await recordsGET(
      buildRequest("/api/records", {
        cookies: sessionCookies(session),
        search: { projectId: project.id },
      }),
      { params: Promise.resolve({}) },
    );
    const body = await expectOk(res);
    expect(body.items.length).toBe(3);
  });
});
