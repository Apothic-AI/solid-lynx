import { expect, test, type Locator, type Page } from "@playwright/test";

interface CapabilityFinding {
  capability: string;
  status: "supported" | "host-only" | "unsupported";
  papi: { name: string; present: boolean }[];
  observed: string[];
  today: string;
  requires: string[];
}

interface CapabilityReport {
  label: string;
  findings: CapabilityFinding[];
}

/** What the pattern card measured for the indexed row model on this host. */
interface ListMeasurements {
  hostCallbacksWired: boolean;
  rows: {
    afterCreate: number;
    afterFirstCell: number;
    afterMiddleCell: number;
    afterRepeat: number;
    afterModelChange: number;
    afterDispose: number;
  };
  creates: { firstCell: number; middleCell: number; repeat: number };
  textInListOrder: string[];
  createCalls: number;
  updateCalls: number;
  missingHostBehavior: string;
}

/** What the host's own `update-list-info` request did with the row callbacks. */
interface ListHostDriven {
  inserted: number[];
  removed: number;
  childrenAfterInserts: number;
  textAfterInserts: string[];
  children: number;
  textInListOrder: string[];
  rows: number;
}

/**
 * Calls into the main-thread realm of this `<lynx-view>`.
 *
 * The example publishes its capability report on the realm global, which is the
 * only way to observe PAPI-level behaviour: nothing about a stubbed gesture PAPI
 * or an unwired list callback shows up in the rendered DOM.
 */
async function realmValue<T>(view: Locator, global: string): Promise<T> {
  return view.evaluate(async (element, name) => {
    const shadow = (element as HTMLElement).shadowRoot;
    const frame = shadow?.querySelector("iframe") as
      | (HTMLIFrameElement & { contentWindow: Record<string, any> })
      | null;
    const value = frame?.contentWindow?.[name];
    if (value === undefined) {
      throw new Error(`${name} is not published in this lynx-view realm`);
    }
    return await value;
  }, global);
}

async function capabilities(view: Locator): Promise<CapabilityReport> {
  return realmValue<CapabilityReport>(view, "__SOLID_LYNX_CAPABILITIES__");
}

async function listMeasurements(view: Locator): Promise<ListMeasurements> {
  return realmValue<ListMeasurements>(view, "__SOLID_LYNX_LIST__");
}

/** The host-driven measurement is published as a promise the host settles itself. */
async function hostDrivenList(view: Locator): Promise<ListHostDriven> {
  return realmValue<ListHostDriven>(view, "__SOLID_LYNX_LIST_HOST_DRIVEN__");
}

interface LoadedFixture {
  view: Locator;
  pageErrors: string[];
  consoleErrors: string[];
  failedRequests: string[];
}

/**
 * What the page actually looked like when the card did not render.
 *
 * A bare "never rendered" report is not diagnosable: every candidate cause
 * (custom element not upgraded, no shadow root, empty shadow root, realm never
 * asked to render, or a stale document served by the dev server) looks
 * identical from the assertion's side. These fields separate them.
 */
interface RenderDiagnosis {
  url: string;
  /** Whether the bootstrap script registered the element at all. */
  lynxViewDefined: boolean;
  viewCount: number;
  shadowRootPresent: boolean;
  /** Direct children of the shadow root; the main-thread iframe is one of them. */
  shadowChildren: string[];
  framePresent: boolean;
  /**
   * Whether web-core got as far as creating its page element.
   *
   * `__RenderPage` is only dispatched from `LynxViewInstance.onMTSScriptsLoaded`
   * after the bundle's root chunk has been executed (`LynxViewInstance.js:133-139`),
   * and the page element is what the card renders into. A missing page part means
   * the host pipeline had not finished; a present page part with no content means
   * the card's own render had not finished.
   */
  pagePartPresent: boolean;
  /** Whether the realm the card runs in was created and holds globals. */
  realmReady: boolean;
  /** The exact text the poll was waiting on, or null when the node is absent. */
  formTitle: string | null;
  /** Every `#`-id the shadow root currently shows, to prove partial vs no render. */
  renderedIds: string[];
  readyState: string;
}

/**
 * Reads the failure state without asserting anything.
 *
 * Called only on the error path, so it costs the passing path nothing. Each probe
 * is individually guarded: the document may be mid-navigation, and a diagnostic
 * that throws would replace the real failure with its own.
 */
async function diagnose(page: Page): Promise<RenderDiagnosis | { unavailable: string }> {
  try {
    return await page.evaluate((): RenderDiagnosis => {
      const view = document.querySelector("lynx-view") as
        (HTMLElement & { shadowRoot: ShadowRoot | null }) | null;
      const shadow = view?.shadowRoot ?? null;
      const frame = shadow?.querySelector("iframe") as
        | (HTMLIFrameElement & { contentWindow: Record<string, unknown> | null })
        | null;
      const realm = frame?.contentWindow ?? null;
      const shadowChildren = shadow
        ? [...shadow.children].map(child => child.tagName.toLowerCase())
        : [];
      const ids = shadow
        ? [...shadow.querySelectorAll("[id]")].map(node => node.id).slice(0, 40)
        : [];
      return {
        url: location.href,
        lynxViewDefined: Boolean(customElements.get("lynx-view")),
        viewCount: document.querySelectorAll("lynx-view").length,
        shadowRootPresent: Boolean(shadow),
        shadowChildren,
        framePresent: Boolean(frame),
        pagePartPresent: Boolean(shadow?.querySelector('[part="page"]')),
        // The card publishes its findings during render, so a created realm with
        // no published global means the realm loaded but was never asked to
        // render, which is a different failure from a missing realm.
        realmReady: Boolean(realm && Object.keys(realm).length > 0),
        formTitle: shadow?.querySelector("#form-title")?.textContent ?? null,
        renderedIds: ids,
        readyState: document.readyState,
      };
    });
  } catch (error) {
    return { unavailable: (error as Error).message };
  }
}

/**
 * Loads the pattern card and waits until it has rendered.
 *
 * The first page load of a run pays for Vite's cold dependency optimization and
 * the Lynx wasm start-up, which can leave the main-thread realm empty, so a cold
 * miss is retried once on a reload rather than reported as a rendering failure.
 *
 * Observed 2026-10-25, 12-core host driven to load average ~30 (40 spinners, 3.4x
 * oversubscription), `--repeat-each=8` of the form test: 2 failed, 6 passed. The
 * passing runs took 5.1-6.1 s unloaded but 35.0 s and 35.9 s under that load, and
 * both failures burned the full 2 x 30 s budget. Every failure reported no page
 * error, no console error, no failed request, a fetched bundle, a present shadow
 * root, iframe and realm, and no `[part="page"]` content at all. That is the
 * host pipeline (wasm + decode worker) running out of wall-clock time, not a
 * throw and not a lost readiness signal: nothing in this package or in the
 * fixture gets a chance to fail before the pipeline finishes. The same 8
 * repetitions passed 8/8 at load average ~8-12, 5-6 s per test.
 *
 * The 30 s budget is therefore left as-is: it is 5x the unloaded cost, and
 * inflating it would hide starvation instead of reporting it. The diagnostics
 * below are what make a starved failure say so on its own.
 */
async function loadFixture(page: Page): Promise<LoadedFixture> {
  const pageErrors: string[] = [];
  const consoleErrors: string[] = [];
  const failedRequests: string[] = [];
  page.on("pageerror", error => pageErrors.push(error.message));
  page.on("console", message => {
    if (message.type() === "error") consoleErrors.push(message.text());
  });
  page.on("requestfailed", request => {
    failedRequests.push(`${request.method()} ${request.url()}`);
  });

  const view = page.locator("lynx-view");
  for (let attempt = 1; attempt <= 2; attempt += 1) {
    if (attempt === 1) await page.goto("/");
    else await page.reload();

    await expect(view).toHaveCount(1);
    await expect.poll(() => page.evaluate(() => Boolean(customElements.get("lynx-view"))))
      .toBe(true);
    try {
      await expect
        .poll(() => view.evaluate(element =>
          element.shadowRoot?.querySelector("#form-title")?.textContent ?? null), {
          timeout: 30_000,
          message: `waiting for the pattern card to render (attempt ${attempt} of 2)`,
        })
        .toBe("Form");
      return { view, pageErrors, consoleErrors, failedRequests };
    } catch (error) {
      if (attempt === 2) {
        const diagnosis = await diagnose(page);
        throw new Error(
          `the pattern card never rendered\n\npage errors: ${pageErrors.join("; ") || "none"}`
          + `\nconsole errors: ${consoleErrors.join("; ") || "none"}`
          + `\nfailed requests: ${failedRequests.join("; ") || "none"}`
          + `\npage state: ${JSON.stringify(diagnosis)}`,
          { cause: error },
        );
      }
    }
  }
  throw new Error("unreachable");
}

/** Asserts the page stayed clean, which every test in this suite requires. */
function expectClean(fixture: LoadedFixture): void {
  expect(fixture.pageErrors).toEqual([]);
  expect(fixture.consoleErrors).toEqual([]);
  expect(fixture.failedRequests).toEqual([]);
}

test.describe("solid-lynx patterns", () => {
  test("binds a text field through bindinput and submits through a tap", async ({ page }) => {
    const fixture = await loadFixture(page);
    const { view } = fixture;

    // `<input>` is a web component that wraps a real control in its shadow
    // root, so the fillable element is the inner one.
    const input = view.locator("#field-input input");
    await input.fill("Ada");
    // The echo is driven by the `input` event, so it can only update if that
    // event reached a `bindinput` handler.
    await expect(view.locator("#field-echo")).toHaveText("Echo: Ada");
    // The form is still invalid, so the submit control carries `disabled`.
    await expect(view.locator("#form-submit")).toHaveAttribute("disabled", "disabled");

    await view.locator("#form-agree").click();
    await expect(view.locator("#form-agree")).toContainText("Agreed: yes");
    await expect(view.locator("#form-submit")).not.toHaveAttribute("disabled", /.*/);

    await view.locator("#form-submit").click();
    await expect(view.locator("#form-result")).toHaveText("submitted: Ada");

    // Clearing the required field makes the control invalid again, which the
    // renderer reflects by putting the attribute back.
    // The field's own confirm event is forwarded from the Enter key by the web
    // host, which is the path a native card would use for form submission.
    await input.press("Enter");
    await expect(view.locator("#form-confirm")).toHaveText("confirmed: Ada");

    await input.fill("");
    await expect(view.locator("#field-echo")).toHaveText("Echo: (empty)");
    await expect(view.locator("#form-submit")).toHaveAttribute("disabled", "disabled");

    expectClean(fixture);
  });

  test("keeps keyed rows across insert, remove, and reorder", async ({ page }) => {
    const fixture = await loadFixture(page);
    const { view } = fixture;
    const rows = view.locator("#task-list [id^='task-']");
    const rowIds = () => rows.evaluateAll(elements => elements.map(element => element.id));

    await expect.poll(rowIds).toEqual(["task-1", "task-2", "task-3"]);
    const retained = await Promise.all(["task-2", "task-3"].map(id =>
      view.locator(`#${id}`).elementHandle()));

    await view.locator("#list-add").click();
    await expect.poll(rowIds).toEqual(["task-1", "task-2", "task-3", "task-4"]);
    await expect(view.locator("#list-count")).toHaveText("Rows: 4");

    await view.locator("#list-remove").click();
    await expect.poll(rowIds).toEqual(["task-2", "task-3", "task-4"]);

    await view.locator("#list-reverse").click();
    await expect.poll(rowIds).toEqual(["task-4", "task-3", "task-2"]);
    for (const [index, row] of retained.entries()) {
      expect(await row?.evaluate(element => element.isConnected),
        `task-${index + 2} should be retained`).toBe(true);
    }

    expectClean(fixture);
  });

  test("shows pending, ready, and error states for asynchronous content", async ({ page }) => {
    const fixture = await loadFixture(page);
    const { view } = fixture;

    await expect(view.locator("#async-state")).toHaveText("State: idle");
    await expect(view.locator("#async-pending")).toHaveCount(0);

    // A failed load must be a visible state with a retry, never a silent no-op.
    await view.locator("#async-fail-next").click();
    await view.locator("#async-load").click();
    await expect(view.locator("#async-error")).toHaveCount(1);
    await expect(view.locator("#async-state")).toHaveText("State: error");
    await expect(view.locator("#async-error")).toContainText("Error: load failed");

    // Retry reuses the same handler, and the toggle reset itself, so this load
    // resolves.
    await view.locator("#async-retry").click();
    await expect(view.locator("#async-error")).toHaveCount(0);
    await expect(view.locator("#async-items")).toContainText("0: alpha");
    await expect(view.locator("#async-items")).toContainText("2: charlie");
    await expect(view.locator("#async-state")).toHaveText("State: ready");

    expectClean(fixture);
  });

  test("measures which platform capabilities this host actually offers", async ({ page }) => {
    const fixture = await loadFixture(page);
    const { view } = fixture;

    const report = await capabilities(view);
    expect(report.label).toBe("web-core");
    expect(report.findings.map(finding => finding.capability).sort()).toEqual([
      "animation",
      "css-ids",
      "gestures",
      "list-virtualization",
      "overlay-portal",
      "refs",
      "stylesheet-loading",
    ]);
    for (const finding of report.findings) {
      expect(finding.today, `${finding.capability} must state its failure behaviour`)
        .not.toBe("");
      expect(finding.requires.length, `${finding.capability} must state what support needs`)
        .toBeGreaterThan(0);
    }

    const byName = new Map(report.findings.map(finding => [finding.capability, finding]));

    // The renderer drives the list PAPI itself, so the list callbacks the host
    // stored are the renderer's and the host can ask for a cell by index.
    const list = byName.get("list-virtualization")!;
    expect(list.status).toBe("supported");
    expect(list.papi.every(entry => entry.present)).toBe(true);
    expect(list.observed.join(" ")).toContain("host list callbacks wired on the element: yes");
    expect(list.today).toContain("root.createList()");
    expect(list.requires.join(" ")).toContain("native list support is unverified");
    expect(list.requires.join(" ")).toContain("no recycling has been observed");

    // Both gesture PAPIs exist on this host and neither is reachable, which is
    // why a gesture prop is written as a plain attribute instead of a binding.
    const gestures = byName.get("gestures")!;
    expect(gestures.status).toBe("unsupported");
    expect(gestures.papi.every(entry => entry.present)).toBe(true);
    expect(gestures.observed.join(" ")).toContain("__SetAttribute");
    expect(gestures.observed.join(" ")).not.toContain("__SetGestureDetector");

    // Animation is a real host capability built on the Web Animations API, but
    // nothing in the renderer calls it.
    const animation = byName.get("animation")!;
    expect(animation.status).toBe("host-only");
    expect(animation.papi.find(entry => entry.name === "__ElementAnimate")?.present).toBe(true);
    expect(animation.observed.join(" ")).toContain("element.animate available");

    // Overlays have no renderer contract at all.
    const overlay = byName.get("overlay-portal")!;
    expect(overlay.status).toBe("unsupported");
    expect(overlay.observed.join(" ")).toContain("exports no Portal");

    // Refs hand over the Lynx node and are released with the scope that created
    // the element, which is the deterministic cleanup the renderer owes `ref`.
    const refs = byName.get("refs")!;
    expect(refs.status).toBe("supported");
    expect(refs.observed.join(" ")).toContain("ref while its scope is mounted: held");
    expect(refs.observed.join(" ")).toContain("ref after that scope is disposed: released");

    // CSS ids reach the host's own PAPI, in one batched call.
    const cssIds = byName.get("css-ids")!;
    expect(cssIds.status).toBe("supported");
    expect(cssIds.papi.find(entry => entry.name === "__SetCSSId")?.present).toBe(true);
    expect(cssIds.observed.join(" ")).toContain("PAPI calls while assigning a CSS id: __SetCSSId");
    expect(cssIds.observed.join(" ")).toContain("elements the assignment covered: [1 items]");

    // Stylesheet loading is absent rather than unreachable: there is nothing to
    // call, so this is measured as a negative result on purpose.
    const stylesheets = byName.get("stylesheet-loading")!;
    expect(stylesheets.status).toBe("unsupported");
    expect(stylesheets.observed.join(" ")).toContain("no Element PAPI adds");

    expectClean(fixture);
  });

  test("renders the measured findings into the card", async ({ page }) => {
    const fixture = await loadFixture(page);
    const { view } = fixture;

    await expect(view.locator("#capability-title")).toHaveText("Host capabilities (web-core)");
    await expect(view.locator("#capability-gestures")).toContainText("gestures: unsupported");
    await expect(view.locator("#capability-list-virtualization"))
      .toContainText("list-virtualization: supported");

    expectClean(fixture);
  });
});
test.describe("indexed list model", () => {
  test("materializes the rows the host asks for, keyed and in index order", async ({ page }) => {
    const fixture = await loadFixture(page);
    const { view } = fixture;

    const measured = await listMeasurements(view);

    // web-core stores the pair `__CreateList` was handed on the element, so the
    // host owns row selection and this renderer answers one request at a time.
    expect(measured.hostCallbacksWired).toBe(true);
    expect(measured.createCalls).toBe(1);

    // Asking for cell 4 of 5 builds that one row and nothing else.
    expect(measured.rows.afterCreate).toBe(0);
    expect(measured.rows.afterFirstCell).toBe(1);
    expect(measured.creates.firstCell).toBeGreaterThan(0);

    // Asking for cell 1 leaves the list in index order, not append order: a
    // sparse request cannot treat the index as a position among the rows it
    // happens to have.
    expect(measured.rows.afterMiddleCell).toBe(2);
    expect(measured.creates.middleCell).toBeGreaterThan(0);

    // The same key again keeps its node: no element is created for it.
    expect(measured.rows.afterRepeat).toBe(2);
    expect(measured.creates.repeat).toBe(0);

    expectClean(fixture);
  });

  test("re-installs the callbacks on a model change and releases rows that left", async ({ page }) => {
    const fixture = await loadFixture(page);
    const { view } = fixture;

    const measured = await listMeasurements(view);

    // The model went from five rows to three, and no further host request arrived:
    // the surviving rows moved and their index accessors were reset, so the
    // labels carry the new indices.
    expect(measured.updateCalls).toBeGreaterThanOrEqual(1);
    expect(measured.rows.afterModelChange).toBe(2);
    expect(measured.textInListOrder).toEqual(["beta#0", "epsilon#2"]);

    // Disposal leaves the list element with no rows, and the callbacks inert.
    expect(measured.rows.afterDispose).toBe(0);

    expectClean(fixture);
  });

  test("fails clearly on a host without the list PAPI", async ({ page }) => {
    const fixture = await loadFixture(page);
    const { view } = fixture;

    const measured = await listMeasurements(view);

    expect(measured.missingHostBehavior).toContain("__CreateList");
    expect(measured.missingHostBehavior).not.toContain("no error");

    expectClean(fixture);
  });

  test("serves the host's own update-list-info request", async ({ page }) => {
    const fixture = await loadFixture(page);
    const { view } = fixture;

    // web-core does not call the row callbacks itself: it calls them from the
    // `update-list-info` attribute on the list element, inserting at the
    // requested positions and naming the elements it removes. This is the host's
    // own list request path, driven end to end.
    const driven = await hostDrivenList(view);

    expect(driven.inserted).toEqual([2, 0]);
    expect(driven.removed).toBe(1);
    // The host asked for cells 2 and 0, so those two rows exist in index order.
    expect(driven.childrenAfterInserts).toBe(2);
    expect(driven.textAfterInserts).toEqual(["alpha#0", "gamma#2"]);
    // It then dropped child 1, which is gone from the element tree and from the
    // row model.
    expect(driven.children).toBe(1);
    expect(driven.textInListOrder).toEqual(["alpha#0"]);
    // `enqueueComponent` released the removed row's scope rather than leaving it
    // behind as a dead cell.
    expect(driven.rows).toBe(1);

    expectClean(fixture);
  });
});
