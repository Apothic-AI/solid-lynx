import { defineConfig } from "@playwright/test";
import { fileURLToPath } from "node:url";

const repoRoot = fileURLToPath(new URL(".", import.meta.url));

export default defineConfig({
  testDir: "./test/browser",
  testMatch: "lynx-for-web.test.ts",
  expect: {
    timeout: 10_000,
  },
  use: {
    baseURL: "http://127.0.0.1:4173",
    browserName: "chromium",
  },
  webServer: {
    command:
      "pnpm exec vite examples/lynx-for-web/site --host 127.0.0.1 --port 4173 --strictPort",
    cwd: repoRoot,
    url: "http://127.0.0.1:4173",
    reuseExistingServer: !process.env.CI,
    timeout: 30_000,
  },
});
