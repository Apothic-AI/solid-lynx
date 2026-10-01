import { expect, test } from "@playwright/test";

test.describe("Lynx for Web host-only smoke", () => {
  test("registers and connects the static lynx-view host", async ({ page }) => {
    await page.goto("/");

    const view = page.locator("lynx-view");
    await expect(view).toHaveCount(1);
    expect(await view.getAttribute("url")).toBeNull();

    await expect.poll(() => page.evaluate(() => Boolean(customElements.get("lynx-view"))))
      .toBe(true);
    await expect.poll(() => view.evaluate(element => {
      const LynxView = customElements.get("lynx-view");
      return LynxView !== undefined && element instanceof LynxView && element.isConnected;
    })).toBe(true);
  });
});
