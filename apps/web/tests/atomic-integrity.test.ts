import { beforeEach, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { POST as projectsPOST } from "@/app/api/projects/route";
import { POST as recordsPOST } from "@/app/api/records/route";
import { GET as recordByKeyGET } from "@/app/api/records/by-key/[key]/route";
import { POST as atomicPOST } from "@/app/api/atomic/records/route";
import {
  GET as integrityGET,
  POST as integrityPOST,
} from "@/app/api/projects/[id]/integrity/route";
import { getDb, auditLogs, events, projects, records } from "@storeai/db";
import { buildRequest, csrfHeader, expectOk, sessionCookies } from "./helpers/http";
import { createUserAndTenant, resetDb, uniqueSlug } from "./helpers/db";

beforeEach(async () => {
  await resetDb();
});

async function createProject(
  session: { token: string; csrfToken: string },
  slug = uniqueSlug("project"),
) {
  const response = await projectsPOST(
    buildRequest("/api/projects", {
      method: "POST",
      body: { name: slug, slug },
      cookies: sessionCookies(session),
      headers: csrfHeader(session),
    }),
    { params: Promise.resolve({}) },
  );
  return expectOk(response);
}

async function createRecord(
  session: { token: string; csrfToken: string },
  projectId: string,
  key: string,
) {
  return recordsPOST(
    buildRequest("/api/records", {
      method: "POST",
      body: { projectId, key, data: { value: 1 } },
      cookies: sessionCookies(session),
      headers: csrfHeader(session),
    }),
    { params: Promise.resolve({}) },
  );
}

describe("project-scoped record identity", () => {
  it("allows the same key in different projects and rejects duplicates in one project", async () => {
    const { session } = await createUserAndTenant({});
    const firstProject = await createProject(session);
    const secondProject = await createProject(session);

    expect((await createRecord(session, firstProject.id, "settings:default")).status).toBe(200);
    expect((await createRecord(session, secondProject.id, "settings:default")).status).toBe(200);
    expect((await createRecord(session, firstProject.id, "settings:default")).status).toBe(409);

    const firstLookup = await recordByKeyGET(
      buildRequest(`/api/records/by-key/settings%3Adefault`, {
        cookies: sessionCookies(session),
        search: { projectId: firstProject.id },
      }),
      { params: Promise.resolve({ key: "settings:default" }) },
    );
    const secondLookup = await recordByKeyGET(
      buildRequest(`/api/records/by-key/settings%3Adefault`, {
        cookies: sessionCookies(session),
        search: { projectId: secondProject.id },
      }),
      { params: Promise.resolve({ key: "settings:default" }) },
    );
    expect((await expectOk(firstLookup)).projectId).toBe(firstProject.id);
    expect((await expectOk(secondLookup)).projectId).toBe(secondProject.id);
  });

  it("preserves duplicate keys and unscoped by-key reads for legacy projects", async () => {
    const { session, tenant, user } = await createUserAndTenant({});
    const [legacyProject] = await getDb()
      .insert(projects)
      .values({
        tenantId: tenant.id,
        name: "Legacy",
        slug: uniqueSlug("legacy"),
        integrityMode: "legacy",
        createdByUserId: user.id,
      })
      .returning();

    expect((await createRecord(session, legacyProject!.id, "duplicate:key")).status).toBe(200);
    expect((await createRecord(session, legacyProject!.id, "duplicate:key")).status).toBe(200);

    const lookup = await recordByKeyGET(
      buildRequest("/api/records/by-key/duplicate%3Akey", {
        cookies: sessionCookies(session),
      }),
      { params: Promise.resolve({ key: "duplicate:key" }) },
    );
    expect(lookup.status).toBe(200);
    expect((await expectOk(lookup)).projectId).toBe(legacyProject!.id);

    const atomic = await atomicPOST(
      buildRequest("/api/atomic/records", {
        method: "POST",
        body: {
          projectId: legacyProject!.id,
          operations: [{ op: "create", key: "atomic:not-allowed", data: {} }],
        },
        cookies: sessionCookies(session),
        headers: { ...csrfHeader(session), "idempotency-key": "legacy-atomic" },
      }),
      { params: Promise.resolve({}) },
    );
    expect(atomic.status).toBe(409);
    expect((await atomic.json()).error.code).toBe("strict_integrity_required");
  });

  it("upgrades a compatible legacy project one-way and blocks upgrades with duplicates", async () => {
    const { session, tenant, user } = await createUserAndTenant({});
    const inserted = await getDb()
      .insert(projects)
      .values([
        {
          tenantId: tenant.id,
          name: "Upgradeable",
          slug: uniqueSlug("upgradeable"),
          integrityMode: "legacy",
          createdByUserId: user.id,
        },
        {
          tenantId: tenant.id,
          name: "Blocked",
          slug: uniqueSlug("blocked"),
          integrityMode: "legacy",
          createdByUserId: user.id,
        },
      ])
      .returning();
    const upgradeable = inserted[0]!;
    const blocked = inserted[1]!;
    await expectOk(await createRecord(session, blocked.id, "duplicate"));
    await expectOk(await createRecord(session, blocked.id, "duplicate"));

    const readiness = await integrityGET(
      buildRequest(`/api/projects/${upgradeable.id}/integrity`, {
        cookies: sessionCookies(session),
      }),
      { params: Promise.resolve({ id: upgradeable.id }) },
    );
    expect(await expectOk(readiness)).toMatchObject({ canUpgrade: true, integrityMode: "legacy" });

    const upgraded = await integrityPOST(
      buildRequest(`/api/projects/${upgradeable.id}/integrity`, {
        method: "POST",
        body: { integrityMode: "strict" },
        cookies: sessionCookies(session),
        headers: csrfHeader(session),
      }),
      { params: Promise.resolve({ id: upgradeable.id }) },
    );
    expect(await expectOk(upgraded)).toEqual({ integrityMode: "strict", upgraded: true });

    expect((await createRecord(session, upgradeable.id, "now-unique")).status).toBe(200);
    expect((await createRecord(session, upgradeable.id, "now-unique")).status).toBe(409);

    const blockedUpgrade = await integrityPOST(
      buildRequest(`/api/projects/${blocked.id}/integrity`, {
        method: "POST",
        body: { integrityMode: "strict" },
        cookies: sessionCookies(session),
        headers: csrfHeader(session),
      }),
      { params: Promise.resolve({ id: blocked.id }) },
    );
    expect(blockedUpgrade.status).toBe(409);
    expect((await blockedUpgrade.json()).error.code).toBe("integrity_upgrade_blocked");
  });
});

describe("concurrency-safe idempotency", () => {
  it("executes at most one concurrent mutation and rejects key reuse with a different body", async () => {
    const { session, tenant } = await createUserAndTenant({});
    const slug = uniqueSlug("idem");
    const request = (name: string) =>
      projectsPOST(
        buildRequest("/api/projects", {
          method: "POST",
          body: { name, slug },
          cookies: sessionCookies(session),
          headers: { ...csrfHeader(session), "idempotency-key": "create-project-once" },
        }),
        { params: Promise.resolve({}) },
      );

    const concurrent = await Promise.all([request("Original"), request("Original")]);
    expect(concurrent.some((response) => response.status === 200)).toBe(true);
    expect(concurrent.every((response) => response.status === 200 || response.status === 409)).toBe(true);

    const rows = await getDb()
      .select()
      .from(projects)
      .where(and(eq(projects.tenantId, tenant.id), eq(projects.slug, slug)));
    expect(rows).toHaveLength(1);

    const replay = await request("Original");
    expect(replay.status).toBe(200);
    expect(replay.headers.get("x-storeai-idempotent-replay")).toBe("true");

    const conflicting = await request("Different body");
    expect(conflicting.status).toBe(409);
    const conflictBody = await conflicting.json();
    expect(conflictBody.error.code).toBe("idempotency_conflict");
  });
});

describe("atomic record operations", () => {
  it("commits records, audits, and durable events together", async () => {
    const { session, tenant } = await createUserAndTenant({});
    const project = await createProject(session);
    const response = await atomicPOST(
      buildRequest("/api/atomic/records", {
        method: "POST",
        body: {
          projectId: project.id,
          operations: [
            { op: "create", key: "journal:debit", data: { amount: "100" } },
            { op: "create", key: "journal:credit", data: { amount: "100" } },
          ],
        },
        cookies: sessionCookies(session),
        headers: { ...csrfHeader(session), "idempotency-key": "journal-1" },
      }),
      { params: Promise.resolve({}) },
    );
    expect(response.status).toBe(200);

    const recordRows = await getDb()
      .select()
      .from(records)
      .where(and(eq(records.tenantId, tenant.id), eq(records.projectId, project.id)));
    const auditRows = await getDb()
      .select()
      .from(auditLogs)
      .where(and(eq(auditLogs.tenantId, tenant.id), eq(auditLogs.action, "record.create")));
    const eventRows = await getDb()
      .select()
      .from(events)
      .where(and(eq(events.tenantId, tenant.id), eq(events.projectId, project.id)));
    expect(recordRows).toHaveLength(2);
    expect(auditRows).toHaveLength(2);
    expect(eventRows).toHaveLength(2);
  });

  it("rolls back every record, audit, and event when one operation fails", async () => {
    const { session, tenant } = await createUserAndTenant({});
    const project = await createProject(session);
    await expectOk(await createRecord(session, project.id, "already-exists"));

    const response = await atomicPOST(
      buildRequest("/api/atomic/records", {
        method: "POST",
        body: {
          projectId: project.id,
          operations: [
            { op: "create", key: "must-rollback", data: { value: 1 } },
            { op: "create", key: "already-exists", data: { value: 2 } },
          ],
        },
        cookies: sessionCookies(session),
        headers: { ...csrfHeader(session), "idempotency-key": "rollback-1" },
      }),
      { params: Promise.resolve({}) },
    );
    expect(response.status).toBe(409);

    const rolledBack = await getDb()
      .select()
      .from(records)
      .where(and(
        eq(records.tenantId, tenant.id),
        eq(records.projectId, project.id),
        eq(records.key, "must-rollback"),
      ));
    expect(rolledBack).toHaveLength(0);
    const rollbackAudits = await getDb()
      .select()
      .from(auditLogs)
      .where(and(eq(auditLogs.tenantId, tenant.id), eq(auditLogs.resourceType, "record")));
    const rollbackEvents = await getDb()
      .select()
      .from(events)
      .where(and(eq(events.tenantId, tenant.id), eq(events.projectId, project.id)));
    expect(rollbackAudits).toHaveLength(1);
    expect(rollbackEvents).toHaveLength(1);
  });

  it("prevents immutable records from being changed or deleted", async () => {
    const { session } = await createUserAndTenant({});
    const project = await createProject(session);
    const create = await atomicPOST(
      buildRequest("/api/atomic/records", {
        method: "POST",
        body: {
          projectId: project.id,
          operations: [
            { op: "create", key: "journal:sealed", data: { amount: "100" }, immutable: true },
          ],
        },
        cookies: sessionCookies(session),
        headers: { ...csrfHeader(session), "idempotency-key": "immutable-create" },
      }),
      { params: Promise.resolve({}) },
    );
    expect(create.status).toBe(200);

    for (const operation of [
      { op: "update", key: "journal:sealed", data: { amount: "200" } },
      { op: "delete", key: "journal:sealed" },
    ]) {
      const response = await atomicPOST(
        buildRequest("/api/atomic/records", {
          method: "POST",
          body: { projectId: project.id, operations: [operation] },
          cookies: sessionCookies(session),
          headers: {
            ...csrfHeader(session),
            "idempotency-key": `immutable-${operation.op}`,
          },
        }),
        { params: Promise.resolve({}) },
      );
      expect(response.status).toBe(409);
      expect((await response.json()).error.code).toBe("immutable_record");
    }
  });
});
