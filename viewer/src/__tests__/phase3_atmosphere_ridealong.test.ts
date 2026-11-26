import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { createFullYokohamaCamera } from "@small-yokohama/core";
import { resolveCosmoClockState } from "../data/cosmoClock.js";
import {
  pickRideAlongCarId,
  resolveRideAlongCar,
  resolveYokohamaDistrict,
  type AmbientTrafficBundle,
} from "../data/trafficFeed.js";
import { resolveWeatherState, type LiveWeatherPayload } from "../data/weatherFeed.js";
import { getDict } from "../i18n.js";
import { createInitialViewerState, serializeShareUrl } from "../state.js";
import { describePick } from "../ui/HoverTip.js";
import {
  COSMO_FRAG,
  COSMO_VERT,
  OVERLAY_FRAG,
  PEDESTRIAN_FRAG,
  PEDESTRIAN_VERT,
} from "../viewer/shaders.js";

const JA_REGEX = /[\u3040-\u30ff\u3400-\u9fff]/;

describe("Phase 3: Ride Along, Cosmo Clock 21, walking umbrellas, water shimmer & harbor fog", () => {
  it("picks and tracks autonomous sensor-pod cars along Yokohama streets for Ride Along", () => {
    const trafficPath = path.resolve(
      __dirname,
      "../../public/releases/full-yokohama-v1/fixtures/ambient-traffic.json",
    );
    const bundle = JSON.parse(fs.readFileSync(trafficPath, "utf8")) as AmbientTrafficBundle;

    const firstId = pickRideAlongCarId(bundle, 0, 12);
    expect(firstId).not.toBeNull();
    const secondId = pickRideAlongCarId(bundle, 0, 12, firstId);
    expect(secondId).not.toBeNull();
    expect(secondId).not.toBe(firstId);

    const startPose = resolveRideAlongCar(bundle, firstId!, 0, 12);
    const movedPose = resolveRideAlongCar(bundle, firstId!, 36, 12);
    expect(startPose).not.toBeNull();
    expect(movedPose).not.toBeNull();
    expect(Math.hypot(movedPose!.lon - startPose!.lon, movedPose!.lat - startPose!.lat)).toBeGreaterThan(
      1e-5,
    );

    expect(JA_REGEX.test(movedPose!.labelEn)).toBe(false);
    expect(JA_REGEX.test(movedPose!.districtEn)).toBe(false);
    expect(JA_REGEX.test(movedPose!.statusEn)).toBe(false);
    expect(resolveYokohamaDistrict(139.639, 35.452).en).toContain("Shinko");
    expect(resolveYokohamaDistrict(139.635, 35.455).en).toBe("Minato Mirai");
  });

  it("computes real JST digital clock digits and illumination modes for Cosmo Clock 21", () => {
    const jstNight = new Date("2026-11-25T11:45:00Z"); // 20:45 JST
    const s0 = resolveCosmoClockState(jstNight, 0, false);
    const s19 = resolveCosmoClockState(jstNight, 19, false);
    const sStatic = resolveCosmoClockState(jstNight, 19, true);

    expect(s0.digits).toEqual([2, 0, 4, 5]);
    expect(s0.timeText).toBe("20:45");
    expect(s0.colonOn).toBe(true);
    expect(s19.colonOn).toBe(false);
    expect(sStatic.colonOn).toBe(true);
    expect(sStatic.wheelAngleRad).toBe(0);
    expect(s19.wheelAngleRad).toBeGreaterThan(0);
    expect(s19.showMode).not.toBe(s0.showMode);
    expect(JA_REGEX.test(s0.showNameEn)).toBe(false);
    expect(JA_REGEX.test(s19.showNameEn)).toBe(false);
  });

  it("supports harbor fog mode and forwards cloud cover and mist intensities", () => {
    const fog = resolveWeatherState("fog", null, "晴天の横浜港", "en");
    expect(fog.mistIntensity).toBeGreaterThanOrEqual(0.8);
    expect(fog.rainIntensity).toBe(0);
    expect(fog.statusText).toBe("harbor fog");
    expect(JA_REGEX.test(fog.statusText)).toBe(false);

    const fogJa = resolveWeatherState("fog", null, "晴天の横浜港", "ja");
    expect(fogJa.statusText).toContain("霧");

    const mistyPayload: LiveWeatherPayload = {
      ok: true,
      fetchedAt: "2026-11-26T00:00:00Z",
      tempC: 12,
      weatherCode: 45,
      precipitationMm: 0,
      windSpeedKmh: 9,
      cloudCover: 88,
      condition: "mist",
      rainIntensity: 0,
      labelJa: "霧の横浜港",
      labelEn: "misty harbor",
    };
    const liveMist = resolveWeatherState("live", mistyPayload, "晴天の横浜港", "en");
    expect(liveMist.cloudCover).toBeCloseTo(0.88, 3);
    expect(liveMist.mistIntensity).toBeGreaterThanOrEqual(0.75);
  });

  it("round-trips fog weather and cosmo=0 share parameters, Ride Along tooltips, shaders & clean EN dict", () => {
    const cam = createFullYokohamaCamera();
    const def = createInitialViewerState(cam, "", false);
    expect(def.showCosmoClock).toBe(true);
    const defUrl = new URL(serializeShareUrl(def, "https://small-yokohama.example/", cam));
    expect(defUrl.searchParams.has("cosmo")).toBe(false);
    expect(defUrl.searchParams.has("weather")).toBe(false);

    const custom = createInitialViewerState(cam, "?weather=fog&cosmo=0", false);
    expect(custom.weatherMode).toBe("fog");
    expect(custom.showCosmoClock).toBe(false);
    const customUrl = serializeShareUrl(custom, "https://small-yokohama.example/", cam);
    expect(customUrl).toContain("weather=fog");
    expect(customUrl).toContain("cosmo=0");

    const sampleCar = {
      carId: 42,
      labelJa: "横浜自動運転カー #142",
      labelEn: "Autonomous Pod #142",
      lon: 139.639,
      lat: 35.452,
      elevM: 2.1,
      bearingDeg: 45,
      speedKmh: 28,
      braking: false,
      signalState: "green" as const,
      districtJa: "新港・赤レンガ倉庫",
      districtEn: "Shinko & Red Brick",
      statusJa: "自動走行中 · 28 km/h",
      statusEn: "Cruising autonomously · 28 km/h",
    };
    const tipEn = describePick({ kind: "ridealong", car: sampleCar }, "en");
    expect(JA_REGEX.test(tipEn.title)).toBe(false);
    expect(JA_REGEX.test(tipEn.sub)).toBe(false);

    expect(JA_REGEX.test(JSON.stringify(getDict("en")))).toBe(false);

    expect(OVERLAY_FRAG).toContain("u_mistIntensity");
    expect(OVERLAY_FRAG).toContain("u_cloudCover");
    expect(OVERLAY_FRAG).toContain("surfaceKind == 1");
    expect(PEDESTRIAN_VERT).toContain("u_simTimeSec");
    expect(PEDESTRIAN_FRAG).toContain("u_rainIntensity");
    expect(COSMO_VERT).toContain("u_centerLocalM");
    expect(COSMO_FRAG).toContain("u_clockDigits");
    expect(COSMO_FRAG).toContain("sevenSegMask");
  });
});
