import { describe, it, expect, beforeEach } from "vitest";
import { getDb, auditLogs, errorLogs, usageLogs } from "@storeai/db";
import { GET as auditGET } from "@/app/api/audit-logs/route";
import { GET as errorsGET } from "@/app/api/error-logs/route";
import { buildRequest, expectOk, sessionCookies } from "./helpers/http";
import { resetDb, createUserAndTenant, uniqueSlug } from "./helpers/db";

beforeEach(async () => {
  await resetDb();
});

describe("dashboard logs", () => {
  it("returns only recent audit and error logs and prunes old tenant logs", async () => {
    const { user, tenant, session } = await createUserAndTenant({ tenantSlug: uniqueSlug("logs") });
    const db = getDb();
    const old = new Date(Date.now() - 31 * 24 * 60 * 60 * 1000);

    await db.insert(auditLogs).values([
      {
        tenantId: tenant.id,
        actorUserId: user.id,
        action: "recent.audit",
        resourceType: "test",
        createdAt: new Date(),
      },
      {
        tenantId: tenant.id,
        actorUserId: user.id,
        action: "old.audit",
        resourceType: "test",
        createdAt: old,
      },
    ]);
    await db.insert(errorLogs).values([
      {
        tenantId: tenant.id,
        actorUserId: user.id,
        route: "/api/test",
        method: "GET",
        statusCode: 500,
        code: "recent_error",
        message: "recent",
        createdAt: new Date(),
      },
      {
        tenantId: tenant.id,
        actorUserId: user.id,
        route: "/api/test",
        method: "GET",
        statusCode: 500,
        code: "old_error",
        message: "old",
        createdAt: old,
      },
    ]);
    await db.insert(usageLogs).values({
      tenantId: tenant.id,
      actorUserId: user.id,
      route: "/api/old",
      method: "GET",
      statusCode: 200,
      durationMs: 1,
      createdAt: old,
    });

    const cookies = sessionCookies(session);
    const audit = await expectOk(
      await auditGET(buildRequest("/api/audit-logs", { cookies }), { params: Promise.resolve({}) }),
    );
    const errors = await expectOk(
      await errorsGET(buildRequest("/api/error-logs", { cookies }), { params: Promise.resolve({}) }),
    );

    expect(audit.map((entry: { action: string }) => entry.action)).toEqual(["recent.audit"]);
    expect(errors.map((entry: { code: string }) => entry.code)).toEqual(["recent_error"]);

    const auditAfter = await db.select().from(auditLogs);
    const errorsAfter = await db.select().from(errorLogs);
    const usageAfter = await db.select().from(usageLogs);
    expect(auditAfter.some((entry) => entry.action === "old.audit")).toBe(false);
    expect(errorsAfter.some((entry) => entry.code === "old_error")).toBe(false);
    expect(usageAfter.some((entry) => entry.route === "/api/old")).toBe(false);
  });
});
