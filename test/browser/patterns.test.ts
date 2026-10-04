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

interface LoadedFixture {
  view: Locator;
  pageErrors: string[];
  consoleErrors: string[];
  failedRequests: string[];
}

/**
 * Loads the pattern card and waits until it has rendered.
 *
 * The first page load of a run pays for Vite's cold dependency optimization and
 * the Lynx wasm start-up, which can leave the main-thread realm empty, so a cold
 * miss is retried once on a reload rather than reported as a rendering failure.
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
        throw new Error(
          `the pattern card never rendered\n\npage errors: ${pageErrors.join("; ") || "none"}`
          + `\nconsole errors: ${consoleErrors.join("; ") || "none"}`
          + `\nfailed requests: ${failedRequests.join("; ") || "none"}`,
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

    // web-core ships the list PAPI and the `x-list` element, but a list only
    // recycles rows when the framework hands it its callbacks, which this
    // renderer cannot do. So `<list>` is a plain container here.
    const list = byName.get("list-virtualization")!;
    expect(list.status).toBe("host-only");
    expect(list.papi.find(entry => entry.name === "__CreateList")?.present).toBe(true);
    expect(list.observed.join(" ")).toContain("host list callbacks wired: no");
    expect(list.today).toContain("ordinary container");

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
      .toContainText("list-virtualization: host-only");

    expectClean(fixture);
  });
});