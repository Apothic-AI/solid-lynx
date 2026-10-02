import { defineConfig } from "@playwright/test";
import { fileURLToPath } from "node:url";

const repoRoot = fileURLToPath(new URL(".", import.meta.url));

export default defineConfig({
  testDir: "./test/browser",
  testMatch: "lynx-for-web.test.ts",
  fullyParallel: false,
  workers: 1,
  expect: {
    timeout: 10_000,
  },
  use: {
    baseURL: "http://127.0.0.1:4173",
    browserName: "chromium",
    screenshot: "only-on-failure",
    trace: "retain-on-failure",
  },
  webServer: {
    command: "pnpm web:build && pnpm web:serve",
    cwd: repoRoot,
    url: "http://127.0.0.1:4173",
    reuseExistingServer: false,
    timeout: 120_000,
  },
});
