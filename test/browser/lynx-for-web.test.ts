import { expect, test, type Locator, type Page, type Response } from "@playwright/test";

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
  expect(pageErrors, diagnostics()).toEqual([]);
  expect(consoleErrors, diagnostics()).toEqual([]);
  expect(failedRequests, diagnostics()).toEqual([]);

  const count = view.locator("#count");
  await expect(count).toHaveText("Counter: 0");
  await expect(view.locator("#status")).toBeAttached();

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

  test("unmounts the Solid app when #dispose is clicked", async ({ page }) => {
    const { consoleErrors, failedRequests, pageErrors, view } = await loadFixture(page);

    await view.locator("#dispose").click();
    await expect(view.locator("#count")).toHaveCount(0);
    await expect(view.locator("#dispose")).toHaveCount(0);

    expect(pageErrors).toEqual([]);
    expect(consoleErrors).toEqual([]);
    expect(failedRequests).toEqual([]);
  });
});
