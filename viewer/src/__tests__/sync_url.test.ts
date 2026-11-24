import { describe, expect, it } from "vitest";
import {
  createShinkoPilotCamera,
  imagePxToNdc,
  wgs84ToImage,
} from "@small-yokohama/core";
import {
  createInitialViewerState,
  serializeShareUrl,
} from "../state.js";

describe("Viewport overlay synchronization & bounded share URLs", () => {
  const cam = createShinkoPilotCamera();

  it("keeps WebGL NDC projection within < 0.5 CSS px (<= 2 CSS px) across zoom and resize", () => {
    const viewConfigs = [
      { tl: { x: 0, y: 0 }, br: { x: 3968, y: 3968 }, w: 1280, h: 800 },
      { tl: { x: 1800, y: 1200 }, br: { x: 2900, y: 2050 }, w: 390, h: 844 },
      { tl: { x: 2200, y: 1500 }, br: { x: 2700, y: 1900 }, w: 1920, h: 1080 },
    ];

    const marker = wgs84ToImage(cam, 139.6394, 35.4531, 6.9);

    for (const cfg of viewConfigs) {
      const expectedCssX =
        ((marker.px - cfg.tl.x) / (cfg.br.x - cfg.tl.x)) * cfg.w;
      const expectedCssY =
        ((marker.py - cfg.tl.y) / (cfg.br.y - cfg.tl.y)) * cfg.h;

      const ndc = imagePxToNdc(marker.px, marker.py, cfg.tl, cfg.br);
      const glCssX = (ndc.x * 0.5 + 0.5) * cfg.w;
      const glCssY = (0.5 - ndc.y * 0.5) * cfg.h;

      const driftPx = Math.hypot(expectedCssX - glCssX, expectedCssY - glCssY);
      expect(driftPx).toBeLessThan(0.5);
    }
  });

  it("round-trips share URL parameters and clamps out-of-bounds viewports", () => {
    const state = createInitialViewerState(
      cam,
      "?lang=en&theme=dark&v=plain&m=scheduled&x=2400&y=1700&z=2.8&sun=17.25&buses=0&labels=0&depth=1&gcp=1&deck=1",
      false,
    );
    expect(state.lang).toBe("en");
    expect(state.theme).toBe("dark");
    expect(state.variant).toBe("plain");
    expect(state.feedPreset).toBe("scheduled");
    expect(state.cameraView).toEqual({ centerImgX: 2400, centerImgY: 1700, zoom: 2.8 });
    expect(state.showBuses).toBe(false);
    expect(state.showBoats).toBe(true);
    expect(state.showLabels).toBe(false);
    expect(state.showDepthMap).toBe(true);
    expect(state.showGcps).toBe(true);
    expect(state.showDeckTestPoint).toBe(true);

    const url = serializeShareUrl(state, "https://small-yokohama.example/");
    const reparsed = createInitialViewerState(cam, new URL(url).search, false);
    expect(reparsed.theme).toBe("dark");
    expect(reparsed.variant).toBe("plain");
    expect(reparsed.feedPreset).toBe("scheduled");
    expect(reparsed.showBuses).toBe(false);
    expect(reparsed.showLabels).toBe(false);
    expect(reparsed.showDeckTestPoint).toBe(true);
    expect(reparsed.cameraView.centerImgX).toBeCloseTo(2400, 1);

    // Defaults + out-of-bounds clamping
    const defaults = createInitialViewerState(cam, "", false);
    expect(defaults.theme).toBe("light");
    expect(defaults.cameraView.zoom).toBe(2.25);

    const clamped = createInitialViewerState(cam, "?x=-9999&y=99999&z=999", false);
    expect(clamped.cameraView.centerImgX).toBe(0);
    expect(clamped.cameraView.centerImgY).toBe(cam.imageHeightPx);
    expect(clamped.cameraView.zoom).toBe(16);
  });
});
