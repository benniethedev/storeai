import { describe, it, expect, beforeAll, beforeEach, vi, afterAll } from "vitest";
import { GET as opsGET } from "@/app/api/ops/overview/route";
import { buildRequest } from "./helpers/http";
import { resetDb, createUserAndTenant, uniqueSlug, uniqueEmail } from "./helpers/db";
import { issueOpsToken, revokeOpsToken } from "@storeai/auth";

describe("/api/ops/overview — auth", () => {
  beforeEach(async () => {
    await resetDb();
  });

  it("401 on no token", async () => {
    const res = await opsGET(buildRequest("/api/ops/overview"));
    expect(res.status).toBe(401);
  });

  it("401 on malformed token (wrong prefix)", async () => {
    const res = await opsGET(
      buildRequest("/api/ops/overview", {
        headers: { authorization: "Bearer not_an_ops_token" },
      }),
    );
    expect(res.status).toBe(401);
  });

  it("401 on too-short token", async () => {
    const res = await opsGET(
      buildRequest("/api/ops/overview", {
        headers: { authorization: "Bearer sa_ops_short" },
      }),
    );
    expect(res.status).toBe(401);
  });

  it("401 on revoked token", async () => {
    const { plaintext, token } = await issueOpsToken({ name: "test-revoked" });
    await revokeOpsToken({ id: token.id });
    const res = await opsGET(
      buildRequest("/api/ops/overview", {
        headers: { authorization: `Bearer ${plaintext}` },
      }),
    );
    expect(res.status).toBe(401);
  });

  it("401 on a valid-looking but unknown token", async () => {
    const res = await opsGET(
      buildRequest("/api/ops/overview", {
        headers: {
          authorization:
            "Bearer sa_ops_" + "x".repeat(64),
        },
      }),
    );
    expect(res.status).toBe(401);
  });
});

describe("/api/ops/overview — payload", () => {
  let token: string;

  beforeAll(async () => {
    await resetDb();
    const res = await issueOpsToken({ name: "test-valid" });
    token = res.plaintext;
  });

  async function call() {
    return opsGET(
      buildRequest("/api/ops/overview", {
        headers: { authorization: `Bearer ${token}` },
      }),
    );
  }

  it("200 and the schema matches", async () => {
    const res = await call();
    expect(res.status).toBe(200);
    const body = await res.json();

    expect(body.ok).toBe(true);
    expect(body.service).toBe("storeai");
    expect(typeof body.generated_at).toBe("string");

    expect(body.build).toBeDefined();
    expect(typeof body.build.commit).toBe("string");
    expect(Array.isArray(body.build.recent_commits)).toBe(true);

    expect(body.health).toMatchObject({
      status: expect.stringMatching(/^(ok|degraded)$/),
      postgres: expect.stringMatching(/^(ok|degraded)$/),
      redis: expect.stringMatching(/^(ok|degraded)$/),
      storage: expect.stringMatching(/^(ok|degraded)$/),
      worker: expect.stringMatching(/^(ok|degraded)$/),
    });

    expect(body.totals).toMatchObject({
      tenants: expect.any(Number),
      users: expect.any(Number),
      projects: expect.any(Number),
      records: expect.any(Number),
      files: expect.any(Number),
      api_keys_active: expect.any(Number),
      sessions_active: expect.any(Number),
    });

    expect(body.counts_24h).toMatchObject({
      signups: expect.any(Number),
      logins_success: expect.any(Number),
      logins_failed: expect.any(Number),
      api_key_auth_failed: expect.any(Number),
      probe_hits: expect.any(Number),
      rate_limited: expect.any(Number),
      audit_events: expect.any(Number),
      usage_events: expect.any(Number),
    });

    expect(body.http_24h).toMatchObject({
      "2xx": expect.any(Number),
      "3xx": expect.any(Number),
      "4xx": expect.any(Number),
      "5xx": expect.any(Number),
      p95_latency_ms: null,
    });

    expect(body.queue).toMatchObject({
      file_post_process: {
        waiting: expect.any(Number),
        active: expect.any(Number),
        failed: expect.any(Number),
      },
      audit_fanout: {
        waiting: expect.any(Number),
        active: expect.any(Number),
        failed: expect.any(Number),
      },
    });
  });

  it("exposes no seed-data strings — no PII in the response", async () => {
    // Seed one user + tenant with known distinctive strings; verify none
    // of them appear anywhere in the response JSON.
    const email = uniqueEmail("canary");
    const tenantSlug = uniqueSlug("canary-tenant");
    const distinctiveUserName = "Canary-User-5b3a2f1e";
    const distinctiveTenantName = "Canary-Workspace-9d2c";

    await createUserAndTenant({
      email,
      name: distinctiveUserName,
      tenantName: distinctiveTenantName,
      tenantSlug,
    });

    const res = await call();
    const text = JSON.stringify(await res.json());

    // Field-level: these should never appear
    expect(text).not.toContain(email);
    expect(text).not.toContain(tenantSlug);
    expect(text).not.toContain(distinctiveUserName);
    expect(text).not.toContain(distinctiveTenantName);
    expect(text).not.toContain("password");
    expect(text).not.toContain("secret");
    // AUTH_SECRET and DB creds must not leak
    const authSecret = process.env.AUTH_SECRET;
    if (authSecret) expect(text).not.toContain(authSecret);
    expect(text).not.toMatch(/argon2id\$v=/i); // argon2 hash prefix
    expect(text).not.toContain("tokenHash");
    expect(text).not.toContain("token_hash");
  });
});

describe("/api/ops/overview — per-token rate limit", () => {
  // Shrink LIMIT for tests. Production is 30/60s (see apps/web/src/lib/
  // opsConfig.ts). Running 30+ argon2 verifies per test would risk
  // straddling a 60s window boundary and making these flaky.
  const LIMIT = 5;
  let originalLimit: number;
  let originalWindow: number;

  beforeAll(async () => {
    // Limiter is bypassed in NODE_ENV=test by default; turn it on here.
    process.env.FORCE_RATE_LIMIT = "1";
    const { opsRateLimit } = await import("@/lib/opsConfig");
    originalLimit = opsRateLimit.limit;
    originalWindow = opsRateLimit.windowSeconds;
    opsRateLimit.limit = LIMIT;
    opsRateLimit.windowSeconds = 60;
  });
  afterAll(async () => {
    delete process.env.FORCE_RATE_LIMIT;
    const { opsRateLimit } = await import("@/lib/opsConfig");
    opsRateLimit.limit = originalLimit;
    opsRateLimit.windowSeconds = originalWindow;
  });

  async function clearOpsBucket(tokenId: string) {
    const { getAppConnection } = await import("@storeai/queue");
    const r = getAppConnection();
    const keys = await r.keys(`rl:ops:${tokenId}:*`);
    if (keys.length) await r.del(...keys);
  }

  beforeEach(async () => {
    await resetDb();
  });

  it(`allows up to ${LIMIT} requests per minute and 429s the next one with Retry-After`, async () => {
    const { plaintext, token } = await issueOpsToken({ name: "rl-test" });
    await clearOpsBucket(token.id);

    // Drive through the full budget. We don't care about 200 payloads here,
    // just that none of the first LIMIT calls are 429s.
    for (let i = 0; i < LIMIT; i++) {
      const res = await opsGET(
        buildRequest("/api/ops/overview", {
          headers: { authorization: `Bearer ${plaintext}` },
        }),
      );
      expect(res.status).not.toBe(429);
    }

    // The next call should be throttled.
    const res = await opsGET(
      buildRequest("/api/ops/overview", {
        headers: { authorization: `Bearer ${plaintext}` },
      }),
    );
    expect(res.status).toBe(429);
    const retryAfter = res.headers.get("retry-after");
    expect(retryAfter).toBeTruthy();
    expect(Number(retryAfter)).toBeGreaterThan(0);
    expect(Number(retryAfter)).toBeLessThanOrEqual(60);
    const body = await res.json();
    expect(body.ok).toBe(false);
    expect(body.error?.code).toBe("rate_limited");
  }, 20_000);

  it("429 increments the rate_limited counter observable on the endpoint itself", async () => {
    const { plaintext, token } = await issueOpsToken({ name: "rl-counter" });
    await clearOpsBucket(token.id);

    // Saturate the bucket.
    for (let i = 0; i < LIMIT + 1; i++) {
      await opsGET(
        buildRequest("/api/ops/overview", {
          headers: { authorization: `Bearer ${plaintext}` },
        }),
      );
    }

    // Use a fresh token (its own bucket) to read the aggregate payload.
    // Its single request won't exhaust its own budget and the payload should
    // reflect the rate_limited increments above.
    const { plaintext: readerPlaintext, token: reader } = await issueOpsToken({
      name: "rl-counter-reader",
    });
    await clearOpsBucket(reader.id);

    const res = await opsGET(
      buildRequest("/api/ops/overview", {
        headers: { authorization: `Bearer ${readerPlaintext}` },
      }),
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.counts_24h.rate_limited).toBeGreaterThan(0);
  }, 20_000);

  it("different tokens get independent buckets", async () => {
    const { plaintext: a, token: tokenA } = await issueOpsToken({ name: "rl-a" });
    const { plaintext: b, token: tokenB } = await issueOpsToken({ name: "rl-b" });
    await clearOpsBucket(tokenA.id);
    await clearOpsBucket(tokenB.id);

    // Exhaust token A.
    for (let i = 0; i < LIMIT; i++) {
      await opsGET(
        buildRequest("/api/ops/overview", {
          headers: { authorization: `Bearer ${a}` },
        }),
      );
    }
    const aRes = await opsGET(
      buildRequest("/api/ops/overview", {
        headers: { authorization: `Bearer ${a}` },
      }),
    );
    expect(aRes.status).toBe(429);

    // Token B is untouched and must still pass.
    const bRes = await opsGET(
      buildRequest("/api/ops/overview", {
        headers: { authorization: `Bearer ${b}` },
      }),
    );
    expect(bRes.status).toBe(200);
  }, 30_000);
});

describe("/api/ops/overview — fail-closed", () => {
  beforeAll(async () => {
    await resetDb();
  });

  it("returns 200 with health.postgres == 'degraded' when Postgres is unreachable", async () => {
    const { plaintext } = await issueOpsToken({ name: "test-failclosed" });

    // Mock the Postgres probe to throw so we exercise the fail-closed path
    // without actually tearing down the shared Postgres container (which
    // would break every other test in the same vitest run).
    const dbModule = await import("@storeai/db");
    const origExecute = dbModule.getDb().execute;
    const db = dbModule.getDb();
    const stub = vi
      .spyOn(db, "execute")
      .mockImplementation(() => {
        throw new Error("simulated postgres failure");
      });

    try {
      const res = await opsGET(
        buildRequest("/api/ops/overview", {
          headers: { authorization: `Bearer ${plaintext}` },
        }),
      );
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.health.postgres).toBe("degraded");
      expect(body.health.status).toBe("degraded");
      // DB-sourced totals must zero-fill when Postgres is down
      expect(body.totals.users).toBe(0);
      expect(body.totals.tenants).toBe(0);
    } finally {
      stub.mockRestore();
      // Restore just in case spy state is weird
      db.execute = origExecute;
    }
  });
});
