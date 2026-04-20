import { describe, it, expect, beforeEach } from "vitest";
import { POST as projectsPOST, GET as projectsGET } from "@/app/api/projects/route";
import {
  GET as projectGET,
  PATCH as projectPATCH,
  DELETE as projectDELETE,
} from "@/app/api/projects/[id]/route";
import { POST as recordsPOST } from "@/app/api/records/route";
import { buildRequest, expectOk, sessionCookies, csrfHeader } from "./helpers/http";
import { resetDb, createUserAndTenant, uniqueSlug } from "./helpers/db";

beforeEach(async () => {
  await resetDb();
});

describe("tenant isolation", () => {
  it("prevents reading, updating, or deleting another tenant's project", async () => {
    const a = await createUserAndTenant({ tenantSlug: uniqueSlug("a") });
    const b = await createUserAndTenant({ tenantSlug: uniqueSlug("b") });

    // A creates a project
    const createRes = await projectsPOST(
      buildRequest("/api/projects", {
        method: "POST",
        body: { name: "A project", slug: uniqueSlug("pa") },
        cookies: sessionCookies(a.session),
        headers: csrfHeader(a.session),
      }),
      { params: Promise.resolve({}) },
    );
    const project = await expectOk(createRes);

    // B cannot see A's project in list
    const bList = await projectsGET(
      buildRequest("/api/projects", { cookies: sessionCookies(b.session) }),
      { params: Promise.resolve({}) },
    );
    const bItems = (await expectOk(bList)).items;
    expect(bItems.length).toBe(0);

    // B cannot GET A's project (404)
    const getRes = await projectGET(
      buildRequest(`/api/projects/${project.id}`, { cookies: sessionCookies(b.session) }),
      { params: Promise.resolve({ id: project.id }) },
    );
    expect(getRes.status).toBe(404);

    // B cannot PATCH
    const patchRes = await projectPATCH(
      buildRequest(`/api/projects/${project.id}`, {
        method: "PATCH",
        body: { name: "owned" },
        cookies: sessionCookies(b.session),
        headers: csrfHeader(b.session),
      }),
      { params: Promise.resolve({ id: project.id }) },
    );
    expect(patchRes.status).toBe(404);

    // B cannot DELETE
    const delRes = await projectDELETE(
      buildRequest(`/api/projects/${project.id}`, {
        method: "DELETE",
        cookies: sessionCookies(b.session),
        headers: csrfHeader(b.session),
      }),
      { params: Promise.resolve({ id: project.id }) },
    );
    expect(delRes.status).toBe(404);
  });

  it("prevents creating a record against another tenant's project", async () => {
    const a = await createUserAndTenant({ tenantSlug: uniqueSlug("a") });
    const b = await createUserAndTenant({ tenantSlug: uniqueSlug("b") });

    const createRes = await projectsPOST(
      buildRequest("/api/projects", {
        method: "POST",
        body: { name: "A", slug: uniqueSlug("pa") },
        cookies: sessionCookies(a.session),
        headers: csrfHeader(a.session),
      }),
      { params: Promise.resolve({}) },
    );
    const project = await expectOk(createRes);

    const res = await recordsPOST(
      buildRequest("/api/records", {
        method: "POST",
        body: { projectId: project.id, key: "k", data: {} },
        cookies: sessionCookies(b.session),
        headers: csrfHeader(b.session),
      }),
      { params: Promise.resolve({}) },
    );
    expect(res.status).toBe(404);
  });
});
