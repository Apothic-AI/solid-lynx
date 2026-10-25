#!/usr/bin/env node
/**
 * Reproduce, deterministically, the Lynx-for-Web boot stall that the browser
 * suites hit intermittently on a 2-core CI runner.
 *
 * ## What the stall is
 *
 * `@lynx-js/web-core` boots a card through two independent halves that have to
 * meet in the middle:
 *
 *   - the **decode worker** fetches the `.web.bundle` and posts each decoded
 *     section to the main thread, ending with `done`; and
 *   - the **`LynxViewInstance` dynamic import**, whose promise every section
 *     handler awaits before it writes its section into the bundle.
 *
 * `TemplateManager` keeps an in-flight bundle in `#loadingBundles` and the
 * section writers (`#setConfig`, `#setLepusCode`, ...) look the bundle up
 * there by url. The `done` handler is the thing that moves it to `#bundles`.
 *
 * If `done` arrives *before* the import resolves, the bundle is moved while the
 * handlers are still waiting. When they resume they write into an object that
 * is no longer the one `getBundle()` returns. `lepusCode` is therefore empty,
 * `LynxViewInstance.onMTSScriptsLoaded` finds no `root` chunk, and it never
 * calls `mtsRealm.loadScript`. The card's main-thread script is never inserted
 * into the realm, `[part="page"]` is never appended, and `lynx-view` stays
 * `display: none`.
 *
 * Nothing in that sequence throws, and every page-level channel is clean:
 * the realm *did* load, its element APIs *were* installed, the worker *did*
 * report `done`. That is why the CI failures reported
 * `page errors: none / console errors: none / failed requests: none` next to a
 * card that never rendered.
 *
 * ## Why this script exists
 *
 * The window is a few milliseconds wide on an idle machine and opens to tens of
 * milliseconds when the module graph is cold or the CPU is starved, which is
 * what made the CI failures intermittent. Waiting for that is not a test.
 *
 * Delaying `LynxViewInstance.js` itself widens the window on purpose. The delay
 * is applied to the *module fetch*, which is exactly the real condition (that
 * import losing the race), and the decoder is untouched. With a delay several
 * times the whole boot cost, `done` wins every time:
 *
 *   - without the patch in `patches/@lynx-js__web-core@0.26.2.patch`, every run
 *     stalls;
 *   - with it, every run boots.
 *
 * ## Usage
 *
 *   pnpm web:build
 *   pnpm exec vite examples/lynx-for-web/site \
 *     --config examples/lynx-for-web/site/vite.config.ts \
 *     --host 127.0.0.1 --port 4399 --strictPort &
 *   node scripts/repro-boot-stall.mjs 4399
 *
 * Exit 0 means every run booted, 1 means at least one stalled, 2 could not
 * evaluate (the dev server was not reachable, or Playwright has no Chromium).
 * A stall here is a finding, not a flake: it means the patched `done` ordering
 * is not in effect, so check that `pnpm install` applied the patch and that the
 * dev server is not serving a stale optimized copy of the module.
 */
import { chromium } from "@playwright/test";

const HELP = `Reproduce the Lynx-for-Web boot stall deterministically.

Usage: node scripts/repro-boot-stall.mjs <port> [options]

  --runs=N        how many boots to attempt (default 4)
  --delay=MS      how long to hold the LynxViewInstance.js module (default 1500)
  --baseline      skip the delay, to show the machine boots fine without it
  --timeout=MS    per-boot budget (default 15000)
  --help          this text

Exit 0 every run booted, 1 at least one stalled, 2 could not evaluate.
`;

const argv = process.argv.slice(2);
if (argv.includes("--help") || argv.includes("-h")) {
  process.stdout.write(HELP);
  process.exit(0);
}

const port = argv.find(argument => /^\d+$/.test(argument)) ?? "4173";
const options = Object.fromEntries(
  argv.filter(argument => argument.startsWith("--"))
    .map(argument => {
      const [key, value] = argument.replace(/^--/, "").split("=");
      // A bare flag is its own value, so `--baseline` is not silently dropped.
      return [key, value ?? "true"];
    }),
);

const runs = Number(options.runs ?? "4");
const delayMs = Number(options.delay ?? "1500");
const budgetMs = Number(options.timeout ?? "15000");
const baseline = options.baseline === "true";
const baseUrl = `http://127.0.0.1:${port}/`;

const reachable = await fetch(baseUrl, { method: "HEAD" })
  .then(response => response.ok)
  .catch(() => false);
if (!reachable) {
  process.stderr.write(
    `cannot reach ${baseUrl} - build the bundle and start the fixture dev server first:\n`
    + `  pnpm web:build\n`
    + `  pnpm exec vite examples/lynx-for-web/site --config examples/lynx-for-web/site/vite.config.ts`
    + ` --host 127.0.0.1 --port ${port} --strictPort\n`,
  );
  process.exit(2);
}

let browser;
try {
  browser = await chromium.launch();
} catch (error) {
  process.stderr.write(`could not launch Chromium: ${error.message}\n`);
  process.exit(2);
}

const readState = page => page.locator("lynx-view").evaluate(element => {
  const shadowRoot = element.shadowRoot;
  const realm = shadowRoot?.querySelector("iframe")?.contentWindow;
  const elementApisInstalled = typeof realm?.__CreatePage === "function";
  const realmScripts = [...(realm?.document?.head?.querySelectorAll("script") ?? [])]
    .map(script => (script.src ? "card" : "inline"));
  const cardScriptInserted = realmScripts.includes("card");
  return {
    phase: !shadowRoot
      ? "no shadow root"
      : !shadowRoot.querySelector("iframe")
        ? "no realm iframe"
        : !shadowRoot.querySelector("link")
          ? "realm iframe, no LynxViewInstance stylesheet"
          : elementApisInstalled && !cardScriptInserted
            // The config section reached the realm and the lepus-code section did
            // not: the TemplateManager #loadingBundles/#bundles race.
            ? "element APIs installed from the config section, card lepus code never reached onMTSScriptsLoaded"
            : "[part=page] never appended and the card script never inserted",
    display: getComputedStyle(element).display,
    shadowChildren: [...(shadowRoot?.children ?? [])].map(child => child.tagName.toLowerCase()),
    realmScripts,
    elementApisInstalled,
    pagePart: Boolean(shadowRoot?.querySelector('[part="page"]')),
  };
}).catch(error => ({ error: error.message }));

let stalls = 0;
for (let run = 1; run <= runs; run += 1) {
  const context = await browser.newContext();
  const page = await context.newPage();
  const pageChannels = [];
  page.on("pageerror", error => pageChannels.push(`pageerror: ${error.message}`));
  page.on("console", message => {
    if (message.type() === "error") pageChannels.push(`console: ${message.text()}`);
  });
  page.on("requestfailed", request => pageChannels.push(`requestfailed: ${request.url()}`));

  let delayed = 0;
  if (!baseline) {
    // Only the LynxViewInstance module is held. The decoder, the wasm and the
    // bundle are untouched, so the boot is a normal one whose second half is
    // simply slower than its first - which is the whole bug.
    await context.route("**/dist/client/mainthread/LynxViewInstance.js*", async route => {
      delayed += 1;
      await new Promise(resolve => setTimeout(resolve, delayMs));
      await route.continue();
    });
  }

  const started = Date.now();
  let booted = false;
  try {
    await page.goto(baseUrl, { waitUntil: "commit" });
    await page.locator("lynx-view").waitFor({ state: "attached", timeout: 5_000 });
    const deadline = Date.now() + budgetMs;
    while (Date.now() < deadline) {
      const marker = await page.locator("lynx-view")
        .evaluate(element => element.shadowRoot?.querySelector("#count")?.textContent ?? null)
        .catch(() => null);
      if (marker === "Counter: 0") {
        booted = true;
        break;
      }
      await page.waitForTimeout(75);
    }
  } catch (error) {
    pageChannels.push(`navigation: ${error.message}`);
  }

  const elapsed = Date.now() - started;
  const state = booted ? null : await readState(page);
  if (!booted) stalls += 1;

  process.stdout.write(
    `run ${run}: ${booted ? "booted " : "STALLED"} in ${String(elapsed).padStart(5)}ms`
    + (baseline ? "" : ` (LynxViewInstance.js held ${delayed}x for ${delayMs}ms)`)
    + "\n",
  );
  if (state) {
    process.stdout.write(`  stalled stage: ${state.phase ?? state.error}\n`);
    process.stdout.write(`  ${JSON.stringify(state)}\n`);
    // These are the three lists CI reported as "(none)" during a stall, printed
    // here so the reproduction shows the same silence the runner did.
    process.stdout.write(
      `  page-level channels: ${pageChannels.length > 0 ? pageChannels.join("; ") : "(none)"}\n`,
    );
  }
  await context.close();
}

await browser.close();

process.stdout.write(
  `\n${baseline ? "baseline (no module delay)" : `LynxViewInstance.js held ${delayMs}ms`}`
  + `: ${runs - stalls}/${runs} booted, ${stalls} stalled\n`,
);
process.exit(stalls === 0 ? 0 : 1);
