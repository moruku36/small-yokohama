import { expect, test, type Page } from "@playwright/test";

const dzi = /\/illustrated\.dzi(?:\?|$)/;
const tile = /\/illustrated_files\/\d+\/[^/?]+(?:\?|$)/;
const liveWeather = {
  ok: true,
  fetchedAt: "2026-11-26T03:00:00Z",
  tempC: 17,
  weatherCode: 3,
  precipitationMm: 0,
  windSpeedKmh: 10,
  cloudCover: 80,
  condition: "cloudy",
  rainIntensity: 0,
  labelJa: "曇りの横浜港",
  labelEn: "overcast",
};

const waitForTile = (page: Page) => page.waitForResponse((r) => tile.test(r.url()) && r.ok());

test.beforeEach(async ({ page, baseURL }) => {
  await page.route("**/*", (route) => {
    const url = new URL(route.request().url());
    return url.origin === baseURL ? route.continue() : route.abort();
  });
  await page.route("**/api/*", (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path === "/api/weather") return route.fulfill({ json: liveWeather });
    if (path === "/api/planes") return route.fulfill({ json: { planes: [] } });
    return route.fulfill({ status: 404 });
  });
});

test("opens the drawing, renders the WebGL overlay, and keeps polling weather and feeds", async ({ page }) => {
  await page.addInitScript(() => {
    const drawArrays = WebGL2RenderingContext.prototype.drawArrays;
    WebGL2RenderingContext.prototype.drawArrays = function (...args) {
      if (this.canvas instanceof HTMLCanvasElement && this.canvas.id === "webgl-overlay") {
        this.canvas.dataset.drew = "true";
      }
      return drawArrays.apply(this, args);
    };
  });
  await page.clock.install();
  const pageErrors: Error[] = [];
  page.on("pageerror", (err) => pageErrors.push(err));
  const firstTile = waitForTile(page);
  await page.goto("/?lang=en&sun=12");
  await firstTile;
  await expect(page.locator("#webgl-overlay")).toHaveAttribute("data-drew", "true");
  await expect(page.locator(".cloud-intro")).toHaveCount(0);
  await expect(page.locator("#status")).toContainText("17°C overcast");

  await page.route("**/api/weather", (route) => route.fulfill({ json: { ...liveWeather, tempC: 19 } }));
  const feedPolls = ["buses", "trains", "planes"].map((feed) => page.waitForRequest(`**/api/${feed}`));
  await page.clock.fastForward(600_000);
  await Promise.all(feedPolls);
  await expect(page.locator("#status")).toContainText("19°C overcast");
  expect(pageErrors).toEqual([]);
});

test("draws the map with the sky description while both weather endpoints stall", async ({ page }) => {
  await page.route("**/api/weather", () => {});
  await page.route("https://api.open-meteo.com/**", () => {});
  const requests: string[] = [];
  page.on("request", (req) => requests.push(req.url()));
  const firstTile = waitForTile(page);
  await page.goto("/?lang=en&sun=12&intro=0");

  await firstTile;
  await expect(page.locator("#status")).toContainText("clear over Yokohama Bay");
  const primary = requests.findIndex((url) => url.endsWith("/api/weather"));
  const drawing = requests.findIndex((url) => dzi.test(url));
  expect(primary).toBeGreaterThanOrEqual(0);
  expect(drawing).toBeGreaterThan(primary);

  await expect.poll(() => requests.findIndex((url) => url.startsWith("https://api.open-meteo.com/")), {
    timeout: 12_000,
  }).toBeGreaterThan(drawing);
});

for (const intro of [true, false]) {
  test(`exits the ${intro ? "cloud intro" : "veil"} on an initial DZI 404 and retries after recovery`, async ({ page }) => {
    let restore = false;
    let release404!: () => void;
    const waitFor404 = new Promise<void>((resolve) => { release404 = resolve; });
    await page.route(dzi, async (route) => {
      if (restore) return route.continue();
      await waitFor404;
      return route.fulfill({ status: 404 });
    });
    await page.goto(`/?lang=en${intro ? "" : "&intro=0"}`);
    await expect(page.locator("#status .loading")).toBeVisible();
    await expect(page.locator(intro ? ".cloud-intro" : "#veil")).toBeVisible();
    release404();

    await expect(page.getByRole("alert")).toHaveText("The map could not be loaded.");
    await expect(page.locator("#status .loading")).toHaveCount(0);
    await expect(page.locator(".cloud-intro")).toHaveCount(0);
    await expect(page.locator("#veil")).toBeHidden();
    const retry = page.getByRole("button", { name: "Retry map" });
    await expect(retry).toBeVisible();

    restore = true;
    const retriedDrawing = page.waitForResponse((r) => dzi.test(r.url()) && r.ok());
    const firstTile = waitForTile(page);
    await retry.click();
    expect(new URL((await retriedDrawing).url()).searchParams.has("retry")).toBe(true);
    await firstTile;
    await expect(page.getByRole("alert")).toBeHidden();
    await expect(page.locator("#status")).toContainText("17°C overcast");
  });
}

test("uses the canvas base map and keeps zoom and HTML layer controls without WebGL2", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.addInitScript(() => {
    const original = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function (this: HTMLCanvasElement, type: string, ...args: unknown[]) {
      return type === "webgl2" ? null : Reflect.apply(original, this, [type, ...args]);
    } as typeof original;
    Object.defineProperty(navigator, "clipboard", { value: undefined });
  });
  const pageErrors: Error[] = [];
  page.on("pageerror", (err) => pageErrors.push(err));
  const firstTile = waitForTile(page);
  await page.goto("/?lang=en&sun=12");
  await firstTile;
  await expect(page.locator("#webgl-overlay")).toBeHidden();
  await expect(page.locator("#status")).toContainText("17°C overcast");
  const baseCanvas = page.locator("#osd-container canvas").first();
  await expect.poll(() => baseCanvas.evaluate((canvas: HTMLCanvasElement) => {
    const pixel = canvas.getContext("2d")?.getImageData(canvas.width / 2, canvas.height / 2, 1, 1).data;
    return pixel?.[3];
  })).toBe(255);

  const sharedWidth = async () => {
    await page.locator("#btn-share").click();
    const at = new URL(page.url()).searchParams.get("at");
    return Number.parseFloat(at?.split(",")[2] ?? "");
  };
  const beforeZoom = await sharedWidth();
  await page.locator("#btn-zoom-in").click();
  await expect.poll(sharedWidth).toBeLessThan(beforeZoom);
  await expect(page.locator("#btn-ride")).toBeDisabled();
  await page.getByRole("button", { name: "Layers" }).click();
  await expect(page.locator(".layers-notice")).toContainText("WebGL2 is unavailable");
  await expect(page.locator('[data-toggle="showTraffic"]')).toBeDisabled();
  await expect(page.locator('[data-toggle="showBuses"]')).toBeEnabled();
  await expect(page.locator('[data-toggle="showLabels"]')).toBeEnabled();
  expect(pageErrors).toEqual([]);
});
