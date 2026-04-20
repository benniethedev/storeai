import { describe, it, expect, beforeEach } from "vitest";
import { POST as apiKeysPOST, GET as apiKeysGET } from "@/app/api/api-keys/route";
import { DELETE as apiKeyDELETE } from "@/app/api/api-keys/[id]/route";
import { POST as projectsPOST, GET as projectsGET } from "@/app/api/projects/route";
import { POST as recordsPOST } from "@/app/api/records/route";
import { buildRequest, expectOk, sessionCookies, csrfHeader } from "./helpers/http";
import {
  resetDb,
  createUserAndTenant,
  createTenantApiKey,
  uniqueSlug,
} from "./helpers/db";

beforeEach(async () => {
  await resetDb();
});

describe("API key authentication", () => {
  it("creates a key that is shown once, then usable via Bearer, then revocable", async () => {
    const { user, session, tenant } = await createUserAndTenant({});
    const created = await apiKeysPOST(
      buildRequest("/api/api-keys", {
        method: "POST",
        body: { name: "svc" },
        cookies: sessionCookies(session),
        headers: csrfHeader(session),
      }),
      { params: Promise.resolve({}) },
    );
    const data = await expectOk(created);
    expect(data.plaintext).toMatch(/^sk_/);

    // Subsequent list does NOT include plaintext
    const listRes = await apiKeysGET(
      buildRequest("/api/api-keys", { cookies: sessionCookies(session) }),
      { params: Promise.resolve({}) },
    );
    const list = await expectOk(listRes);
    expect(list[0].prefix).toBe(data.prefix);
    expect(list[0]).not.toHaveProperty("plaintext");

    // Use the key to create a project
    const projRes = await projectsPOST(
      buildRequest("/api/projects", {
        method: "POST",
        body: { name: "via-key", slug: uniqueSlug("vk") },
        headers: { authorization: `Bearer ${data.plaintext}` },
      }),
      { params: Promise.resolve({}) },
    );
    await expectOk(projRes);

    // Create a record with the key
    const listProjRes = await projectsGET(
      buildRequest("/api/projects", {
        headers: { authorization: `Bearer ${data.plaintext}` },
      }),
      { params: Promise.resolve({}) },
    );
    const proj = (await expectOk(listProjRes)).items[0];
    const recRes = await recordsPOST(
      buildRequest("/api/records", {
        method: "POST",
        body: { projectId: proj.id, key: "k", data: { hello: true } },
        headers: { authorization: `Bearer ${data.plaintext}` },
      }),
      { params: Promise.resolve({}) },
    );
    await expectOk(recRes);

    // Revoke
    const delRes = await apiKeyDELETE(
      buildRequest(`/api/api-keys/${data.id}`, {
        method: "DELETE",
        cookies: sessionCookies(session),
        headers: csrfHeader(session),
      }),
      { params: Promise.resolve({ id: data.id }) },
    );
    await expectOk(delRes);

    // Revoked key can no longer be used
    const deniedRes = await projectsGET(
      buildRequest("/api/projects", {
        headers: { authorization: `Bearer ${data.plaintext}` },
      }),
      { params: Promise.resolve({}) },
    );
    expect(deniedRes.status).toBe(401);
  });

  it("rejects API keys from a different tenant (isolation)", async () => {
    const a = await createUserAndTenant({ tenantSlug: uniqueSlug("a") });
    const b = await createUserAndTenant({ tenantSlug: uniqueSlug("b") });

    // A creates a project
    const pRes = await projectsPOST(
      buildRequest("/api/projects", {
        method: "POST",
        body: { name: "A", slug: uniqueSlug("pa") },
        cookies: sessionCookies(a.session),
        headers: csrfHeader(a.session),
      }),
      { params: Promise.resolve({}) },
    );
    const aProject = await expectOk(pRes);

    // B creates an API key
    const bKey = await createTenantApiKey({ tenantId: b.tenant.id, userId: b.user.id });

    // B's key must not see A's project, or write a record against it
    const listRes = await projectsGET(
      buildRequest("/api/projects", {
        headers: { authorization: `Bearer ${bKey.plaintext}` },
      }),
      { params: Promise.resolve({}) },
    );
    const list = await expectOk(listRes);
    expect(list.items.find((p: { id: string }) => p.id === aProject.id)).toBeUndefined();

    const recRes = await recordsPOST(
      buildRequest("/api/records", {
        method: "POST",
        body: { projectId: aProject.id, key: "k", data: {} },
        headers: { authorization: `Bearer ${bKey.plaintext}` },
      }),
      { params: Promise.resolve({}) },
    );
    expect(recRes.status).toBe(404); // project not found in B's tenant
  });

  it("bad bearer returns 401", async () => {
    const res = await projectsGET(
      buildRequest("/api/projects", { headers: { authorization: "Bearer sk_badbadbad_xxx" } }),
      { params: Promise.resolve({}) },
    );
    expect(res.status).toBe(401);
  });
});
