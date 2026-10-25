import { expect, test, type Locator, type Page, type Response } from "@playwright/test";

interface ElementSnapshot {
  tag: string;
  id: string | null;
  uniqueId: number;
  attributes: Record<string, string>;
  attributeNames: string[];
  inlineStyle: string | null;
  dataset: Record<string, unknown>;
  classes: string[];
  childCount: number;
  children: { tag: string; id: string | null }[];
  parentId: string | null;
}

interface FlushMeasurement {
  during: number;
  total: number;
}

interface ListenerCall {
  op: "add" | "remove";
  name: string;
  bindType: number | undefined;
  capture: boolean | undefined;
  closureType: number | undefined;
  elementId: string | null;
  uniqueId: number;
}

interface ListenerBalance {
  elementId: string | null;
  uniqueId: number;
  name: string;
  bindType: number | undefined;
  capture: boolean | undefined;
  closureType: number | undefined;
  adds: number;
  removes: number;
}

interface CSSIdCall {
  cssId: number | null;
  entryName: string | undefined;
  elementIds: (string | null)[];
  uniqueIds: number[];
}

interface RefEvent {
  kind: "attach" | "detach";
  label: string;
  tag?: string | null;
  id?: string | null;
}

/**
 * Calls the PAPI probe that the fixture installs on the main-thread realm of
 * this `<lynx-view>`. Each view runs its own bundle in its own realm, so the
 * trace belongs to that view alone.
 */
async function probeCall<T>(view: Locator, method: string, ...args: unknown[]): Promise<T> {
  return view.evaluate(async (element, { method: name, args: callArgs }) => {
    const shadow = (element as HTMLElement).shadowRoot;
    const frame = shadow?.querySelector("iframe") as
      | (HTMLIFrameElement & { contentWindow: Record<string, any> })
      | null;
    const probe = frame?.contentWindow?.__SOLID_LYNX_PROBE__;
    if (!probe) {
      throw new Error("the main-thread PAPI probe is not available in this lynx-view");
    }
    return await probe[name](...callArgs);
  }, { method, args });
}

/** The dispatch slot of a registration, without the element identity. */
function dispatchSlot(call: ListenerCall) {
  return {
    op: call.op,
    name: call.name,
    bindType: call.bindType,
    capture: call.capture,
    closureType: call.closureType,
  };
}

async function eventLog(view: Locator): Promise<string[]> {
  const text = await view.locator("#event-log").textContent();
  return (text ?? "").replace(/^Events:\s*/, "").split(" | ").filter(Boolean);
}

/**
 * Clears the recorded event log, taps one control, and waits for the handlers
 * that tap reached. Reading the log per tap keeps each dispatch order in its own
 * assertion instead of accumulating every earlier tap.
 */
async function tapAndReadLog(view: Locator, id: string, expected: string[]): Promise<void> {
  await probeCall<void>(view, "clearEventLog");
  await expect.poll(() => eventLog(view)).toEqual([]);
  await view.locator(`#${id}`).click();
  await expect.poll(() => eventLog(view)).toEqual(expected);
}

/**
 * What a realm recorded for itself, written by `installRealmErrorSink`.
 *
 * `url` is read on the realm's own side as well: `diagnostics()` labels each
 * record with the `about:srcdoc` frame it came from, which would not say which
 * realm produced it. The realm's `location` does.
 */
interface RealmErrors {
  url: string;
  exceptions: string[];
  consoleErrors: string[];
}

/** The global `installRealmErrorSink` writes, and the loader reads back. */
const REALM_ERRORS_KEY = "__SOLID_LYNX_REALM_ERRORS__";

/**
 * Runs inside every realm of the page, including the Lynx one, before that
 * realm's own scripts.
 *
 * `@lynx-js/web-core` runs the card's main-thread code in an iframe it creates
 * inside `lynx-view`'s shadow root, so that realm is where this package executes
 * at all. Playwright exposes no `pageerror` or `console` event on a `Frame`, and
 * `page.on("pageerror")` / `page.on("console")` listen to the top-level page,
 * so without this the record of an exception thrown while a card boots would be
 * the parent document's record: empty, while the realm had failed.
 *
 * The realm serialises each record to a primitive as it arrives, so a read of it
 * later cannot re-run a getter, cannot be blocked by a structured clone of a
 * DOM-error object returned by `console.error("failed", error)`, and does not
 * depend on the realm's own objects still being alive.
 */
function installRealmErrorSink(recordKey: string): void {
  const target = globalThis as unknown as Record<string, unknown>;
  const record: RealmErrors = { url: location.href, exceptions: [], consoleErrors: [] };
  target[recordKey] = record;

  const describe = (value: unknown): string => {
    if (value instanceof Error) return `${value.name}: ${value.message}`;
    if (typeof value === "string") return value;
    try {
      return String(value);
    } catch {
      return "<unprintable>";
    }
  };

  (globalThis as unknown as Window).addEventListener("error", event => {
    const { error, message, filename, lineno, colno } = event as ErrorEvent;
    const where = filename ? ` (${filename}:${lineno}:${colno})` : "";
    record.exceptions.push(`${describe(error ?? message)}${where}`);
  });
  (globalThis as unknown as Window).addEventListener("unhandledrejection", event => {
    record.exceptions.push(`unhandled rejection: ${describe(event.reason)}`);
  });

  // Wrapped rather than captured on the side, because the realm's own framework
  // reads the original through `globalThis.console`; replacing it would change
  // what the fixture does. Only the sink sees the extra call.
  for (const method of ["error", "warn"] as const) {
    const original = console[method];
    console[method] = (...args: unknown[]) => {
      record.consoleErrors.push(`${method}: ${args.map(describe).join(" ")}`);
      return original.apply(console, args);
    };
  }
}

/** The global `recordWorkerTraffic` writes, and the loader reads back. */
const WORKER_TRAFFIC_KEY = "__SOLID_LYNX_WORKER_TRAFFIC__";

/**
 * Records the message sequence of every worker the page constructs.
 *
 * web-core decodes the card bundle in a worker and waits for its `done` before
 * evaluating the card in the realm. A stall either side of that handshake is
 * indistinguishable from a slow one unless the sequence is kept: `done` received
 * and nothing after it is a main-thread step, `done` never received is the
 * worker's. Wrapping `Worker` here keeps the report off the test's own
 * scaffolding, which only ever sees what a worker chooses to log.
 */
function recordWorkerTraffic(recordKey: string): void {
  const target = globalThis as unknown as Record<string, unknown>;
  const traffic: { url: string; sent: string[]; received: string[] }[] = [];
  target[recordKey] = traffic;

  const describe = (value: unknown) => {
    if (value === null || typeof value !== "object" || !("type" in value)) return typeof value;
    const message = value as { type: unknown; label?: unknown };
    // `label` separates the bundle's sections (config, style info, code,
    // templates, manifest) by number, and named sections stringify to "NaN".
    // Which of them arrived is what says how far the decode got.
    return message.label === undefined
      ? String(message.type)
      : `${String(message.type)}:${String(message.label)}`;
  };

  const RealWorker = globalThis.Worker;
  if (typeof RealWorker !== "function") return;
  // A subclass keeps every `Worker` behaviour (including `postMessage`
  // transfer lists and module workers) and only observes.
  globalThis.Worker = class extends RealWorker {
    constructor(url: string | URL, options?: WorkerOptions) {
      super(url, options);
      const entry = { url: String(url), sent: [] as string[], received: [] as string[] };
      traffic.push(entry);
      const post = this.postMessage.bind(this);
      this.postMessage = (message: unknown, options?: StructuredSerializeOptions | Transferable[]) => {
        entry.sent.push(describe(message));
        return options === undefined ? post(message) : post(message, options as StructuredSerializeOptions);
      };
      this.addEventListener("message", event => {
        entry.received.push(describe((event as MessageEvent).data));
      });
    }
  };
}

async function loadFixture(page: Page): Promise<{
  bundleResponse: Response;
  consoleErrors: string[];
  failedRequests: string[];
  pageErrors: string[];
  view: Locator;
}> {
  const responses: Response[] = [];
  const pageErrors: string[] = [];
  const consoleErrors: string[] = [];
  const failedRequests: string[] = [];
  const workerErrors: string[] = [];
  const workersSeen: string[] = [];
  page.on("response", response => responses.push(response));
  page.on("pageerror", error => pageErrors.push(error.message));
  page.on("console", message => {
    if (message.type() === "error") consoleErrors.push(message.text());
  });
  page.on("worker", worker => {
    // web-core decodes and evaluates the card's bundle in this worker, so it is
    // the next thing that can stop a view between the stylesheet `link` and the
    // card's own code, and it fails without touching the page's error lists.
    workersSeen.push(worker.url());
    worker.on("console", message => {
      if (message.type() === "error") {
        consoleErrors.push(`Worker ${worker.url()}: ${message.text()}`);
        workerErrors.push(`Worker ${worker.url()}: ${message.text()}`);
      }
    });
  });
  page.on("requestfailed", request => {
    failedRequests.push(
      `${request.method()} ${request.url()}: ${request.failure()?.errorText ?? "unknown failure"}`,
    );
  });

  // The iframe the realm runs in is created after this navigation, and a
  // `srcdoc` frame gets a fresh document of its own, so the sink has to be
  // installed as an init script rather than injected into the page or into the
  // frame on `frameattached` (where it would race the realm's own scripts).
  await page.addInitScript(installRealmErrorSink, REALM_ERRORS_KEY);
  // web-core hands the card bundle to a worker and awaits a reply. A worker that
  // never answers looks exactly like a slow one from outside, so the reply
  // sequence is recorded as it arrives and reported when a view stalls.
  await page.addInitScript(recordWorkerTraffic, WORKER_TRAFFIC_KEY);

  await page.goto("/");

  const view = page.locator("lynx-view");
  await expect(view).toHaveCount(1);
  await expect.poll(() => page.evaluate(() => Boolean(customElements.get("lynx-view"))))
    .toBe(true);

  const bundleUrl = await view.evaluate(element => {
    const lynxView = element as HTMLElement & { src?: unknown; url?: unknown };
    const value = typeof lynxView.url === "string"
      ? lynxView.url
      : typeof lynxView.src === "string"
        ? lynxView.src
        : element.getAttribute("url") ?? element.getAttribute("src");
    return value;
  });
  expect(bundleUrl, "lynx-view should expose the generated bundle URL").toBeTruthy();

  const resolvedBundleUrl = new URL(bundleUrl!, page.url()).href;
  const expectedBundleUrl = new URL(resolvedBundleUrl);
  expect(expectedBundleUrl.pathname).toMatch(/\.web\.bundle$/);

  const list = (entries: string[]) => (entries.length > 0 ? entries.join("\n") : "(none)");

  /**
   * What each frame of the page recorded for itself.
   *
   * A frame with no record is one the sink never ran in, and that is reported
   * as such instead of as a frame that raised nothing. Chrome exposes a
   * `srcdoc` child frame to `page.frames()` the moment it is created, which is
   * before the realm's document exists, so an empty record and a missing record
   * are different findings here.
   */
  const realmRecords = async () => Promise.all(page.frames().map(async frame => {
    const label = frame === page.mainFrame() ? "top-level document" : `frame ${frame.url()}`;
    try {
      const record = await frame.evaluate(
        key => (globalThis as unknown as Record<string, unknown>)[key] as
          | RealmErrors
          | undefined,
        REALM_ERRORS_KEY,
      );
      return { label, record: record ?? null, reachable: true, failure: null };
    } catch (error) {
      // A detached frame throws here. That is a finding about the frame, not
      // about the page's error lists, so it is reported rather than dropped.
      return { label, record: null, reachable: false, failure: (error as Error).message };
    }
  }));

  const diagnostics = async () => {
    const realms = await realmRecords();
    return [
      [
        "Page errors (top-level document only - the Lynx realm is reported separately below):",
        list(pageErrors),
      ].join("\n"),
      ["Console errors (top-level document only):", list(consoleErrors)].join("\n"),
      ["Failed requests:", list(failedRequests)].join("\n"),
      [
        "Card bundle workers (web-core decodes and evaluates the bundle here):",
        ...(page.workers().length === 0 && workersSeen.length === 0
          ? ["  (no worker was ever constructed; the bundle was never handed to one)"]
          : [
            ...workersSeen.map(url => `  constructed: ${url}`),
            ...page.workers().map(worker => `  live: ${worker.url()}`),
            ...(workerErrors.length > 0
              ? workerErrors.map(entry => `  error: ${entry}`)
              : ["  (no console.error from a worker)"]),
            ...(await page.evaluate(key => {
              const traffic = (globalThis as unknown as Record<string, unknown>)[key] as
                | { url: string; sent: string[]; received: string[] }[]
                | undefined;
              return (traffic ?? []).map(entry =>
                `  messages ${entry.url.split("/").at(-1)}:`
                + ` sent [${entry.sent.join(", ") || "none"}]`
                + ` received [${entry.received.join(", ") || "none"}]`,
              );
            }, WORKER_TRAFFIC_KEY)),
          ]),
      ].join("\n"),
      [
        "Lynx iframe realm:",
        ...realms.map(({ label, record, reachable, failure }) => {
          if (!reachable) return `  ${label}: unreachable - ${failure}`;
          if (!record) return `  ${label}: no error sink installed (this frame is not covered)`;
          const exceptions = record.exceptions.length > 0
            ? record.exceptions.map(entry => `      ${entry}`).join("\n")
            : "      (no exception or unhandled rejection thrown in this realm)";
          const logged = record.consoleErrors.length > 0
            ? record.consoleErrors.map(entry => `      ${entry}`).join("\n")
            : "      (no console.error or console.warn called in this realm)";
          return [
            `  ${label} (realm location ${record.url}):`,
            "    exceptions:",
            exceptions,
            "    console:",
            logged,
          ].join("\n");
        }),
      ].join("\n"),
    ].join("\n\n");
  };
  const findBundleResponse = () => responses.find(response => {
    const url = new URL(response.url());
    return url.origin === expectedBundleUrl.origin && url.pathname === expectedBundleUrl.pathname;
  });

  try {
    await expect.poll(() =>
      findBundleResponse()
      ?? pageErrors[0]
      ?? consoleErrors[0]
      ?? failedRequests[0])
      .toBeTruthy();
  } catch (error) {
    throw new Error(
      `Timed out waiting for the Lynx web bundle response at ${resolvedBundleUrl}.\n\n${await diagnostics()}`,
      { cause: error },
    );
  }

  const bundleResponse = findBundleResponse();
  const bundleDiagnostics = await diagnostics();
  expect(bundleResponse, `expected a response for ${resolvedBundleUrl}\n\n${bundleDiagnostics}`)
    .toBeDefined();
  expect(bundleResponse!.ok(), `bundle request failed: ${resolvedBundleUrl}\n\n${bundleDiagnostics}`)
    .toBe(true);
  expect(await bundleResponse!.finished(), `bundle transfer failed: ${resolvedBundleUrl}\n\n${bundleDiagnostics}`)
    .toBeNull();

  /**
   * What `<lynx-view>` looks like right now, on both sides of the boundary
   * between the page and the realm.
   *
   * `phase` names how far web-core got, in the order it does those steps:
   * async import of `LynxViewInstance` -> stylesheet `<link>` in the shadow root
   * -> a hidden iframe with an `about:srcdoc` document -> the card's
   * main-thread bundle evaluated in that iframe's realm -> the Lynx tree.
   * The first phase that has not happened is what the view was waiting on, and
   * reading it off a stuck view is the difference between "slow" and "stopped".
   */
  const viewState = () => view.evaluate(element => {
    const shadowRoot = element.shadowRoot;
    const iframe = shadowRoot?.querySelector("iframe") as HTMLIFrameElement | null | undefined;
    const frameWindow = iframe?.contentWindow as
      | (Window & { __SOLID_LYNX_PROBE__?: unknown })
      | null
      | undefined;
    const exists = Boolean(frameWindow?.document);
    /*
     * Reading this `undefined` is the whole point: a realm the page cannot
     * reach is a different fault from a realm that ran and threw. It is read
     * inside a try so the answer is reported instead of aborting the snapshot.
     */
    let realmReachable = false;
    let realmFailure: string | null = null;
    try {
      realmReachable = Boolean(frameWindow?.document?.documentElement);
    } catch (error) {
      realmFailure = (error as Error).message;
    }
    const probeInstalled = Boolean(frameWindow?.__SOLID_LYNX_PROBE__);
    /*
     * web-core inserts the card's main-thread script into the realm's own
     * document (`createIFrameRealm.loadScript`) and awaits its `load` event with
     * no timeout. Nothing is raised when that load does not finish, so this is
     * the stage that can stall with an empty error list on every channel: the
     * script is in the realm, and the realm never runs it.
     *
     * The realm also carries web-core's own inline bootstrap script (the one
     * that posts `lynx:mtsready`), which has no `src`. So an entry with no `src`
     * is not the card: `cardScript` is true only for a script that has one.
     */
    const realmScripts = (() => {
      try {
        return Array.from(frameWindow?.document?.head?.querySelectorAll("script") ?? [])
          .map(script => ({
            src: script.src,
            inline: !script.src,
            readyState: (script as HTMLScriptElement & { readyState?: string }).readyState ?? null,
          }));
      } catch {
        return [];
      }
    })();
    const cardScriptInserted = realmScripts.some(script => !script.inline);
    const renderedCount = shadowRoot?.querySelector("#count")?.textContent ?? null;
    const rectOf = (node: Element) => {
      const rect = node.getBoundingClientRect();
      return { width: Math.round(rect.width), height: Math.round(rect.height) };
    };
    return {
      phase: !shadowRoot
        ? "no shadow root"
        : shadowRoot.querySelectorAll("iframe").length === 0
          ? "no realm iframe: web-core's LynxViewInstance module has not been imported yet"
          : !exists
            ? "realm iframe created, its document not loaded yet"
            : !shadowRoot.querySelector("link")
              ? "realm iframe created, LynxViewInstance not constructed yet (no stylesheet link)"
              : !probeInstalled
                ? cardScriptInserted
                  ? "the card's main-thread script is in the realm and has not finished loading"
                  : "LynxViewInstance constructed; the card's main-thread script is not in the realm yet"
                : renderedCount === null
                  ? "card bundle evaluated, no Lynx content in the shadow root yet"
                  : `rendered: ${renderedCount}`,
      renderedCount,
      shadowChildren: Array.from(shadowRoot?.children ?? []).map(child => child.tagName.toLowerCase()),
      iframeCount: shadowRoot?.querySelectorAll("iframe").length ?? 0,
      // The realm iframe is `display: none` on purpose; the size that matters is
      // `lynx-view`'s own box. Zero width or height is a real candidate cause:
      // it is what the element reports while the card has not been laid out.
      viewDisplay: getComputedStyle(element).display,
      viewBox: rectOf(element),
      // False here says the page never reached the layout step, whatever the
      // realm did, so the two findings cannot be confused for one another.
      viewIsVisible: element.checkVisibility(),
      realmUrl: iframe ? frameWindow?.location?.href ?? "<no document>" : null,
      realmReachable,
      realmFailure,
      realmScripts,
      cardScriptInserted,
      // web-core appends a render-blocking stylesheet `link` to the shadow root
      // in `LynxViewInstance`'s constructor, before the card's bundle runs, so a
      // `link` that is present marks that the constructor ran and the next step
      // is the decode worker's. `rules` is how many of its rules loaded: a link
      // whose `sheet` is missing or empty is a stylesheet that never arrived,
      // which is a different fault from a loaded one whose card never ran.
      link: (() => {
        const link = shadowRoot?.querySelector("link");
        if (!link) return null;
        let rules: number | null = null;
        try {
          rules = link.sheet?.cssRules.length ?? null;
        } catch {
          rules = null;
        }
        return { href: link.getAttribute("href"), blocking: link.getAttribute("blocking"), rules };
      })(),
      probeInstalled,
    };
  });

  /**
   * `lynx-view`'s box while the loader waits, oldest first.
   *
   * A size that is stable and zero says the page never laid the view out; a
   * size that changes says it was still booting when the wait gave up.
   */
  const viewBoxes: string[] = [];
  const renderState = async () => {
    if (pageErrors.length > 0 || consoleErrors.length > 0 || failedRequests.length > 0) {
      return "error";
    }
    const state = await viewState();
    const entry = `${state.viewBox.width}x${state.viewBox.height}`;
    if (viewBoxes.at(-1) !== entry) viewBoxes.push(entry);
    return state.renderedCount === "Counter: 0" ? "ready" : "waiting";
  };
  // The first page load of a run pays for Vite's cold dependency optimization
  // and the Lynx wasm start-up, and the view can come up with its main-thread
  // realm still empty. Reload once and wait again before calling that a failure,
  // so a slow cold start is not reported as a rendering regression.
  //
  // This covers both realms, and a failure says which one it was in. The page
  // listeners above see the top-level document only; the reloaded document's
  // Lynx realm is covered by the `installRealmErrorSink` init script, which runs
  // in that frame as well, so "top-level document only: (none)" in the report
  // is backed by a separate, non-empty realm section. `viewState()` then names
  // the boot phase the view stopped in and `viewBoxOverWait` says whether
  // `lynx-view` had a box to lay out while the wait ran.
  let contentRendered = false;
  for (let attempt = 1; attempt <= 2 && !contentRendered; attempt += 1) {
    if (attempt > 1) await page.reload();
    try {
      await expect.poll(renderState, {
        timeout: 30_000,
        message:
          `waiting for rendered Lynx content after ${resolvedBundleUrl} responded`
          + ` (attempt ${attempt} of 2)`,
      }).not.toBe("waiting");
      contentRendered = true;
    } catch (error) {
      if (attempt === 2) {
        const state = await viewState();
        throw new Error(
          `Timed out waiting for rendered Lynx content after ${resolvedBundleUrl} responded.\n\n${await diagnostics()}\n\nView state:\n${JSON.stringify({ ...state, viewBoxOverWait: viewBoxes }, null, 2)}`,
          { cause: error },
        );
      }
    }
  }

  const finalDiagnostics = await diagnostics();
  expect(pageErrors, finalDiagnostics).toEqual([]);
  expect(consoleErrors, finalDiagnostics).toEqual([]);
  expect(failedRequests, finalDiagnostics).toEqual([]);

  const contentIsInsideView = await view.evaluate(element => {
    const shadowRoot = element.shadowRoot;
    const renderedCount = shadowRoot?.querySelector("#count");
    return renderedCount !== null
      && renderedCount !== undefined
      && renderedCount.getRootNode() === shadowRoot;
  });
  expect(contentIsInsideView).toBe(true);

  return { bundleResponse: bundleResponse!, consoleErrors, failedRequests, pageErrors, view };
}

test.describe("Lynx for Web Solid app", () => {
  test("loads the generated bundle and mounts app content inside lynx-view", async ({ page }) => {
    const { bundleResponse, pageErrors } = await loadFixture(page);

    expect(bundleResponse.status()).toBe(200);
    expect(pageErrors).toEqual([]);
  });

  test("handles event props, reactive status properties, and datasets", async ({ page }) => {
    const { consoleErrors, failedRequests, pageErrors, view } = await loadFixture(page);
    const count = view.locator("#count");
    const status = view.locator("#status");
    const datasetReadout = view.locator("#dataset-readout");

    await view.locator("#increment").click();
    await expect(count).toHaveText("Counter: 1");
    await expect(status).toHaveAttribute("class", "status status-active");
    await expect(status).toHaveCSS("background-color", "rgb(154, 52, 18)");

    await status.click();
    await expect(datasetReadout).toHaveText("Dataset: 1");

    await view.locator("#alias-increment").click();
    await expect(count).toHaveText("Counter: 2");
    await expect(status).toHaveAttribute("class", "status status-ready");
    await expect(status).toHaveCSS("background-color", "rgb(22, 101, 52)");

    await status.click();
    await expect(datasetReadout).toHaveText("Dataset: 2");

    expect(pageErrors).toEqual([]);
    expect(consoleErrors).toEqual([]);
    expect(failedRequests).toEqual([]);
  });

  test("inserts, removes, and reorders keyed nodes in the Lynx view", async ({ page }) => {
    const { consoleErrors, failedRequests, pageErrors, view } = await loadFixture(page);
    const items = view.locator("#items [id^='item-']");
    const itemIds = () => items.evaluateAll(elements => elements.map(element => element.id));

    await expect.poll(itemIds).toEqual(["item-1", "item-2", "item-3"]);
    const retainedItems = await Promise.all(["item-2", "item-3"].map(id =>
      view.locator(`#${id}`).elementHandle(),
    ));

    await view.locator("#add-item").click();
    await expect.poll(itemIds).toEqual(["item-1", "item-2", "item-3", "item-4"]);

    await view.locator("#remove-first-item").click();
    await expect.poll(itemIds).toEqual(["item-2", "item-3", "item-4"]);

    await view.locator("#reverse-items").dispatchEvent("click", { bubbles: true });
    await expect.poll(itemIds).toEqual(["item-4", "item-3", "item-2"]);
    for (const [index, item] of retainedItems.entries()) {
      expect(await item?.evaluate(element => element.isConnected), `item-${index + 2} should be retained`)
        .toBe(true);
    }

    expect(pageErrors).toEqual([]);
    expect(consoleErrors).toEqual([]);
    expect(failedRequests).toEqual([]);
  });

  test("unmounts the Solid app when #dispose is clicked", async ({ page }) => {
    const { consoleErrors, failedRequests, pageErrors, view } = await loadFixture(page);

    await view.locator("#dispose").click();
    await expect(view.locator("#count")).toHaveCount(0);
    await expect(view.locator("#dispose")).toHaveCount(0);

    // Disposal must release every listener the root filed, in the slot it was
    // filed in, and leave no registration behind in the host.
    const balances = await probeCall<ListenerBalance[]>(view, "listenerBalances");
    expect(balances.length).toBeGreaterThan(0);
    expect(balances.filter(balance => balance.adds !== balance.removes)).toEqual([]);
    expect(await probeCall(view, "pageChildren")).toEqual([]);

    expect(pageErrors).toEqual([]);
    expect(consoleErrors).toEqual([]);
    expect(failedRequests).toEqual([]);
  });

  test("dispatches events through the capture, bubble, catch, and global passes", async ({ page }) => {
    const { consoleErrors, failedRequests, pageErrors, view } = await loadFixture(page);

    // A plain binding bubbles from the target up to the page.
    await tapAndReadLog(view, "event-bubble-child", ["bubble-child", "bubble-parent"]);
    // `catch` stops the bubble pass, so the parent binding never runs.
    await tapAndReadLog(view, "event-catch-child", ["catch-child"]);
    // A capture binding runs before the bubble pass, walking down the path.
    await tapAndReadLog(view, "event-capture-child", ["capture-parent", "capture-child"]);
    // `capture-catch` stops the event during the capture pass.
    await tapAndReadLog(view, "event-capture-catch-child", ["capture-catch-parent"]);
    // A namespaced binding dispatches like its plain form.
    await tapAndReadLog(view, "event-namespace-child", ["namespace-child", "namespace-parent"]);
    await tapAndReadLog(view, "event-global-child", ["global-child"]);

    const slots = async (id: string) =>
      (await probeCall<ListenerCall[]>(view, "listenerCallsFor", id)).map(dispatchSlot);

    expect(await slots("event-bubble-parent")).toEqual([
      { op: "add", name: "tap", bindType: 1, capture: undefined, closureType: undefined },
    ]);
    expect(await slots("event-catch-child")).toEqual([
      { op: "add", name: "tap", bindType: 4, capture: undefined, closureType: undefined },
    ]);
    expect(await slots("event-capture-parent")).toEqual([
      { op: "add", name: "tap", bindType: 2, capture: true, closureType: undefined },
    ]);
    expect(await slots("event-capture-catch-parent")).toEqual([
      { op: "add", name: "tap", bindType: 3, capture: true, closureType: undefined },
    ]);
    expect(await slots("event-namespace-child")).toEqual([
      { op: "add", name: "tap", bindType: 1, capture: undefined, closureType: 2 },
    ]);
    // `@lynx-js/web-core` files a `global-bind` handler in its own dispatch slot
    // but never runs the global pass for a function callback, so this binding is
    // verified where the renderer owns it: the registration itself. The fake PAPI
    // test covers the pass the host would run.
    expect(await slots("event-global-host")).toEqual([
      { op: "add", name: "tap", bindType: 5, capture: undefined, closureType: undefined },
    ]);

    expect(pageErrors).toEqual([]);
    expect(consoleErrors).toEqual([]);
    expect(failedRequests).toEqual([]);
  });

  test("replaces and removes bindings and detaches them with their subtree", async ({ page }) => {
    const { consoleErrors, failedRequests, pageErrors, view } = await loadFixture(page);
    const slots = async (id: string) =>
      (await probeCall<ListenerCall[]>(view, "listenerCallsFor", id)).map(dispatchSlot);
    const bubbleSlot = { op: "add", name: "tap", bindType: 1, capture: undefined, closureType: undefined } as const;

    expect(await slots("event-replace-target")).toEqual([bubbleSlot]);

    // Swapping the handler keeps the one registration and retargets it.
    await view.locator("#event-cycle-mode").click();
    await tapAndReadLog(view, "event-replace-target", ["replace-second", "replace-parent"]);
    expect(await slots("event-replace-target")).toEqual([bubbleSlot]);

    // Dropping the handler releases the registration, so only the parent binding
    // answers the tap.
    await view.locator("#event-cycle-mode").click();
    await tapAndReadLog(view, "event-replace-target", ["replace-parent"]);
    expect(await slots("event-replace-target")).toEqual([
      bubbleSlot,
      { ...bubbleSlot, op: "remove" },
    ]);

    // Restoring the handler registers the same slot again.
    await view.locator("#event-cycle-mode").click();
    await tapAndReadLog(view, "event-replace-target", ["replace-first", "replace-parent"]);
    expect(await slots("event-replace-target")).toEqual([
      bubbleSlot,
      { ...bubbleSlot, op: "remove" },
      bubbleSlot,
    ]);

    // A subtree that leaves the tree takes its bindings with it and gets them
    // back when it returns.
    const nested = await probeCall<ElementSnapshot>(view, "snapshot", "event-nested");
    expect(await probeCall<ListenerCall[]>(view, "listenerCallsForUniqueId", nested!.uniqueId)
      .then(calls => calls.map(dispatchSlot))).toEqual([bubbleSlot]);

    await view.locator("#event-nested-toggle").click();
    await expect(view.locator("#event-nested")).toHaveCount(0);
    expect(await probeCall<ListenerCall[]>(view, "listenerCallsForUniqueId", nested!.uniqueId)
      .then(calls => calls.map(dispatchSlot))).toEqual([bubbleSlot, { ...bubbleSlot, op: "remove" }]);

    await view.locator("#event-nested-toggle").click();
    const restored = await probeCall<ElementSnapshot>(view, "snapshot", "event-nested");
    expect(restored?.uniqueId).not.toBe(nested!.uniqueId);
    expect(await slots("event-nested")).toEqual([bubbleSlot]);
    await tapAndReadLog(view, "event-nested", ["nested"]);

    expect(pageErrors).toEqual([]);
    expect(consoleErrors).toEqual([]);
    expect(failedRequests).toEqual([]);
  });

  interface ParityReport {
  label: string;
  operations: {
    operation: string;
    papi: string[];
    status: "pass" | "fail" | "unsupported";
    expected: string;
    observed: string;
  }[];
  failures: { operation: string; observed: string }[];
  summary: { pass: number; fail: number; unsupported: number };
}

test("reports shared Element PAPI parity for the web host", async ({ page }) => {
    const { consoleErrors, failedRequests, pageErrors, view } = await loadFixture(page);

    const report = await probeCall<ParityReport>(view, "parityReport");

    expect(report.label).toBe("web-core");
    expect(report.failures).toEqual([]);
    // The harness runs inside the live card, so it also proves the shared
    // operations work while an app is mounted, not only in a unit test.
    expect(report.summary.fail).toBe(0);
    expect(report.operations.length).toBeGreaterThanOrEqual(15);
    expect(report.operations.filter(result => result.status === "unsupported")).toEqual([]);
    expect(report.summary.pass).toBe(report.operations.length);
    for (const operation of report.operations) {
      expect(operation.observed, `${operation.operation} should match "${operation.expected}"`)
        .toBe(operation.expected);
    }

    // Running the harness must not disturb the app around it.
    await expect(view.locator("#count")).toHaveText("Counter: 0");
    await view.locator("#increment").click();
    await expect(view.locator("#count")).toHaveText("Counter: 1");

    expect(pageErrors).toEqual([]);
    expect(consoleErrors).toEqual([]);
    expect(failedRequests).toEqual([]);
  });

  test("keeps a second root isolated and remounts a disposed root", async ({ page }) => {
    const { consoleErrors, failedRequests, pageErrors, view } = await loadFixture(page);
    const count = view.locator("#count");
    const secondaryCount = view.locator("#secondary-count");

    await probeCall<void>(view, "mountSecondaryRoot");
    await expect(secondaryCount).toHaveText("Secondary: 0");
    expect(await probeCall(view, "pageChildren")).toEqual([
      { tag: "view", id: "app" },
      { tag: "view", id: null },
    ]);

    // Each root updates only its own state.
    await view.locator("#secondary-increment").click();
    await expect(secondaryCount).toHaveText("Secondary: 1");
    await expect(count).toHaveText("Counter: 0");
    await view.locator("#increment").click();
    await expect(count).toHaveText("Counter: 1");
    await expect(secondaryCount).toHaveText("Secondary: 1");

    // Disposing one root releases its own nodes and leaves the other alone.
    await probeCall<void>(view, "disposeSecondaryRoot");
    await expect(secondaryCount).toHaveCount(0);
    await view.locator("#increment").click();
    await expect(count).toHaveText("Counter: 2");

    await probeCall<void>(view, "mountSecondaryRoot");
    await expect(secondaryCount).toHaveText("Secondary: 0");
    await view.locator("#dispose").click();
    await expect(count).toHaveCount(0);
    await expect(secondaryCount).toHaveText("Secondary: 0");
    await view.locator("#secondary-increment").click();
    await expect(secondaryCount).toHaveText("Secondary: 1");

    // A disposed root can be mounted again, and it registers fresh listeners.
    await probeCall<void>(view, "remountDisposedRoot");
    await expect(view.locator("#remounted-root")).toHaveCount(1);
    await view.locator("#remounted-tap").click();
    expect(await probeCall<number>(view, "remountTapCount")).toBe(1);

    expect(pageErrors).toEqual([]);
    expect(consoleErrors).toEqual([]);
    expect(failedRequests).toEqual([]);
  });

  test("maps attributes, styles, datasets, and boolean properties through the web PAPI", async ({ page }) => {
    const { consoleErrors, failedRequests, pageErrors, view } = await loadFixture(page);
    const target = view.locator("#properties-target");

    const initial = await probeCall<ElementSnapshot>(view, "snapshot", "properties-target");
    expect(initial?.tag).toBe("view");
    expect(initial?.parentId).toBe("properties");
    expect(initial?.attributes.role).toBe("note");
    expect(initial?.attributes["aria-label"]).toBe("Property target 0-0");
    expect(initial?.attributes.disabled).toBe("disabled");
    expect(initial?.attributes.checked).toBe("checked");
    expect(initial?.dataset).toMatchObject({ kind: "initial", burst: "0" });
    expect(initial?.classes).toEqual(["target"]);
    expect(await probeCall<string>(view, "computedStyle", "properties-target", "background-color"))
      .toBe("rgb(15, 23, 42)");
    await expect(target).toHaveAttribute("role", "note");
    await expect(target).toHaveCSS("padding", "4px");

    await view.locator("#properties-advance").click();
    await expect(view.locator("#properties-step")).toHaveText("Properties step 1 burst 0");

    const stringStyled = await probeCall<ElementSnapshot>(view, "snapshot", "properties-target");
    expect(stringStyled?.attributes["aria-label"]).toBe("Property target 1-0");
    expect(stringStyled?.attributes).not.toHaveProperty("disabled");
    expect(stringStyled?.attributes.checked).toBe("checked");
    expect(stringStyled?.dataset).toMatchObject({ kind: "updated" });
    expect(await probeCall<string>(view, "computedStyle", "properties-target", "background-color"))
      .toBe("rgb(29, 78, 216)");
    expect(await probeCall<string>(view, "computedStyle", "properties-target", "padding"))
      .toBe("0px");
    await expect(target).toHaveCSS("background-color", "rgb(29, 78, 216)");

    await view.locator("#properties-advance").click();
    await expect(view.locator("#properties-step")).toHaveText("Properties step 2 burst 0");

    const restored = await probeCall<ElementSnapshot>(view, "snapshot", "properties-target");
    expect(restored?.attributes.role).toBe("note");
    expect(restored?.attributeNames).not.toContain("aria-label");
    expect(restored?.attributes.disabled).toBe("disabled");
    expect(restored?.attributeNames).toContain("disabled");
    expect(restored?.attributeNames).not.toContain("checked");
    expect(restored?.attributeNames).not.toContain("data-kind");
    expect(restored?.dataset).toEqual({ burst: "0" });
    expect(await probeCall<string>(view, "computedStyle", "properties-target", "background-color"))
      .toBe("rgb(15, 23, 42)");
    await expect(target).toHaveAttribute("disabled", "disabled");
    await expect(target).not.toHaveAttribute("aria-label", /.*/);

    expect(pageErrors).toEqual([]);
    expect(consoleErrors).toEqual([]);
    expect(failedRequests).toEqual([]);
  });

  test("coalesces flushes per task and honors an explicit flush", async ({ page }) => {
    const { consoleErrors, failedRequests, pageErrors, view } = await loadFixture(page);

    expect(await probeCall<number>(view, "flushCount")).toBeGreaterThan(0);

    await probeCall<void>(view, "reset");
    await view.locator("#properties-burst").click();
    await expect(view.locator("#properties-step")).toHaveText("Properties step 0 burst 3");
    expect(await probeCall<number>(view, "flushCount")).toBe(1);

    const burst = await probeCall<ElementSnapshot>(view, "snapshot", "properties-target");
    expect(burst?.dataset).toMatchObject({ burst: "3" });
    expect(burst?.classes).toEqual(["target", "target-3"]);
    expect(await probeCall<string>(view, "computedStyle", "properties-target", "padding")).toBe("10px");

    const coalesced = await probeCall<FlushMeasurement>(view, "measureFlushes");
    expect(coalesced.during).toBe(0);
    expect(coalesced.total).toBe(1);

    const explicit = await probeCall<FlushMeasurement>(view, "measureFlushesWithExplicitFlush");
    expect(explicit.during).toBe(1);
    expect(explicit.total).toBe(1);

    expect(pageErrors).toEqual([]);
    expect(consoleErrors).toEqual([]);
    expect(failedRequests).toEqual([]);
  });
});

/**
 * `ref` is transformed by the Solid JSX compile step, so the only way to verify
 * it is against a bundle the compiler produced. These tests run the real
 * `main.web.bundle` in `@lynx-js/web-core` and assert the node the ref receives
 * is the live PAPI element, and that the attachment is released when the Solid
 * scope that created it goes away.
 */
test.describe("refs and imperative access in the web runtime", () => {
  test("hands a ref object the live element and clears it when the root is disposed", async ({ page }) => {
    const { consoleErrors, failedRequests, pageErrors, view } = await loadFixture(page);

    await expect(view.locator("#ref-object-target")).toHaveCount(1);
    await expect(view.locator("#ref-readout")).toHaveText(
      "ref state: held / held",
    );
    expect(await probeCall<string>(view, "refObjectState")).toBe("attached");

    // Disposing the root disposes every scope it owns, so no ref may still be
    // holding an element from the torn-down tree.
    await view.locator("#dispose").click();
    await expect(view.locator("#ref-object-target")).toHaveCount(0);

    expect(await probeCall<string>(view, "refObjectState")).toBe("detached");

    const events = await probeCall<RefEvent[]>(view, "refEvents");
    expect(events.filter(event => event.kind === "attach")).toHaveLength(1);

    expect(pageErrors).toEqual([]);
    expect(consoleErrors).toEqual([]);
    expect(failedRequests).toEqual([]);
  });

  test("releases a callback ref when its reactive scope is disposed", async ({ page }) => {
    const { consoleErrors, failedRequests, pageErrors, view } = await loadFixture(page);

    await expect(view.locator("#ref-target-text")).toHaveCount(1);

    const attached = await probeCall<RefEvent[]>(view, "refEvents");
    expect(attached).toEqual([
      { kind: "attach", label: "callback", tag: "x-text", id: null },
    ]);

    // The ref sits inside a conditional subtree, so removing that subtree is
    // what disposes the scope that created the element.
    await probeCall<void>(view, "setRefTargets", false);

    await expect(view.locator("#ref-target-text")).toHaveCount(0);
    await expect.poll(async () =>
      (await probeCall<RefEvent[]>(view, "refEvents")).map(event => event.kind)
    ).toEqual(["attach", "detach"]);

    // A ref is not an attribute: it must not have been written onto the element.
    const target = await probeCall<ElementSnapshot>(view, "snapshot", "ref-object-target");
    expect(target?.attributeNames).not.toContain("ref");
    expect(target?.attributes).not.toHaveProperty("ref");

    expect(pageErrors).toEqual([]);
    expect(consoleErrors).toEqual([]);
    expect(failedRequests).toEqual([]);
  });

  test("re-attaches a ref when its element is created again", async ({ page }) => {
    const { consoleErrors, failedRequests, pageErrors, view } = await loadFixture(page);

    await probeCall<void>(view, "setRefTargets", false);
    await expect(view.locator("#ref-target-text")).toHaveCount(0);

    await probeCall<void>(view, "clearRefEvents");
    await probeCall<void>(view, "setRefTargets", true);
    await expect(view.locator("#ref-target-text")).toHaveCount(1);

    // The Solid JSX transform emits the ref binding before the element's props,
    // so the element has no id yet at the moment the ref receives it.
    expect(await probeCall<RefEvent[]>(view, "refEvents")).toEqual([
      { kind: "attach", label: "callback", tag: "x-text", id: null },
    ]);
    const target = await probeCall<ElementSnapshot>(view, "snapshot", "ref-target-text");
    expect(target?.attributes.id).toBe("ref-target-text");
    // A ref is not an attribute: it must not have been written onto the element.
    expect(target?.attributeNames).not.toContain("ref");
    expect(target?.attributes).not.toHaveProperty("ref");

    expect(pageErrors).toEqual([]);
    expect(consoleErrors).toEqual([]);
    expect(failedRequests).toEqual([]);
  });
});

/**
 * `__SetCSSId` is part of web-core's `ElementPAPIs` surface, so the web host can
 * assign a compiled CSS id. Its effect is a stylesheet the Lynx toolchain put in
 * the bundle, which this fixture does not carry, so what is asserted here is the
 * Element PAPI contract the renderer drives: one call, carrying the root's own
 * page children and the requested id.
 */
test.describe("root-scoped CSS ids in the web runtime", () => {
  test("assigns the id to the root's page children in one call", async ({ page }) => {
    const { consoleErrors, failedRequests, pageErrors, view } = await loadFixture(page);

    expect(await probeCall<CSSIdCall[]>(view, "cssIdCalls")).toEqual([]);

    await probeCall<void>(view, "setCSSId", 0, "main");

    const calls = await probeCall<CSSIdCall[]>(view, "cssIdCalls");
    expect(calls).toHaveLength(1);
    expect(calls[0]!.cssId).toBe(0);
    expect(calls[0]!.entryName).toBe("main");
    // The root owns exactly the element it rendered into its page.
    expect(calls[0]!.elementIds).toEqual(["app"]);
    expect(calls[0]!.uniqueIds.every(uniqueId => uniqueId > 0)).toBe(true);

    // Assigning an id must not disturb the tree it was assigned to.
    await expect(view.locator("#app")).toHaveCount(1);
    await expect(view.locator("#counter")).toHaveCount(1);
    await expect(view.locator("#count")).toHaveText("Counter: 0");

    expect(pageErrors).toEqual([]);
    expect(consoleErrors).toEqual([]);
    expect(failedRequests).toEqual([]);
  });

  test("replaces a previously assigned id and applies it to later elements", async ({ page }) => {
    const { consoleErrors, failedRequests, pageErrors, view } = await loadFixture(page);

    await probeCall<void>(view, "setCSSId", 0, "main");
    await probeCall<void>(view, "setCSSId", 0, "detail");

    const calls = await probeCall<CSSIdCall[]>(view, "cssIdCalls");
    expect(calls.map(call => call.entryName)).toEqual(["main", "detail"]);
    expect(calls.every(call => call.elementIds.includes("app"))).toBe(true);

    // An element the root puts in its page after the id was assigned belongs to
    // the same stylesheet, so it has to be assigned the id as well.
    await probeCall<void>(view, "appendRootChild");
    await expect(view.locator("#root-child-1")).toHaveCount(1);

    const afterAppend = await probeCall<CSSIdCall[]>(view, "cssIdCalls");
    expect(afterAppend).toHaveLength(3);
    expect(afterAppend[2]).toMatchObject({
      cssId: 0,
      entryName: "detail",
      elementIds: ["root-child-1"],
    });

    expect(pageErrors).toEqual([]);
    expect(consoleErrors).toEqual([]);
    expect(failedRequests).toEqual([]);
  });

  test("forwards a null id and leaves the tree intact", async ({ page }) => {
    const { consoleErrors, failedRequests, pageErrors, view } = await loadFixture(page);

    await probeCall<void>(view, "setCSSId", 0, "main");
    await probeCall<void>(view, "setCSSId", null);

    const calls = await probeCall<CSSIdCall[]>(view, "cssIdCalls");
    expect(calls).toHaveLength(2);
    // Resolution of `null` belongs to the host, so the renderer sends it through.
    expect(calls[1]!.cssId).toBeNull();

    await expect(view.locator("#app")).toHaveCount(1);
    await expect(view.locator("#count")).toHaveText("Counter: 0");

    expect(pageErrors).toEqual([]);
    expect(consoleErrors).toEqual([]);
    expect(failedRequests).toEqual([]);
  });

  test("keeps a second root's elements out of the first root's assignment", async ({ page }) => {
    const { consoleErrors, failedRequests, pageErrors, view } = await loadFixture(page);

    await probeCall<void>(view, "mountSecondaryRoot");
    await expect(view.locator("#secondary")).toHaveCount(1);

    await probeCall<void>(view, "setCSSId", 0, "main");

    const calls = await probeCall<CSSIdCall[]>(view, "cssIdCalls");
    expect(calls).toHaveLength(1);
    // The secondary root renders into its own component, so it is not one of the
    // primary root's page children and must not be restyled by it.
    expect(calls[0]!.elementIds).toEqual(["app"]);

    expect(pageErrors).toEqual([]);
    expect(consoleErrors).toEqual([]);
    expect(failedRequests).toEqual([]);
  });
});
