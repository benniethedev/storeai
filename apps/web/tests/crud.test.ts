import { describe, it, expect, beforeEach } from "vitest";
import {
  GET as projectsGET,
  POST as projectsPOST,
} from "@/app/api/projects/route";
import {
  GET as projectGET,
  PATCH as projectPATCH,
  DELETE as projectDELETE,
} from "@/app/api/projects/[id]/route";
import { POST as recordsPOST, GET as recordsGET } from "@/app/api/records/route";
import { GET as auditGET } from "@/app/api/audit-logs/route";
import { GET as usageGET } from "@/app/api/usage-logs/route";
import { buildRequest, expectOk, sessionCookies, csrfHeader } from "./helpers/http";
import { resetDb, createUserAndTenant, uniqueSlug } from "./helpers/db";

beforeEach(async () => {
  await resetDb();
});

describe("projects CRUD + audit/usage logs", () => {
  it("creates, lists, gets, updates, and deletes a project with audit + usage logs", async () => {
    const { user, session } = await createUserAndTenant({});
    const cookies = sessionCookies(session);
    const headers = csrfHeader(session);

    // Create
    const slug = uniqueSlug("p");
    const createRes = await projectsPOST(
      buildRequest("/api/projects", {
        method: "POST",
        body: { name: "My Project", slug, description: "desc" },
        cookies,
        headers,
      }),
      { params: Promise.resolve({}) },
    );
    const created = await expectOk(createRes);
    expect(created.name).toBe("My Project");

    // List
    const listRes = await projectsGET(
      buildRequest("/api/projects", { cookies }),
      { params: Promise.resolve({}) },
    );
    const list = await expectOk(listRes);
    expect(list.items.length).toBe(1);

    // Get
    const getRes = await projectGET(
      buildRequest(`/api/projects/${created.id}`, { cookies }),
      { params: Promise.resolve({ id: created.id }) },
    );
    const got = await expectOk(getRes);
    expect(got.id).toBe(created.id);

    // Update
    const patchRes = await projectPATCH(
      buildRequest(`/api/projects/${created.id}`, {
        method: "PATCH",
        body: { name: "Renamed" },
        cookies,
        headers,
      }),
      { params: Promise.resolve({ id: created.id }) },
    );
    const patched = await expectOk(patchRes);
    expect(patched.name).toBe("Renamed");

    // Create a record
    const recRes = await recordsPOST(
      buildRequest("/api/records", {
        method: "POST",
        body: { projectId: created.id, key: "first", data: { a: 1 } },
        cookies,
        headers,
      }),
      { params: Promise.resolve({}) },
    );
    await expectOk(recRes);

    // List records for that project
    const rListRes = await recordsGET(
      buildRequest("/api/records", {
        cookies,
        search: { projectId: created.id },
      }),
      { params: Promise.resolve({}) },
    );
    const rList = await expectOk(rListRes);
    expect(rList.items.length).toBe(1);
    expect(rList.items[0].key).toBe("first");

    // Delete project (cascade records)
    const delRes = await projectDELETE(
      buildRequest(`/api/projects/${created.id}`, {
        method: "DELETE",
        cookies,
        headers,
      }),
      { params: Promise.resolve({ id: created.id }) },
    );
    await expectOk(delRes);

    // Audit logs: create, update, create record, delete project
    const auditRes = await auditGET(
      buildRequest("/api/audit-logs", { cookies }),
      { params: Promise.resolve({}) },
    );
    const audit = await expectOk(auditRes);
    const actions = audit.map((a: { action: string }) => a.action);
    expect(actions).toContain("project.create");
    expect(actions).toContain("project.update");
    expect(actions).toContain("record.create");
    expect(actions).toContain("project.delete");

    // Usage logs should have at least one entry for each request
    const usageRes = await usageGET(
      buildRequest("/api/usage-logs", { cookies }),
      { params: Promise.resolve({}) },
    );
    const usage = await expectOk(usageRes);
    expect(usage.length).toBeGreaterThan(3);
  });

  it("rejects invalid project input (Zod)", async () => {
    const { session } = await createUserAndTenant({});
    const cookies = sessionCookies(session);
    const headers = csrfHeader(session);
    const res = await projectsPOST(
      buildRequest("/api/projects", {
        method: "POST",
        body: { name: "", slug: "NOT VALID" },
        cookies,
        headers,
      }),
      { params: Promise.resolve({}) },
    );
    expect(res.status).toBe(400);
  });

  it("requires CSRF header for mutating cookie calls", async () => {
    const { session } = await createUserAndTenant({});
    const cookies = sessionCookies(session);
    const res = await projectsPOST(
      buildRequest("/api/projects", {
        method: "POST",
        body: { name: "X", slug: uniqueSlug("x") },
        cookies,
      }),
      { params: Promise.resolve({}) },
    );
    expect(res.status).toBe(403);
  });
});
