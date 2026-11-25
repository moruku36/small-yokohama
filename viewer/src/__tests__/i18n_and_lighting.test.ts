import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { computeYokohamaSun, type VehicleSnapshot } from "@small-yokohama/core";
import { resolveVehiclesForFrame } from "../data/vehicleFeed.js";
import {
  formatAddress,
  formatCategory,
  formatTimeStatusText,
  getDict,
} from "../i18n.js";
import {
  SKY_PRESETS,
  computeSkyGrade,
  getSkyPresetsForDate,
  getSunDateForHourJst,
  isNightAltitude,
} from "../viewer/skyLighting.js";

const JA_REGEX = /[\u3040-\u30ff\u3400-\u9fff]/;

describe("Sky grading, EN localization, and favicons", () => {
  it("computes multiplicative sky grades across day, golden hour, dusk, and night", () => {
    const daySun = computeYokohamaSun(getSunDateForHourJst(SKY_PRESETS.day));
    const goldenSun = computeYokohamaSun(getSunDateForHourJst(SKY_PRESETS.golden));
    const duskSun = computeYokohamaSun(getSunDateForHourJst(SKY_PRESETS.dusk));
    const nightSun = computeYokohamaSun(getSunDateForHourJst(SKY_PRESETS.night));

    expect(isNightAltitude(daySun.altitudeDeg)).toBe(false);
    expect(isNightAltitude(goldenSun.altitudeDeg)).toBe(false);
    expect(isNightAltitude(nightSun.altitudeDeg)).toBe(true);

    const day = computeSkyGrade(daySun.altitudeDeg);
    expect(day.matrixRgb[0]).toBeCloseTo(1, 3);
    expect(day.matrixRgb[1]).toBeCloseTo(1, 3);
    expect(day.matrixRgb[2]).toBeCloseTo(1, 3);
    expect(day.nightLights).toBe(0);

    const golden = computeSkyGrade(goldenSun.altitudeDeg);
    expect(golden.matrixRgb[0]).toBeGreaterThan(golden.matrixRgb[2]);
    expect(golden.glowRgba[3]).toBeGreaterThan(0.05);

    const dusk = computeSkyGrade(duskSun.altitudeDeg);
    expect(dusk.nightLights).toBeGreaterThan(0.2);

    const night = computeSkyGrade(nightSun.altitudeDeg);
    expect(night.matrixRgb[0]).toBeLessThan(0.35);
    expect(night.matrixRgb[1]).toBeLessThan(0.4);
    expect(night.matrixRgb[2]).toBeLessThan(0.55);
    expect(night.nightLights).toBeGreaterThan(0.9);
    expect(night.multiplyOpacity).toBeGreaterThan(0.7);
  });

  it("uses real JST dates for live clock, seasonal sky presets, and 00:xx midnight formatting", () => {
    const wedNow = new Date("2026-11-25T03:00:00Z"); // 12:00 JST Wed
    expect(getSunDateForHourJst(null, wedNow)).toBe(wedNow);

    const presetDate = getSunDateForHourJst(10.5, wedNow);
    expect(presetDate.toISOString()).toBe("2026-11-25T01:30:00.000Z");
    expect(formatTimeStatusText(presetDate, "ja")).toBe("水曜 10:30");

    const midnightWed = new Date("2026-11-24T15:05:00Z"); // 2026-11-25 00:05 JST
    expect(formatTimeStatusText(midnightWed, "ja")).toBe("水曜 00:05");

    for (const refDate of [wedNow, new Date("2026-06-21T03:00:00Z")]) {
      const presets = getSkyPresetsForDate(refDate);
      const goldenSun = computeYokohamaSun(getSunDateForHourJst(presets.golden, refDate));
      const goldenGrade = computeSkyGrade(goldenSun.altitudeDeg);
      expect(goldenGrade.matrixRgb[0]).toBeGreaterThan(goldenGrade.matrixRgb[2]);
      expect(goldenGrade.glowRgba[3]).toBeGreaterThan(0.05);

      const duskSun = computeYokohamaSun(getSunDateForHourJst(presets.dusk, refDate));
      const duskGrade = computeSkyGrade(duskSun.altitudeDeg);
      expect(duskGrade.nightLights).toBeGreaterThan(0.2);
    }
  });

  it("formats categories and Japanese Yokohama addresses cleanly in EN", () => {
    expect(formatCategory("bicycle_rental", "en")).toBe("Bike Share");
    expect(formatCategory("variety_store", "en")).toBe("Variety Store");
    expect(formatCategory("pier", "ja")).toBe("埠頭・客船ターミナル");

    const enAddr = formatAddress("神奈川県横浜市中区新港二丁目21", "en");
    expect(JA_REGEX.test(enAddr)).toBe(false);
    expect(enAddr).toContain("Naka-ku, Yokohama, Kanagawa");
    expect(enAddr).toContain("Shinko");

    const dEn = getDict("en");
    expect(JA_REGEX.test(dEn.pageTitle)).toBe(false);
    expect(JA_REGEX.test(dEn.aboutLead)).toBe(false);
  });

  it("ensures zero Japanese characters remain in EN fields of landmarks.json and features.json", () => {
    const releaseDir = path.resolve(
      __dirname,
      "../../public/releases/full-yokohama-v1",
    );
    const lmPayload = JSON.parse(
      fs.readFileSync(path.join(releaseDir, "landmarks.json"), "utf8"),
    ) as {
      landmarks: Array<{ id: string; nameEn: string; descriptionEn: string }>;
      pois: Array<{ id: string; nameEn: string; descriptionEn: string }>;
    };
    const features = JSON.parse(
      fs.readFileSync(path.join(releaseDir, "features.json"), "utf8"),
    ) as Array<{ featureId: number; nameEn?: string }>;

    for (const lm of lmPayload.landmarks) {
      expect(JA_REGEX.test(lm.nameEn), `landmark ${lm.id} nameEn=${lm.nameEn}`).toBe(false);
      expect(JA_REGEX.test(lm.descriptionEn), `landmark ${lm.id} descEn=${lm.descriptionEn}`).toBe(false);
    }
    for (const poi of lmPayload.pois) {
      expect(JA_REGEX.test(poi.nameEn), `poi ${poi.id} nameEn=${poi.nameEn}`).toBe(false);
      expect(JA_REGEX.test(poi.descriptionEn), `poi ${poi.id} descEn=${poi.descriptionEn}`).toBe(false);
    }
    for (const feat of features) {
      if (feat.nameEn) {
        expect(JA_REGEX.test(feat.nameEn), `feature ${feat.featureId} nameEn=${feat.nameEn}`).toBe(false);
      }
    }
  });

  it("includes generated favicon and web manifest assets in viewer/public", () => {
    const publicDir = path.resolve(__dirname, "../../public");
    for (const file of [
      "favicon.ico",
      "favicon.svg",
      "favicon-32x32.png",
      "apple-touch-icon.png",
      "icon-192.png",
      "icon-512.png",
      "site.webmanifest",
    ]) {
      const fullPath = path.join(publicDir, file);
      expect(fs.existsSync(fullPath), `Missing ${file}`).toBe(true);
      expect(fs.statSync(fullPath).size, `Empty ${file}`).toBeGreaterThan(50);
    }
  });

  it("provides a lively multi-route bus & animated ship fleet in full-yokohama-v1 fixtures with 0 JA leaks in EN", () => {
    const fixDir = path.resolve(
      __dirname,
      "../../public/releases/full-yokohama-v1/fixtures",
    );
    for (const fname of [
      "synthetic-bayside-blue.json",
      "scheduled-bayside-blue.json",
    ]) {
      const preset = fname.startsWith("synthetic") ? "synthetic" : "scheduled";
      const snap = JSON.parse(
        fs.readFileSync(path.join(fixDir, fname), "utf8"),
      ) as VehicleSnapshot;

      expect(snap.vehicles.length).toBeGreaterThanOrEqual(20);
      expect(snap.portCalls?.length ?? 0).toBeGreaterThanOrEqual(12);

      const routeIds = new Set(snap.vehicles.map((v) => v.routeId));
      expect(routeIds.has("bayside-blue")).toBe(true);
      expect(routeIds.has("akai-kutsu")).toBe(true);
      expect(routeIds.has("pier-line")).toBe(true);
      expect([...routeIds].some((r) => r.startsWith("city-bus-"))).toBe(true);

      for (const v of snap.vehicles) {
        expect(JA_REGEX.test(v.routeLabelEn), `${fname} ${v.entityId} routeLabelEn`).toBe(false);
        expect(JA_REGEX.test(v.directionLabelEn), `${fname} ${v.entityId} dirEn`).toBe(false);
      }
      for (const pc of snap.portCalls ?? []) {
        expect(JA_REGEX.test(pc.vesselNameEn), `${fname} ${pc.id} vesselEn`).toBe(false);
        expect(JA_REGEX.test(pc.berthEn), `${fname} ${pc.id} berthEn`).toBe(false);
        expect(JA_REGEX.test(pc.source), `${fname} ${pc.id} source`).toBe(false);
      }

      const f0 = resolveVehiclesForFrame(snap, preset, 0);
      const f12 = resolveVehiclesForFrame(snap, preset, 12);
      expect(f0.vehicles.length).toBe(snap.vehicles.length);

      let movedBuses = 0;
      for (let i = 0; i < f0.vehicles.length; i++) {
        const a = f0.vehicles[i]!.record;
        const b = f12.vehicles[i]!.record;
        if (Math.hypot(b.lon - a.lon, b.lat - a.lat) > 1e-5) movedBuses++;
      }
      expect(movedBuses).toBeGreaterThanOrEqual(18);

      let movedBoats = 0;
      for (let i = 0; i < f0.portCalls.length; i++) {
        const a = f0.portCalls[i]!;
        const b = f12.portCalls[i]!;
        if (Math.hypot(b.lon - a.lon, b.lat - a.lat) > 1e-5) movedBoats++;
      }
      expect(movedBoats).toBeGreaterThanOrEqual(10);
    }
  });
});
