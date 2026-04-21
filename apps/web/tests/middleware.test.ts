import { describe, it, expect } from "vitest";
import { NextRequest } from "next/server";
import { middleware } from "@/middleware";

function req(path: string): NextRequest {
  return new NextRequest(new URL(`http://localhost${path}`));
}

describe("probe-path middleware", () => {
  const BLOCKED = [
    "/.env",
    "/.env.production",
    "/.env.local",
    "/.git/config",
    "/wp-admin/install.php",
    "/wp-login.php",
    "/phpmyadmin/",
    "/vendor/backup.zip",
    "/etc/passwd",
    "/proc/self/environ",
    "/.aws/credentials",
    "/xmlrpc.php",
    "/adminer/",
  ];

  const ALLOWED = [
    "/",
    "/login",
    "/signup",
    "/dashboard",
    "/dashboard/projects",
    "/api/health",
    "/api/records",
    "/api/auth/login",
    "/envelope",     // contains "env" but not a probe
    "/environments", // should pass
    "/.well-known/acme-challenge/abc", // Let's Encrypt ACME
  ];

  for (const path of BLOCKED) {
    it(`404s probe path: ${path}`, () => {
      const res = middleware(req(path));
      expect(res.status).toBe(404);
    });
  }

  for (const path of ALLOWED) {
    it(`allows legitimate path: ${path}`, () => {
      const res = middleware(req(path));
      // NextResponse.next() returns 200-ish with a header marker
      expect(res.status).toBe(200);
    });
  }
});
