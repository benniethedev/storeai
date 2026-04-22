import "server-only";

/**
 * Runtime configuration for the /api/ops/* endpoints. Kept in a lib module
 * (not next to the route) so tests can mutate it without the route directory
 * acquiring any `process.env` / config-detection surface — the CI grep
 * (.github/workflows/deploy-preflight.yml) greps apps/web/src/app/api/ops/
 * for forbidden identifiers and `process.env` is one of them.
 *
 * Production values are the only ones that matter; tests override the limit
 * to something small so a single test case doesn't need 30 argon2 verifies.
 */
export const opsRateLimit = {
  limit: 30,
  windowSeconds: 60,
};
