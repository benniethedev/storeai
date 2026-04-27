import { describe, it, expect, beforeAll, beforeEach } from "vitest";
import { POST as filesPOST, GET as filesGET } from "@/app/api/files/route";
import { GET as fileGET, DELETE as fileDELETE } from "@/app/api/files/[id]/route";
import { POST as projectsPOST } from "@/app/api/projects/route";
import { buildRequest, expectOk, sessionCookies, csrfHeader } from "./helpers/http";
import { resetDb, createUserAndTenant, uniqueSlug } from "./helpers/db";
import { ensureBucket } from "@storeai/storage";

beforeAll(async () => {
  await ensureBucket();
});
beforeEach(async () => {
  await resetDb();
});

function buildFileForm(name = "hello.txt", contents = "hello world", contentType = "text/plain") {
  const fd = new FormData();
  const blob = new Blob([contents], { type: contentType });
  fd.append("file", blob, name);
  fd.append("meta", JSON.stringify({}));
  return fd;
}

describe("file uploads", () => {
  it("uploads, lists, gets a signed URL, and deletes a file — tenant isolated", async () => {
    const { session } = await createUserAndTenant({ tenantSlug: uniqueSlug("f") });
    const cookies = sessionCookies(session);
    const headers = csrfHeader(session);

    const uploadRes = await filesPOST(
      buildRequest("/api/files", {
        method: "POST",
        formData: buildFileForm(),
        cookies,
        headers,
      }),
      { params: Promise.resolve({}) },
    );
    const file = await expectOk(uploadRes);
    expect(file.id).toBeTruthy();
    expect(file.objectKey).toMatch(/^tenants\//);
    // POST /api/files should return a usable downloadUrl atomically with
    // the upload — clients shouldn't need to round-trip GET to fetch one.
    expect(file.downloadUrl).toMatch(/^http/);

    const listRes = await filesGET(
      buildRequest("/api/files", { cookies }),
      { params: Promise.resolve({}) },
    );
    const list = await expectOk(listRes);
    expect(list.length).toBe(1);
    expect(list[0].downloadUrl).toMatch(/^http/);

    const getRes = await fileGET(
      buildRequest(`/api/files/${file.id}`, { cookies }),
      { params: Promise.resolve({ id: file.id }) },
    );
    const got = await expectOk(getRes);
    expect(got.downloadUrl).toMatch(/^http/);

    const delRes = await fileDELETE(
      buildRequest(`/api/files/${file.id}`, {
        method: "DELETE",
        cookies,
        headers,
      }),
      { params: Promise.resolve({ id: file.id }) },
    );
    await expectOk(delRes);
  });

  it("accepts projectId as a top-level form field", async () => {
    const { session } = await createUserAndTenant({ tenantSlug: uniqueSlug("ftl") });
    const cookies = sessionCookies(session);
    const headers = csrfHeader(session);

    // Create a project to associate the upload with.
    const projRes = await projectsPOST(
      buildRequest("/api/projects", {
        method: "POST",
        body: { name: "Pp", slug: uniqueSlug("p") },
        cookies,
        headers,
      }),
      { params: Promise.resolve({}) },
    );
    const project = await expectOk(projRes);

    // Top-level projectId, no `meta` field at all.
    const fd = new FormData();
    fd.append("file", new Blob(["hi"], { type: "text/plain" }), "x.txt");
    fd.append("projectId", project.id);

    const upRes = await filesPOST(
      buildRequest("/api/files", {
        method: "POST",
        formData: fd,
        cookies,
        headers,
      }),
      { params: Promise.resolve({}) },
    );
    const file = await expectOk(upRes);
    expect(file.projectId).toBe(project.id);
    expect(file.downloadUrl).toMatch(/^http/);
    expect(file.objectKey).toContain(`/projects/${project.id}/`);
  });

  it("other tenants cannot access the file", async () => {
    const a = await createUserAndTenant({ tenantSlug: uniqueSlug("a") });
    const b = await createUserAndTenant({ tenantSlug: uniqueSlug("b") });

    const upRes = await filesPOST(
      buildRequest("/api/files", {
        method: "POST",
        formData: buildFileForm(),
        cookies: sessionCookies(a.session),
        headers: csrfHeader(a.session),
      }),
      { params: Promise.resolve({}) },
    );
    const file = await expectOk(upRes);

    const bGet = await fileGET(
      buildRequest(`/api/files/${file.id}`, { cookies: sessionCookies(b.session) }),
      { params: Promise.resolve({ id: file.id }) },
    );
    expect(bGet.status).toBe(404);

    const bDel = await fileDELETE(
      buildRequest(`/api/files/${file.id}`, {
        method: "DELETE",
        cookies: sessionCookies(b.session),
        headers: csrfHeader(b.session),
      }),
      { params: Promise.resolve({ id: file.id }) },
    );
    expect(bDel.status).toBe(404);
  });
});
