import { describe, it, expect, beforeAll, beforeEach } from "vitest";
import { POST as signupPOST } from "@/app/api/auth/signup/route";
import { POST as loginPOST } from "@/app/api/auth/login/route";
import { POST as logoutPOST } from "@/app/api/auth/logout/route";
import { GET as meGET } from "@/app/api/auth/me/route";
import { buildRequest, expectOk, sessionCookies } from "./helpers/http";
import { resetDb, uniqueEmail, uniqueSlug } from "./helpers/db";

beforeAll(async () => {
  await resetDb();
});
beforeEach(async () => {
  await resetDb();
});

describe("auth flows", () => {
  it("signs up a user, creates a starter tenant, and returns session cookies", async () => {
    const email = uniqueEmail("s");
    const res = await signupPOST(
      buildRequest("/api/auth/signup", {
        method: "POST",
        body: {
          email,
          password: "password1234",
          name: "Signup Person",
          tenantName: "Acme",
          tenantSlug: uniqueSlug("acme"),
        },
      }),
    );
    const data = await expectOk(res);
    expect(data.user.email).toBe(email);
    expect(data.tenant.slug).toMatch(/^acme-/);
    expect(res.cookies.get("sa_session")?.value).toBeTruthy();
    expect(res.cookies.get("sa_csrf")?.value).toBeTruthy();
  });

  it("rejects duplicate email", async () => {
    const email = uniqueEmail("d");
    const mk = () =>
      signupPOST(
        buildRequest("/api/auth/signup", {
          method: "POST",
          body: {
            email,
            password: "password1234",
            name: "Dup",
            tenantName: "W",
            tenantSlug: uniqueSlug("w"),
          },
        }),
      );
    await expectOk(await mk());
    const res2 = await mk();
    expect(res2.status).toBe(409);
  });

  it("logs in with correct password and rejects wrong one", async () => {
    const email = uniqueEmail("l");
    const password = "correct-horse-battery";
    await signupPOST(
      buildRequest("/api/auth/signup", {
        method: "POST",
        body: {
          email,
          password,
          name: "L",
          tenantName: "L",
          tenantSlug: uniqueSlug("l"),
        },
      }),
    );
    const badRes = await loginPOST(
      buildRequest("/api/auth/login", {
        method: "POST",
        body: { email, password: "wrong-password" },
      }),
    );
    expect(badRes.status).toBe(401);

    const goodRes = await loginPOST(
      buildRequest("/api/auth/login", { method: "POST", body: { email, password } }),
    );
    const data = await expectOk(goodRes);
    expect(data.user.email).toBe(email);
  });

  it("/me reflects active session; logout clears it", async () => {
    const email = uniqueEmail("m");
    const signRes = await signupPOST(
      buildRequest("/api/auth/signup", {
        method: "POST",
        body: {
          email,
          password: "password1234",
          name: "M",
          tenantName: "M",
          tenantSlug: uniqueSlug("m"),
        },
      }),
    );
    const token = signRes.cookies.get("sa_session")!.value;
    const csrf = signRes.cookies.get("sa_csrf")!.value;

    const meRes = await meGET(buildRequest("/api/auth/me", { cookies: { sa_session: token } }));
    const me = await expectOk(meRes);
    expect(me.user.email).toBe(email);
    expect(me.tenants.length).toBe(1);

    const logoutRes = await logoutPOST(
      buildRequest("/api/auth/logout", {
        method: "POST",
        cookies: { sa_session: token, sa_csrf: csrf },
        headers: { "x-sa-csrf": csrf },
      }),
    );
    await expectOk(logoutRes);

    const meRes2 = await meGET(buildRequest("/api/auth/me", { cookies: { sa_session: token } }));
    const me2 = await expectOk(meRes2);
    expect(me2.user).toBeNull();
  });
});
