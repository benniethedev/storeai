import { NextResponse, type NextRequest } from "next/server";

/**
 * Cheap early-404 for common port-scanner probe paths. Stops them from
 * hitting route handlers, polluting usage_logs, or (in dev) triggering
 * the error overlay. This is NOT a security boundary — tenants, auth,
 * and RBAC handle that — it's an availability-and-noise filter.
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
