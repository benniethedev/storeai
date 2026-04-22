import { NextResponse, type NextRequest } from "next/server";
import { incrCounter } from "./lib/metrics.js";

// Node runtime so we can use ioredis for the probe counter. Edge runtime
// can't open TCP sockets to Redis without a proxy; Node runtime is fine
// for this app's scale.
export const runtime = "nodejs";

/**
 * Cheap early-404 for common port-scanner probe paths. Stops them from
 * hitting route handlers, polluting usage_logs, or (in dev) triggering
 * the error overlay. This is NOT a security boundary — tenants, auth,
 * and RBAC handle that — it's an availability-and-noise filter.
 *
 * Caddy already drops these at the edge; this layer exists so that if
 * Caddy is bypassed (misconfigured proxy, direct-to-app deploy) the
 * app still 404s them, and the counter gives us a tripwire for when
 * scanners reach us despite the reverse proxy.
 */
const PROBE_PATTERNS: RegExp[] = [
  /\/\.env($|\.|\/)/i,
  /\/\.git($|\/)/i,
  /\/\.(svn|hg|bzr)($|\/)/i,
  /\/\.DS_Store$/i,
  /\/\.aws\//i,
  /\/\.ssh\//i,
  /\/wp-(admin|login|content|includes|json)/i,
  /\/phpmyadmin/i,
  /\/adminer/i,
  /\/(xmlrpc|phpinfo|info|shell|webshell|c99|r57)\.(php|asp|aspx|jsp)$/i,
  /\/(vendor|storage|backup|dump|db)\/[^/]*\.(zip|tar|gz|sql|bak|log|json)$/i,
  /\/server-status/i,
  /\/cgi-bin\//i,
  /\/etc\/passwd/i,
  /\/proc\/self/i,
];

export function middleware(req: NextRequest): NextResponse {
  const path = req.nextUrl.pathname;

  for (const pat of PROBE_PATTERNS) {
    if (pat.test(path)) {
      // Fire and forget — never block the 404 on a Redis call.
      void incrCounter("probe_hits");
      return new NextResponse("Not Found", {
        status: 404,
        headers: { "content-type": "text/plain" },
      });
    }
  }

  return NextResponse.next();
}

export const config = {
  matcher: "/((?!_next/static|_next/image|favicon.ico).*)",
};
