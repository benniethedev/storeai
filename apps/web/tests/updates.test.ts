import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, mkdir, writeFile, rm, utimes } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { GET as updatesGET } from "@/app/api/updates/route";
import { getUpdatesSnapshot } from "@/lib/updates";
import { buildRequest, expectOk, sessionCookies } from "./helpers/http";
import { resetDb, createUserAndTenant, uniqueSlug } from "./helpers/db";

let tmpRoot: string | null = null;
const originalOpsRoot = process.env.STOREAI_OPS_ROOT;

beforeEach(async () => {
  await resetDb();
  tmpRoot = await mkdtemp(path.join(os.tmpdir(), "storeai-updates-"));
  process.env.STOREAI_OPS_ROOT = tmpRoot;
});

afterEach(async () => {
  if (tmpRoot) await rm(tmpRoot, { recursive: true, force: true });
  tmpRoot = null;
  if (originalOpsRoot === undefined) {
    delete process.env.STOREAI_OPS_ROOT;
  } else {
    process.env.STOREAI_OPS_ROOT = originalOpsRoot;
  }
});

async function writeOpsFixture(root: string) {
  await mkdir(path.join(root, "state"), { recursive: true });
  await mkdir(path.join(root, "logs"), { recursive: true });
  await writeFile(
    path.join(root, "state", "last-deploy.json"),
    JSON.stringify({
      status: "failed",
      timestamp: "2026-05-21T12:00:00.000Z",
      from: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      to: "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
      log: "deploy-bbbbbbbb.log",
      reason: "typecheck failed",
      migrations_ran: true,
    }),
  );
  await writeFile(path.join(root, "state", "FAILURE"), "TypeScript failed\n");
  const oldLog = path.join(root, "logs", "deploy-aaaaaaaa.log");
  const newLog = path.join(root, "logs", "deploy-bbbbbbbb.log");
  await writeFile(oldLog, "old\n");
  await writeFile(
    newLog,
    Array.from({ length: 350 }, (_, i) => `line ${i + 1}`).join("\n"),
  );
  await utimes(oldLog, new Date("2026-05-20T12:00:00.000Z"), new Date("2026-05-20T12:00:00.000Z"));
  await utimes(newLog, new Date("2026-05-21T12:00:00.000Z"), new Date("2026-05-21T12:00:00.000Z"));
}

describe("updates dashboard data", () => {
  it("returns empty data when ops files are missing", async () => {
    const snapshot = await getUpdatesSnapshot(tmpRoot!);

    expect(snapshot.lastDeploy).toBeNull();
    expect(snapshot.failure).toBeNull();
    expect(snapshot.recentRuns).toEqual([]);
    expect(snapshot.selectedLogTail).toBeNull();
  });

  it("parses fixed ops files and caps the selected log tail", async () => {
    await writeOpsFixture(tmpRoot!);

    const snapshot = await getUpdatesSnapshot(tmpRoot!);

    expect(snapshot.lastDeploy?.status).toBe("failed");
    expect(snapshot.lastDeploy?.migrations_ran).toBe(true);
    expect(snapshot.failure).toBe("TypeScript failed");
    expect(snapshot.recentRuns.length).toBe(2);
    expect(snapshot.recentRuns[0]!.filename).toBe("deploy-bbbbbbbb.log");
    expect(snapshot.recentRuns[0]!.shortSha).toBe("bbbbbbbb");
    expect(snapshot.selectedLogTail).toContain("line 350");
    expect(snapshot.selectedLogTail).not.toContain("line 1\n");
  });

  it("requires admin role on the API route", async () => {
    await writeOpsFixture(tmpRoot!);
    const admin = await createUserAndTenant({ role: "admin", tenantSlug: uniqueSlug("updates-a") });
    const member = await createUserAndTenant({ role: "member", tenantSlug: uniqueSlug("updates-m") });

    const adminRes = await updatesGET(
      buildRequest("/api/updates", { cookies: sessionCookies(admin.session) }),
      { params: Promise.resolve({}) },
    );
    const data = await expectOk(adminRes);
    expect(data.lastDeploy.status).toBe("failed");

    const memberRes = await updatesGET(
      buildRequest("/api/updates", { cookies: sessionCookies(member.session) }),
      { params: Promise.resolve({}) },
    );
    expect(memberRes.status).toBe(403);
  });
});
