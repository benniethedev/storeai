import { describe, it, expect, beforeEach } from "vitest";
import {
  POST as membersPOST,
  GET as membersGET,
} from "@/app/api/members/route";
import {
  PATCH as memberPATCH,
  DELETE as memberDELETE,
} from "@/app/api/members/[id]/route";
import { buildRequest, expectOk, sessionCookies, csrfHeader } from "./helpers/http";
import { resetDb, createUserAndTenant, uniqueEmail, uniqueSlug } from "./helpers/db";
import { hashPassword } from "@storeai/auth";
import { getDb, users, memberships } from "@storeai/db";

beforeEach(async () => {
  await resetDb();
});

async function addUser(email: string) {
  const db = getDb();
  const passwordHash = await hashPassword("password1234");
  const [u] = await db.insert(users).values({ email, passwordHash, name: email }).returning();
  return u!;
}

describe("members RBAC — owner protection", () => {
  it("an admin cannot add a new member with owner role (Critical fix)", async () => {
    const owner = await createUserAndTenant({ role: "owner", tenantSlug: uniqueSlug("t") });
    // Seed an admin in the same tenant
    const adminEmail = uniqueEmail("a");
    const admin = await addUser(adminEmail);
    const db = getDb();
    await db
      .insert(memberships)
      .values({ userId: admin.id, tenantId: owner.tenant.id, role: "admin" });
    const { createSession } = await import("@storeai/auth");
    const adminSession = await createSession({
      userId: admin.id,
      activeTenantId: owner.tenant.id,
      userAgent: "test",
      ip: "127.0.0.1",
    });

    // Create a target user first (members API requires the user to exist)
    const target = await addUser(uniqueEmail("t"));

    const res = await membersPOST(
      buildRequest("/api/members", {
        method: "POST",
        body: { email: target.email, role: "owner" },
        cookies: sessionCookies(adminSession),
        headers: csrfHeader(adminSession),
      }),
      { params: Promise.resolve({}) },
    );
    expect(res.status).toBe(403);
  });

  it("an admin cannot demote or remove an owner", async () => {
    const owner = await createUserAndTenant({ role: "owner", tenantSlug: uniqueSlug("t") });
    // Add a second owner so demotion wouldn't trip the last-owner guard
    const owner2 = await addUser(uniqueEmail("o"));
    const db = getDb();
    const [owner2Mem] = await db
      .insert(memberships)
      .values({ userId: owner2.id, tenantId: owner.tenant.id, role: "owner" })
      .returning();

    // Add an admin
    const adminUser = await addUser(uniqueEmail("a"));
    await db
      .insert(memberships)
      .values({ userId: adminUser.id, tenantId: owner.tenant.id, role: "admin" });
    const { createSession } = await import("@storeai/auth");
    const adminSession = await createSession({
      userId: adminUser.id,
      activeTenantId: owner.tenant.id,
      userAgent: "test",
      ip: "127.0.0.1",
    });

    // Admin tries to demote owner2 → forbidden
    const patchRes = await memberPATCH(
      buildRequest(`/api/members/${owner2Mem!.id}`, {
        method: "PATCH",
        body: { role: "member" },
        cookies: sessionCookies(adminSession),
        headers: csrfHeader(adminSession),
      }),
      { params: Promise.resolve({ id: owner2Mem!.id }) },
    );
    expect(patchRes.status).toBe(403);

    // Admin tries to delete owner2 → forbidden
    const delRes = await memberDELETE(
      buildRequest(`/api/members/${owner2Mem!.id}`, {
        method: "DELETE",
        cookies: sessionCookies(adminSession),
        headers: csrfHeader(adminSession),
      }),
      { params: Promise.resolve({ id: owner2Mem!.id }) },
    );
    expect(delRes.status).toBe(403);
  });

  it("an owner cannot remove or demote the last owner", async () => {
    const owner = await createUserAndTenant({ role: "owner", tenantSlug: uniqueSlug("t") });
    const db = getDb();
    const [ownerMem] = await db
      .select()
      .from(memberships)
      .where(
        // there's only one membership
        // but we still filter to this user+tenant just in case
        (require("drizzle-orm") as typeof import("drizzle-orm")).and(
          (require("drizzle-orm") as typeof import("drizzle-orm")).eq(
            memberships.userId,
            owner.user.id,
          ),
          (require("drizzle-orm") as typeof import("drizzle-orm")).eq(
            memberships.tenantId,
            owner.tenant.id,
          ),
        ),
      );

    const demoteRes = await memberPATCH(
      buildRequest(`/api/members/${ownerMem!.id}`, {
        method: "PATCH",
        body: { role: "admin" },
        cookies: sessionCookies(owner.session),
        headers: csrfHeader(owner.session),
      }),
      { params: Promise.resolve({ id: ownerMem!.id }) },
    );
    expect(demoteRes.status).toBe(409);

    const delRes = await memberDELETE(
      buildRequest(`/api/members/${ownerMem!.id}`, {
        method: "DELETE",
        cookies: sessionCookies(owner.session),
        headers: csrfHeader(owner.session),
      }),
      { params: Promise.resolve({ id: ownerMem!.id }) },
    );
    expect(delRes.status).toBe(409);
  });
});
