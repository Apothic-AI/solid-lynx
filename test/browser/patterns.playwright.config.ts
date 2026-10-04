import { defineConfig } from "@playwright/test";
import { fileURLToPath } from "node:url";

const repoRoot = fileURLToPath(new URL("../..", import.meta.url));
const port = process.env.PLAYWRIGHT_PORT ?? "4186";

/**
 * Wiring for the pattern example only.
 *
 * The pattern suite is a separate Playwright project from the main
 * Lynx-for-Web suite: it builds and serves its own example, so it can be run,
 * failed, and iterated on without touching that suite's configuration. Set
 * `PLAYWRIGHT_PORT` to a free port; the default matches the documented one.
 */
export default defineConfig({
  testDir: ".",
  testMatch: "patterns.test.ts",
  fullyParallel: false,
  workers: 1,
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
    command: `pnpm build && pnpm exec rspeedy build --root examples/lynx-patterns && pnpm exec vite examples/lynx-patterns/site --config examples/lynx-patterns/site/vite.config.ts --force --host 127.0.0.1 --port ${port} --strictPort`,
    cwd: repoRoot,
    url: `http://127.0.0.1:${port}`,
    reuseExistingServer: false,
    timeout: 180_000,
  },
});