import { defineConfig } from "@playwright/test";
import { fileURLToPath } from "node:url";

const repoRoot = fileURLToPath(new URL(".", import.meta.url));
const port = process.env.PLAYWRIGHT_PORT ?? "4173";

export default defineConfig({
  testDir: "./test/browser",
  testMatch: "lynx-for-web.test.ts",
  fullyParallel: false,
  workers: 1,
  // The first test pays for Vite's cold dependency optimization and the Lynx
  // wasm start-up, so keep generous per-test and assertion timeouts.
  timeout: 120_000,
  expect: {
    timeout: 20_000,
  },
  use: {
    baseURL: `http://127.0.0.1:${port}`,
    browserName: "chromium",
    screenshot: "only-on-failure",
    trace: "retain-on-failure",
  },
  webServer: {
    command: "pnpm web:build && pnpm web:serve",
    cwd: repoRoot,
    url: `http://127.0.0.1:${port}`,
    reuseExistingServer: false,
    timeout: 120_000,
  },
});
