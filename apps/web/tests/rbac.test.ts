import { describe, it, expect, beforeEach } from "vitest";
import { POST as apiKeysPOST, GET as apiKeysGET } from "@/app/api/api-keys/route";
import { GET as membersGET } from "@/app/api/members/route";
import { GET as auditGET } from "@/app/api/audit-logs/route";
import { buildRequest, sessionCookies, csrfHeader } from "./helpers/http";
import { resetDb, createUserAndTenant, uniqueSlug } from "./helpers/db";

beforeEach(async () => {
  await resetDb();
});

describe("RBAC", () => {
  it("members cannot list or create API keys", async () => {
    const { session } = await createUserAndTenant({ role: "member", tenantSlug: uniqueSlug("m") });

    const getRes = await apiKeysGET(
      buildRequest("/api/api-keys", { cookies: sessionCookies(session) }),
      { params: Promise.resolve({}) },
    );
    expect(getRes.status).toBe(403);

    const postRes = await apiKeysPOST(
      buildRequest("/api/api-keys", {
        method: "POST",
        body: { name: "x" },
        cookies: sessionCookies(session),
        headers: csrfHeader(session),
      }),
      { params: Promise.resolve({}) },
    );
    expect(postRes.status).toBe(403);
  });

  it("admins can list API keys, members cannot see audit logs or member list", async () => {
    const admin = await createUserAndTenant({ role: "admin", tenantSlug: uniqueSlug("a") });
    const member = await createUserAndTenant({ role: "member", tenantSlug: uniqueSlug("m") });

    const adminList = await apiKeysGET(
      buildRequest("/api/api-keys", { cookies: sessionCookies(admin.session) }),
      { params: Promise.resolve({}) },
    );
    expect(adminList.status).toBe(200);

    const auditRes = await auditGET(
      buildRequest("/api/audit-logs", { cookies: sessionCookies(member.session) }),
      { params: Promise.resolve({}) },
    );
    expect(auditRes.status).toBe(403);

    const memRes = await membersGET(
      buildRequest("/api/members", { cookies: sessionCookies(member.session) }),
      { params: Promise.resolve({}) },
    );
    expect(memRes.status).toBe(403);
  });
});
