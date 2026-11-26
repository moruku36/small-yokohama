import { defineConfig } from "@playwright/test";

const origin = "http://127.0.0.1:4177";

export default defineConfig({
  testDir: "./viewer/e2e",
  use: {
    baseURL: origin,
    browserName: "chromium",
    launchOptions: { args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader"] },
    screenshot: "only-on-failure",
  },
  webServer: {
    command: "node tools/ensure-pilot.mjs && npm --workspace @small-yokohama/viewer run dev -- --host 127.0.0.1 --port 4177 --strictPort",
    url: origin,
    timeout: 120_000,
  },
});
