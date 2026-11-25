import { describe, expect, it } from "vitest";
import { createFullYokohamaCamera, createShinkoPilotCamera } from "@small-yokohama/core";
import { createInitialViewerState, serializeShareUrl } from "../state.js";
import { describePick } from "../ui/HoverTip.js";
import { cloudPaletteForSun } from "../viewer/CloudIntro.js";
import {
  cameraViewToGeoView,
  formatAtParam,
  geoViewToCameraView,
  metersAcrossToZoom,
  parseAtParam,
  zoomToMetersAcross,
} from "../viewer/geoView.js";

describe("Small SF style geographic view links (?at=lat,lon,Nm)", () => {
  const cam = createFullYokohamaCamera();

  it("parses lat,lon,metres and rejects malformed or far-away links", () => {
    expect(parseAtParam("35.4535,139.6430,650m")).toEqual({
      lat: 35.4535,
      lon: 139.643,
      metersAcross: 650,
    });
    expect(parseAtParam("35.4535,139.6430,650")?.metersAcross).toBe(650);
    expect(parseAtParam("35.4535,139.6430")?.metersAcross).toBe(650);
    expect(parseAtParam("35.4535,139.6430,5m")?.metersAcross).toBe(20);
    expect(parseAtParam("35.4535,139.6430,999999m")?.metersAcross).toBe(20000);
    expect(parseAtParam("37.7953,-122.3936,640m")).toBeNull(); // San Francisco
    expect(parseAtParam("abc")).toBeNull();
    expect(parseAtParam(null)).toBeNull();
  });

  it("converts metres across to zoom and back", () => {
    for (const z of [0.8, 3, 12, 60]) {
      expect(metersAcrossToZoom(cam, zoomToMetersAcross(cam, z))).toBeCloseTo(z, 9);
    }
    // the whole drawing at zoom 1
    expect(zoomToMetersAcross(cam, 1)).toBeCloseTo(cam.imageWidthPx * cam.metersPerPixel, 6);
  });

  it("round-trips a camera view through lat/lon within a few image pixels", () => {
    const view = { centerImgX: 5760, centerImgY: 4020, zoom: 9.5 };
    const geo = cameraViewToGeoView(cam, view);
    expect(Math.abs(geo.lat - 35.45)).toBeLessThan(0.1);
    expect(Math.abs(geo.lon - 139.64)).toBeLessThan(0.1);
    const back = geoViewToCameraView(cam, parseAtParam(formatAtParam(geo))!);
    // 5 decimals of a degree is about 1 m, i.e. a few pixels at 0.34 m/px
    expect(Math.abs(back.centerImgX - view.centerImgX)).toBeLessThan(6);
    expect(Math.abs(back.centerImgY - view.centerImgY)).toBeLessThan(6);
    expect(back.zoom / view.zoom).toBeCloseTo(1, 2);
  });

  it("opens on ?at= and writes it back on Share, leaving defaults out", () => {
    const geo = cameraViewToGeoView(cam, { centerImgX: 7000, centerImgY: 3000, zoom: 12 });
    const state = createInitialViewerState(cam, `?at=${formatAtParam(geo)}`, false);
    expect(Math.abs(state.cameraView.centerImgX - 7000)).toBeLessThan(6);
    expect(Math.abs(state.cameraView.centerImgY - 3000)).toBeLessThan(6);
    expect(state.cameraView.zoom).toBeCloseTo(12, 1);

    const url = new URL(serializeShareUrl(state, "https://small-yokohama.example/", cam));
    expect(url.searchParams.get("at")).toMatch(/^35\.\d{5},139\.\d{5},\d+m$/);
    expect(url.searchParams.has("x")).toBe(false);
    expect(url.searchParams.has("lang")).toBe(false);
    expect(url.searchParams.has("v")).toBe(false);
    expect(url.searchParams.has("sun")).toBe(false);

    const reopened = createInitialViewerState(cam, url.search, false);
    expect(Math.abs(reopened.cameraView.centerImgX - state.cameraView.centerImgX)).toBeLessThan(6);
    expect(reopened.cameraView.zoom).toBeCloseTo(state.cameraView.zoom, 1);
  });

  it("still opens older ?x=&y=&z= links", () => {
    const pilot = createShinkoPilotCamera();
    const state = createInitialViewerState(pilot, "?x=2400&y=1700&z=2.8", false);
    expect(state.cameraView).toEqual({ centerImgX: 2400, centerImgY: 1700, zoom: 2.8 });
  });

  it("skips the cloud opening with ?intro=0 or reduced motion", () => {
    expect(createInitialViewerState(cam, "", false).introEnabled).toBe(true);
    expect(createInitialViewerState(cam, "?intro=0", false).introEnabled).toBe(false);
    expect(createInitialViewerState(cam, "", true).introEnabled).toBe(false);
    const s = createInitialViewerState(cam, "", false);
    expect(s.soundOn).toBe(false);
    expect(s.following).toBe(false);
  });
});

describe("Hover tags and cloud colour", () => {
  it("names a landmark and a building under the cursor in both languages", () => {
    const landmark = {
      kind: "landmark" as const,
      landmark: {
        nameJa: "赤レンガ倉庫",
        nameEn: "Red Brick Warehouse",
        category: "landmark",
      } as never,
    };
    expect(describePick(landmark, "ja").title).toBe("赤レンガ倉庫");
    expect(describePick(landmark, "en").title).toBe("Red Brick Warehouse");

    const unnamed = {
      kind: "feature" as const,
      feature: { nameJa: "", nameEn: "", surfaceKind: 2, heightM: 31.4 } as never,
      lon: 139.64,
      lat: 35.45,
    };
    const tip = describePick(unnamed, "en");
    expect(tip.title.length).toBeGreaterThan(0);
    expect(tip.sub).toBe("31 m");
  });

  it("lights day cloud warm and night cloud dim", () => {
    const day = cloudPaletteForSun(40);
    const night = cloudPaletteForSun(-20);
    const sum = (rgb: readonly number[]) => rgb.reduce((a, b) => a + b, 0);
    expect(sum(day.lit)).toBeGreaterThan(sum(night.lit) + 150);
    expect(night.lit[2]).toBeGreaterThan(night.lit[0]); // bluish
  });
});
