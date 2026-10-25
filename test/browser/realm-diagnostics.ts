/**
 * What a stalled Lynx-for-Web boot looks like, and how to say so.
 *
 * `@lynx-js/web-core` boots a card in stages, and every stage after the
 * `lynx-view` element is upgraded happens somewhere this test process cannot see
 * by default:
 *
 *   1. the `LynxViewInstance` module is imported (dynamic `import()`);
 *   2. its constructor appends a render-blocking stylesheet `link` to the
 *      shadow root;
 *   3. a hidden `about:srcdoc` iframe is created inside that shadow root and
 *      announces itself to the parent with `postMessage("lynx:mtsready")`;
 *   4. a decode worker (spawned by `TemplateManager`) fetches and decodes the
 *      `.web.bundle`, streaming config, style, lepus code and manifest back to
 *      the main thread;
 *   5. the card's main-thread script is appended to the realm's own document and
 *      awaited with no timeout;
 *   6. the card renders into `[part="page"]`, and `lynx-view` switches from
 *      `display: none` to `display: flex`.
 *
 * A stall at stage 3, 4 or 5 raises nothing, logs nothing to the page, and
 * leaves the page's `pageerror` / `console` / `requestfailed` lists empty, so a
 * report built from those lists says "everything is fine" about a view that
 * never booted. Playwright exposes no `pageerror` or `console` event on a
 * `Frame`, so the realm's own exceptions are invisible as well.
 *
 * This module is the shared answer. Both browser suites (`lynx-for-web.test.ts`
 * and `patterns.test.ts`) install the same sinks and report the same story, so a
 * stall in either one is diagnosable from the failure text alone.
 *
 * ## The stall this report was built for
 *
 * A real failure - three GitHub Actions runs on a 2-core runner, both web suites,
 * intermittent - looked like this: the card never rendered, `probeInstalled` was
 * `false`, and page errors, console errors and failed requests were all empty.
 * The realm section showed the realm reachable with nothing thrown in it.
 *
 * The cause was a race inside `@lynx-js/web-core`'s `TemplateManager`, not in this
 * package, the fixture, or the tests: the decode worker's `done` message could
 * overtake the `LynxViewInstance` dynamic import that every section handler
 * awaits. `done` moves the in-flight bundle from `#loadingBundles` to `#bundles`,
 * and the section writers look the bundle up in `#loadingBundles` by url, so a
 * handler that resumed after `done` wrote `lepusCode` into an object nobody read.
 * `onMTSScriptsLoaded` then found no `root` chunk, never called
 * `mtsRealm.loadScript`, and the card's main-thread script was never inserted.
 * Nothing threw, so every page-level list was legitimately empty.
 *
 * That is fixed by `patches/@lynx-js__web-core@0.26.2.patch` (see that file, and
 * `scripts/repro-boot-stall.mjs` for a deterministic reproduction). The report
 * below still names this stage explicitly rather than only saying "no realm
 * content": if the patch ever stops applying, the failure text has to point
 * straight at it instead of sending the next reader back to the beginning.
 * `cardScriptInserted: false` next to `elementApisInstalled: true` and a realm
 * that raised nothing IS that bug, and `phase` says so in words.
 *
 * ## Two findings this report exists to separate
 *
 * - **A zero-size `lynx-view` is not the cause of a stall.** web-core's own CSS
 *   is `display: none` until `__FlushElementTree` appends the page, and
 *   `[height="auto"]` opts the host into `contain: content`. Measured on a
 *   healthy boot, the box is `0x0` and `checkVisibility()` is `false` right up
 *   to the frame in which the card renders, and the realm iframe is created
 *   while the box is still `0x0`. Nothing in web-core gates the realm on
 *   layout: `BoundingClientRectService` and `convertLengthToPx` read a rect only
 *   when the card asks for one, and `createIFrameRealm` never reads one at all.
 *   So a zero box during the wait is the expected state, not a fault -
 *   `viewIsVisible` is reported so a reader does not have to guess that, and it
 *   flips to `true` on the same frame the card appears.
 * - **The realm's failure is not the page's failure.** `exceptions` under a
 *   frame come from a sink installed into that frame's own `globalThis`; a frame
 *   with no sink is reported as uncovered rather than as silent.
 */
import type { Locator, Page, Response } from "@playwright/test";

/** What a realm recorded for itself, written by `installRealmErrorSink`. */
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

/** One worker's message sequence, recorded by `recordWorkerTraffic`. */
interface WorkerTraffic {
  url: string;
  sent: string[];
  received: string[];
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
  const traffic: WorkerTraffic[] = [];
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

/**
 * Installs both sinks before the page navigates.
 *
 * The realm iframe is created after navigation, and a `srcdoc` frame gets a
 * fresh document of its own, so these have to be init scripts rather than
 * injected into the page or into the frame on `frameattached` (where they would
 * race the realm's own scripts).
 */
export async function installRealmSinks(page: Page): Promise<void> {
  await page.addInitScript(installRealmErrorSink, REALM_ERRORS_KEY);
  await page.addInitScript(recordWorkerTraffic, WORKER_TRAFFIC_KEY);
}

/** One frame's answer to "what did you record, and could I ask you at all". */
interface RealmRecord {
  label: string;
  record: RealmErrors | null;
  reachable: boolean;
  failure: string | null;
}

/**
 * What each frame of the page recorded for itself.
 *
 * A frame with no record is one the sink never ran in, and that is reported as
 * such instead of as a frame that raised nothing. Chrome exposes a `srcdoc`
 * child frame to `page.frames()` the moment it is created, which is before the
 * realm's document exists, so an empty record and a missing record are different
 * findings here.
 */
async function readRealmRecords(page: Page): Promise<RealmRecord[]> {
  return Promise.all(page.frames().map(async frame => {
    const label = frame === page.mainFrame() ? "top-level document" : `frame ${frame.url()}`;
    try {
      const record = await frame.evaluate(
        key => (globalThis as unknown as Record<string, unknown>)[key] as RealmErrors | undefined,
        REALM_ERRORS_KEY,
      );
      return { label, record: record ?? null, reachable: true, failure: null };
    } catch (error) {
      // A detached frame throws here. That is a finding about the frame, not
      // about the page's error lists, so it is reported rather than dropped.
      return { label, record: null, reachable: false, failure: (error as Error).message };
    }
  }));
}

/**
 * What `<lynx-view>` looks like right now, on both sides of the realm boundary.
 *
 * `phase` names how far web-core got, in the order it does those steps: async
 * import of `LynxViewInstance` -> stylesheet `<link>` in the shadow root -> a
 * hidden iframe with an `about:srcdoc` document -> the card's main-thread bundle
 * evaluated in that iframe's realm -> the Lynx tree. The first phase that has
 * not happened is what the view was waiting on, and reading it off a stuck view
 * is the difference between "slow" and "stopped".
 */
export interface ViewBootState {
  phase: string;
  /** Text of the marker node the caller waits on, or null when it is absent. */
  markerText: string | null;
  shadowChildren: string[];
  iframeCount: number;
  /**
   * `lynx-view`'s own computed display. `none` is the healthy pre-render state
   * (see the module comment); `flex` means the card flushed its page.
   */
  viewDisplay: string;
  viewBox: { width: number; height: number };
  /** False while the card has not rendered - expected, not a fault. */
  viewIsVisible: boolean;
  /** The realm iframe's document URL (`about:srcdoc`), or null if there is no iframe. */
  realmUrl: string | null;
  /** Whether the realm's own `document` can be read at all from the page. */
  realmReachable: boolean;
  /** Why reading it threw, when it did. */
  realmFailure: string | null;
  /** Every script in the realm's head: web-core's inline bootstrap, then the card's. */
  realmScripts: { src: string; inline: boolean; readyState: string | null }[];
  /** True once the card's own (non-inline) script is in the realm. */
  cardScriptInserted: boolean;
  /**
   * web-core appends a render-blocking stylesheet `link` to the shadow root in
   * `LynxViewInstance`'s constructor, before the card's bundle runs, so a `link`
   * that is present marks that the constructor ran and the next step is the
   * decode worker's. `rules` is how many of its rules loaded: a link whose
   * `sheet` is missing or empty is a stylesheet that never arrived, which is a
   * different fault from a loaded one whose card never ran.
   */
  link: { href: string | null; blocking: string | null; rules: number | null } | null;
  /**
   * Whether the fixture's own PAPI probe is installed in the realm (only the
   * `lynx-for-web` example installs one). False next to a rendered marker is
   * normal for a fixture without a probe; false next to an empty realm is the
   * finding that the card's code never ran.
   */
  probeInstalled: boolean;
  /**
   * Whether web-core installed its element APIs (`__CreatePage`) on the realm.
   *
   * This is the field that separates the two halves of the boot. The APIs are
   * installed by `onPageConfigReady`, which runs from the config section, and
   * the card's script is inserted by `onMTSScriptsLoaded`, which runs from the
   * lepus-code section. `elementApisInstalled: true` with
   * `cardScriptInserted: false` means the config arrived and the lepus code did
   * not - the signature of the `done`-overtakes-the-import race in web-core's
   * `TemplateManager` (see the module comment). Without this field the two
   * halves were indistinguishable from outside.
   */
  elementApisInstalled: boolean;
}

export async function readBootState(view: Locator, markerSelector: string): Promise<ViewBootState> {
  return view.evaluate((element, marker) => {
    const shadowRoot = (element as HTMLElement).shadowRoot;
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
    // `__CreatePage` is installed by onPageConfigReady (the config section) and
    // the card script by onMTSScriptsLoaded (the lepus-code section). Reading
    // both is what tells a boot that got half its sections from one that got
    // none, which is the difference between the TemplateManager race and a
    // realm that never loaded at all.
    const elementApisInstalled = (() => {
      try {
        return typeof (frameWindow as unknown as Record<string, unknown>)?.__CreatePage === "function";
      } catch {
        return false;
      }
    })();
    const markerNode = shadowRoot?.querySelector(marker) ?? null;
    const markerText = markerNode?.textContent ?? null;
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
              : markerNode
                ? `rendered: ${markerText}`
                : elementApisInstalled && !cardScriptInserted
                  // The two halves of the boot disagree: the config section
                  // arrived (the element APIs are installed) and the lepus-code
                  // section did not (the card's script was never appended).
                  // web-core moves a bundle out of #loadingBundles on `done`,
                  // and the section writers look it up there by url, so a
                  // handler that resumes after `done` writes lepusCode into an
                  // object nobody reads. Nothing throws; see
                  // patches/@lynx-js__web-core@0.26.2.patch.
                  ? "web-core installed the realm's element APIs from the config section, but the card's lepus code never reached onMTSScriptsLoaded - the bundle decoded and its lepus payload was lost (TemplateManager #loadingBundles/#bundles race; is the web-core patch applied?)"
                  : probeInstalled
                    ? "card bundle evaluated, no Lynx content in the shadow root yet"
                    : cardScriptInserted
                      ? "the card's main-thread script is in the realm and has not finished loading"
                      : "LynxViewInstance constructed; the card's main-thread script is not in the realm yet",
      markerText,
      shadowChildren: Array.from(shadowRoot?.children ?? []).map(child => child.tagName.toLowerCase()),
      iframeCount: shadowRoot?.querySelectorAll("iframe").length ?? 0,
      // The realm iframe is `display: none` on purpose; the size that matters is
      // `lynx-view`'s own box. Zero width or height is the documented pre-render
      // state, not a cause: see the module comment.
      viewDisplay: getComputedStyle(element).display,
      viewBox: rectOf(element),
      viewIsVisible: element.checkVisibility(),
      realmUrl: iframe ? frameWindow?.location?.href ?? "<no document>" : null,
      realmReachable,
      realmFailure,
      realmScripts,
      cardScriptInserted,
      elementApisInstalled,
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
  }, markerSelector);
}

/**
 * A view's boot, watched over the wait.
 *
 * `trace` keeps every phase the view was seen in with the elapsed milliseconds,
 * so a stall says *where* it stopped and *when* it got there: a phase reached at
 * 200 ms and held for 30 s is a stall, a phase reached at 29 s is a slow step.
 * `viewBoxOverWait` keeps the box sizes seen, so a size that is stable and zero
 * says the page never laid the view out and a size that changes says it was
 * still booting when the wait gave up.
 */
export interface BootProbe {
  /** One poll tick: records the phase and box, and reports readiness. */
  poll(): Promise<"ready" | "waiting" | "error">;
  trace: string[];
  viewBoxOverWait: string[];
  /** The most recent full state, for the failure report. */
  last(): ViewBootState | null;
}

export function createBootProbe(options: {
  view: Locator;
  markerSelector: string;
  /** Whether this state means the card finished rendering. */
  isReady(state: ViewBootState): boolean;
  /** Page-level channels; any entry means the boot failed loudly, not silently. */
  errors(): string[];
}): BootProbe {
  const { view, markerSelector, isReady, errors } = options;
  const started = Date.now();
  const trace: string[] = [];
  const viewBoxOverWait: string[] = [];
  let last: ViewBootState | null = null;

  const record = (entry: string) => {
    if (trace.at(-1)?.replace(/^\+?\d+ms /, "") !== entry) {
      trace.push(`+${Date.now() - started}ms ${entry}`);
    }
  };

  return {
    trace,
    viewBoxOverWait,
    last: () => last,
    async poll() {
      if (errors().length > 0) {
        record("error reported on a page channel");
        return "error";
      }
      const state = await readBootState(view, markerSelector);
      last = state;
      record(state.phase);
      const box = `${state.viewBox.width}x${state.viewBox.height}`;
      if (viewBoxOverWait.at(-1) !== box) viewBoxOverWait.push(box);
      return isReady(state) ? "ready" : "waiting";
    },
  };
}

/** Everything the page-level listeners saw, plus what the page asked the network for. */
export interface PageChannels {
  responses: Response[];
  pageErrors: string[];
  consoleErrors: string[];
  failedRequests: string[];
  workerErrors: string[];
  workersSeen: string[];
  requests: { url: string; resourceType: string }[];
}

/** Attaches the page-level listeners and returns their accumulators. */
export function collectPageChannels(page: Page): PageChannels {
  const channels: PageChannels = {
    responses: [],
    pageErrors: [],
    consoleErrors: [],
    failedRequests: [],
    workerErrors: [],
    workersSeen: [],
    requests: [],
  };
  page.on("response", response => channels.responses.push(response));
  page.on("pageerror", error => channels.pageErrors.push(error.message));
  page.on("console", message => {
    if (message.type() === "error") channels.consoleErrors.push(message.text());
  });
  page.on("request", request => {
    channels.requests.push({ url: request.url(), resourceType: request.resourceType() });
  });
  page.on("worker", worker => {
    // web-core decodes and evaluates the card's bundle in this worker, so it is
    // the next thing that can stop a view between the stylesheet `link` and the
    // card's own code, and it fails without touching the page's error lists.
    channels.workersSeen.push(worker.url());
    worker.on("console", message => {
      if (message.type() === "error") {
        channels.consoleErrors.push(`Worker ${worker.url()}: ${message.text()}`);
        channels.workerErrors.push(`Worker ${worker.url()}: ${message.text()}`);
      }
    });
  });
  page.on("requestfailed", request => {
    channels.failedRequests.push(
      `${request.method()} ${request.url()}: ${request.failure()?.errorText ?? "unknown failure"}`,
    );
  });
  return channels;
}

const list = (entries: string[]) => (entries.length > 0 ? entries.join("\n") : "(none)");

/**
 * Marks the requests a stalled boot is decided by.
 *
 * The realm bootstraps by fetching the Lynx wasm, the web-core modules and the
 * card bundle; on a cold dev-server transform graph any of those can be the
 * thing that did not arrive. Filtering the page's own resource timings keeps
 * that answer attached to the failure instead of requiring a second run.
 */
function isBootResource(url: string): boolean {
  return /\.wasm|\.bundle|web-core|lynx-core|web-elements|decode\.worker|mainthread/i.test(url);
}

/**
 * The full failure report: what the page said, what it fetched, what each worker
 * said, and what each realm recorded for itself.
 */
export async function diagnosticsReport(page: Page, channels: PageChannels): Promise<string> {
  const realms = await readRealmRecords(page);
  const timings = await page.evaluate(() =>
    performance.getEntriesByType("resource").map(entry => ({
      name: entry.name,
      startTime: Math.round(entry.startTime),
      duration: Math.round(entry.duration),
      transferSize: (entry as PerformanceResourceTiming).transferSize,
    })),
  ).catch(() => []);

  return [
    [
      "Page errors (top-level document only - the Lynx realm is reported separately below):",
      list(channels.pageErrors),
    ].join("\n"),
    ["Console errors (top-level document only):", list(channels.consoleErrors)].join("\n"),
    ["Failed requests:", list(channels.failedRequests)].join("\n"),
    [
      "Boot resources the page requested (wasm, web-core modules, card bundle):",
      ...(() => {
        const boot = timings.filter(entry => isBootResource(entry.name));
        if (boot.length === 0) {
          return ["  (none - the page never asked for the realm's own bootstrap assets)"];
        }
        return boot
          .sort((left, right) => left.startTime - right.startTime)
          .map(entry =>
            `  +${entry.startTime}ms ${entry.duration}ms ${entry.transferSize}B`
            + ` ${entry.name.replace(/^https?:\/\/[^/]+/, "")}`,
          );
      })(),
    ].join("\n"),
    [
      "Card bundle workers (web-core decodes and evaluates the bundle here):",
      ...(page.workers().length === 0 && channels.workersSeen.length === 0
        ? ["  (no worker was ever constructed; the bundle was never handed to one)"]
        : [
          ...channels.workersSeen.map(url => `  constructed: ${url}`),
          ...page.workers().map(worker => `  live: ${worker.url()}`),
          ...(channels.workerErrors.length > 0
            ? channels.workerErrors.map(entry => `  error: ${entry}`)
            : ["  (no console.error from a worker)"]),
          ...(await page.evaluate(key => {
            const traffic = (globalThis as unknown as Record<string, unknown>)[key] as
              | WorkerTraffic[]
              | undefined;
            return (traffic ?? []).map(entry =>
              `  messages ${entry.url.split("/").at(-1)}:`
              + ` sent [${entry.sent.join(", ") || "none"}]`
              + ` received [${entry.received.join(", ") || "none"}]`,
            );
          }, WORKER_TRAFFIC_KEY).catch(() => [] as string[])),
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
}

/**
 * The view's boot state plus its history, ready to paste into a failure.
 *
 * `bootTrace` is the part that makes a stall unambiguous: it is the ordered list
 * of phases with the time each was first seen, ending at the phase the view was
 * still in when the wait gave up.
 */
export function bootStateReport(state: ViewBootState, probe: BootProbe): string {
  return JSON.stringify(
    { ...state, bootTrace: probe.trace, viewBoxOverWait: probe.viewBoxOverWait },
    null,
    2,
  );
}

/** Finds the response for an exact URL the fixture expects to be fetched. */
export function findResponse(channels: PageChannels, expected: URL): Response | undefined {
  return channels.responses.find(response => {
    const url = new URL(response.url());
    return url.origin === expected.origin && url.pathname === expected.pathname;
  });
}
