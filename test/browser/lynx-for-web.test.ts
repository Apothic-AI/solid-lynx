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
  page.on("response", response => responses.push(response));
  page.on("pageerror", error => pageErrors.push(error.message));
  page.on("console", message => {
    if (message.type() === "error") consoleErrors.push(message.text());
  });
  page.on("worker", worker => {
    worker.on("console", message => {
      if (message.type() === "error") {
        consoleErrors.push(`Worker ${worker.url()}: ${message.text()}`);
      }
    });
  });
  page.on("requestfailed", request => {
    failedRequests.push(
      `${request.method()} ${request.url()}: ${request.failure()?.errorText ?? "unknown failure"}`,
    );
  });

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

  const diagnostics = () => [
    `Page errors:\n${pageErrors.length > 0 ? pageErrors.join("\n") : "(none)"}`,
    `Console errors:\n${consoleErrors.length > 0 ? consoleErrors.join("\n") : "(none)"}`,
    `Failed requests:\n${failedRequests.length > 0 ? failedRequests.join("\n") : "(none)"}`,
  ].join("\n\n");
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
      `Timed out waiting for the Lynx web bundle response at ${resolvedBundleUrl}.\n\n${diagnostics()}`,
      { cause: error },
    );
  }

  const bundleResponse = findBundleResponse();
  expect(bundleResponse, `expected a response for ${resolvedBundleUrl}\n\n${diagnostics()}`)
    .toBeDefined();
  expect(bundleResponse!.ok(), `bundle request failed: ${resolvedBundleUrl}\n\n${diagnostics()}`)
    .toBe(true);
  expect(await bundleResponse!.finished(), `bundle transfer failed: ${resolvedBundleUrl}\n\n${diagnostics()}`)
    .toBeNull();

  const viewState = () => view.evaluate(element => {
    const shadowRoot = element.shadowRoot;
    const iframe = shadowRoot?.querySelector("iframe");
    const frameWindow = iframe?.contentWindow as
      | (Window & { __SOLID_LYNX_PROBE__?: unknown })
      | null
      | undefined;
    return {
      renderedCount: shadowRoot?.querySelector("#count")?.textContent ?? null,
      shadowChildren: Array.from(shadowRoot?.children ?? []).map(child => child.tagName.toLowerCase()),
      iframeCount: shadowRoot?.querySelectorAll("iframe").length ?? 0,
      probeInstalled: Boolean(frameWindow?.__SOLID_LYNX_PROBE__),
    };
  });
  const renderState = async () => {
    if (pageErrors.length > 0 || consoleErrors.length > 0 || failedRequests.length > 0) {
      return "error";
    }
    return (await viewState()).renderedCount === "Counter: 0" ? "ready" : "waiting";
  };
  // The first page load of a run pays for Vite's cold dependency optimization
  // and the Lynx wasm start-up, and the view can come up with its main-thread
  // realm still empty. Reload once and wait again before calling that a failure,
  // so a slow cold start is not reported as a rendering regression.
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
          `Timed out waiting for rendered Lynx content after ${resolvedBundleUrl} responded.\n\n${diagnostics()}\n\nView state:\n${JSON.stringify(state, null, 2)}`,
          { cause: error },
        );
      }
    }
  }

  expect(pageErrors, diagnostics()).toEqual([]);
  expect(consoleErrors, diagnostics()).toEqual([]);
  expect(failedRequests, diagnostics()).toEqual([]);

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
