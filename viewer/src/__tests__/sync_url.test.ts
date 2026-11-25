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
import {
  RED_BRICK_CENTER_IMG,
  computeDefaultFullMapZoom,
  computeFullMapMaxZoom,
  computeFullMapMinZoom,
  computePinchZoom,
  computeWheelZoomFactor,
} from "../viewer/cameraMath.js";
import { createFullYokohamaCamera } from "@small-yokohama/core";

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

    const dayNow = new Date("2026-11-25T03:30:00Z"); // 12:30 JST
    const nightNow = new Date("2026-11-25T12:30:00Z"); // 21:30 JST

    // Defaults + out-of-bounds clamping
    const defaults = createInitialViewerState(
      cam,
      "",
      false,
      { width: 1280, height: 800 },
      dayNow,
    );
    expect(defaults.theme).toBe("light");
    expect(defaults.sunHourJst).toBeNull();
    expect(defaults.cameraView.zoom).toBe(2.25);

    const nightDefaults = createInitialViewerState(
      cam,
      "",
      false,
      { width: 1280, height: 800 },
      nightNow,
    );
    expect(nightDefaults.theme).toBe("dark");
    expect(nightDefaults.sunHourJst).toBeNull();

    const clamped = createInitialViewerState(cam, "?x=-9999&y=99999&z=999", false);
    expect(clamped.cameraView.centerImgX).toBe(0);
    expect(clamped.cameraView.centerImgY).toBe(cam.imageHeightPx);
    expect(clamped.cameraView.zoom).toBe(16);
  });

  it("keeps mobile pinch-to-zoom direction non-inverted and frames Red Brick cleanly", () => {
    // Spreading fingers increases distance -> zoom increases; pinching closer -> zoom decreases
    expect(computePinchZoom(10, 100, 150, 2, 48)).toBeCloseTo(15, 6);
    expect(computePinchZoom(10, 150, 100, 2, 48)).toBeCloseTo(6.6667, 3);
    // Clamps extreme frame jumps cleanly
    expect(computePinchZoom(40, 100, 250, 2, 48)).toBe(48);
    expect(computePinchZoom(3, 250, 100, 2, 48)).toBe(2);

    // Trackpad pinch wheel (ctrlKey + negative deltaY => zoom IN > 1; positive deltaY => zoom OUT < 1)
    expect(computeWheelZoomFactor(-40, 0, true)).toBeGreaterThan(1);
    expect(computeWheelZoomFactor(40, 0, true)).toBeLessThan(1);

    const fullCam = createFullYokohamaCamera();
    const mobileMin = computeFullMapMinZoom(fullCam, 390, 844);
    const mobileInit = computeDefaultFullMapZoom(fullCam, 390, 844);
    const mobileMax = computeFullMapMaxZoom(fullCam, 390, 844);
    expect(mobileInit).toBeGreaterThan(mobileMin);
    expect(mobileInit).toBeGreaterThan(7);
    expect(mobileInit).toBeLessThan(12);
    expect(mobileMax).toBeGreaterThan(mobileInit);
    expect(mobileMax).toBeLessThanOrEqual(25);
    const mobileVisibleH =
      (fullCam.imageWidthPx / mobileInit) * (844 / 390);
    expect(mobileVisibleH).toBeLessThanOrEqual(fullCam.imageHeightPx);

    const desktopMin = computeFullMapMinZoom(fullCam, 1280, 800);
    const desktopInit = computeDefaultFullMapZoom(fullCam, 1280, 800);
    const desktopMax = computeFullMapMaxZoom(fullCam, 1280, 800);
    expect(desktopInit).toBeGreaterThan(desktopMin);
    expect(desktopInit).toBeGreaterThan(6);
    expect(desktopInit).toBeLessThan(10);
    expect(desktopMax).toBeGreaterThan(desktopInit);
    expect(desktopMax).toBeLessThanOrEqual(25);
    const desktopVisibleH =
      (fullCam.imageWidthPx / desktopInit) * (800 / 1280);
    expect(desktopVisibleH).toBeLessThanOrEqual(fullCam.imageHeightPx);

    const wideDesktopInit = computeDefaultFullMapZoom(fullCam, 1440, 900);
    expect(wideDesktopInit).toBeGreaterThan(6);
    expect(wideDesktopInit).toBeLessThan(10);

    const dayNow = new Date("2026-11-25T03:30:00Z");
    const mobileState = createInitialViewerState(
      fullCam,
      "",
      false,
      {
        width: 390,
        height: 844,
      },
      dayNow,
    );
    expect(mobileState.cameraView.centerImgX).toBe(RED_BRICK_CENTER_IMG.x);
    expect(mobileState.cameraView.centerImgY).toBe(RED_BRICK_CENTER_IMG.y);
    expect(mobileState.cameraView.zoom).toBeCloseTo(mobileInit, 6);
    expect(mobileState.sunHourJst).toBeNull();

    const darkDefault = createInitialViewerState(fullCam, "?theme=dark", false);
    expect(darkDefault.sunHourJst).toBe(20.5);
    const lightDefault = createInitialViewerState(fullCam, "?theme=light", false);
    expect(lightDefault.sunHourJst).toBe(10.5);
  });
});
