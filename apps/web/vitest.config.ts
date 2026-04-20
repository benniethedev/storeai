import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  test: {
    include: ["tests/**/*.test.ts"],
    environment: "node",
    setupFiles: ["tests/setup.ts"],
    pool: "forks",
    poolOptions: { forks: { singleFork: true } },
    testTimeout: 30000,
    hookTimeout: 60000,
    server: {
      deps: {
        // Force these to run through Node's ESM resolver (not Vite) so native
        // modules and CJS-only packages work in tests.
        external: [/^@aws-sdk\//, /^postgres$/, /^bullmq$/, /^ioredis$/, /^argon2$/],
      },
    },
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
      "server-only": path.resolve(__dirname, "./tests/stubs/server-only.ts"),
    },
  },
});
