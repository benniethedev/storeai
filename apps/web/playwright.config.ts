import { defineConfig, devices } from "@playwright/test";

// Dedicated port for the Playwright-managed dev server. Must NOT collide
// with a port another project is using — the previous value (3100) turned
// out to be held by an unrelated app on some dev machines. We verify the
// health endpoint returns the StoreAI shape before trusting a reused server.
const PORT = Number(process.env.E2E_PORT ?? 3317);

export default defineConfig({
  testDir: "./tests/e2e",
  timeout: 60000,
  retries: 0,
  use: {
    baseURL: `http://localhost:${PORT}`,
    trace: "retain-on-failure",
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
  webServer: {
    command: `PORT=${PORT} pnpm --dir ../.. --filter @storeai/web dev`,
    url: `http://localhost:${PORT}/api/health`,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
