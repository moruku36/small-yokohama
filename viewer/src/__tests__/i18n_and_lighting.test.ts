import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import { describe, expect, it } from "vitest";
import {
  SURFACE_KIND,
  computeYokohamaSun,
  createFullYokohamaCamera,
  imageToLocalOnPlane,
  type VehicleSnapshot,
} from "@small-yokohama/core";
import {
  sampleVisibleAmbientCars,
  type AmbientTrafficBundle,
} from "../data/trafficFeed.js";
import { resolveTrainsForFrame, type YokohamaRailBundle } from "../data/trainFeed.js";
import { resolveVehiclesForFrame } from "../data/vehicleFeed.js";
import { resolveWeatherState, type LiveWeatherPayload } from "../data/weatherFeed.js";
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
    expect(day.cssFilter).toBe("");
    expect(day.scrimRgba[3]).toBe(0);
    expect(day.cloudBaseRgb[0]).toBeGreaterThan(200);

    const golden = computeSkyGrade(goldenSun.altitudeDeg);
    expect(golden.matrixRgb[0]).toBeGreaterThan(golden.matrixRgb[2]);
    expect(golden.glowRgba[3]).toBeGreaterThan(0.05);
    expect(golden.nightLights).toBe(0);

    const dusk = computeSkyGrade(duskSun.altitudeDeg);
    expect(dusk.nightLights).toBeGreaterThan(0.2);

    const night = computeSkyGrade(nightSun.altitudeDeg);
    expect(night.matrixRgb[0]).toBeLessThan(0.35);
    expect(night.matrixRgb[1]).toBeLessThan(0.4);
    expect(night.matrixRgb[2]).toBeLessThan(0.55);
    expect(night.nightLights).toBeGreaterThan(0.9);
    expect(night.multiplyOpacity).toBeGreaterThan(0.7);
    expect(night.cssFilter).toContain("brightness(0.3");
    expect(night.cssFilter).toContain("contrast(");
    expect(night.scrimRgba[3]).toBeGreaterThanOrEqual(0.4);
    expect(night.cloudBaseRgb[0]).toBeLessThan(90);
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
      "og-image.jpg",
    ]) {
      const fullPath = path.join(publicDir, file);
      expect(fs.existsSync(fullPath), `Missing ${file}`).toBe(true);
      expect(fs.statSync(fullPath).size, `Empty ${file}`).toBeGreaterThan(50);
    }
    expect(fs.statSync(path.join(publicDir, "og-image.jpg")).size).toBeGreaterThan(10_000);

    const html = fs.readFileSync(path.resolve(__dirname, "../../index.html"), "utf8");
    expect(html).toContain('name="description"');
    expect(html).toContain('property="og:description"');
    expect(html).toContain('property="og:image"');
    expect(html).toContain('name="twitter:card"');
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
        const kfs = snap.keyframes?.[v.entityId] ?? [];
        expect(kfs.length, `${fname} ${v.entityId} kfs`).toBeGreaterThan(8);
        for (let i = 1; i < kfs.length; i++) {
          const stepM = Math.hypot(
            (kfs[i]!.lon - kfs[i - 1]!.lon) * 90700,
            (kfs[i]!.lat - kfs[i - 1]!.lat) * 111000,
          );
          expect(stepM, `${fname} ${v.entityId} step ${i}`).toBeLessThanOrEqual(65);
        }
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

  it("provides 5 OSM rail corridors with moving multi-car trains and city-wide streetlights", () => {
    const fixDir = path.resolve(
      __dirname,
      "../../public/releases/full-yokohama-v1/fixtures",
    );
    const railBundle = JSON.parse(
      fs.readFileSync(path.join(fixDir, "yokohama-trains.json"), "utf8"),
    ) as YokohamaRailBundle;

    const lineIds = railBundle.lines.map((l) => l.id);
    expect(lineIds).toEqual([
      "jr-keihin-tohoku",
      "jr-tokaido",
      "jr-yokosuka",
      "keikyu-main",
      "sotetsu-main",
    ]);

    for (const line of railBundle.lines) {
      expect(JA_REGEX.test(line.lineNameEn), `lineNameEn ${line.id}`).toBe(false);
      expect(JA_REGEX.test(line.operatorEn), `operatorEn ${line.id}`).toBe(false);
      expect(JA_REGEX.test(line.inboundLabelEn), `inboundLabelEn ${line.id}`).toBe(false);
      expect(JA_REGEX.test(line.outboundLabelEn), `outboundLabelEn ${line.id}`).toBe(false);
      for (const st of line.stations) {
        expect(JA_REGEX.test(st.nameEn), `stationEn ${st.id}`).toBe(false);
      }
    }

    const fixedDate = new Date("2026-11-25T03:30:00Z"); // 12:30 JST
    const t0 = resolveTrainsForFrame(railBundle, null, 0, fixedDate);
    const t12 = resolveTrainsForFrame(railBundle, null, 12, fixedDate);
    expect(t0.length).toBeGreaterThanOrEqual(8);
    for (const tr of t0) {
      expect(tr.cars.length).toBeGreaterThanOrEqual(2);
      for (const car of tr.cars) {
        expect(car.elevM).toBeGreaterThanOrEqual(0);
      }
    }

    let movedTrains = 0;
    const t12Map = new Map(t12.map((tr) => [tr.id, tr]));
    for (const a of t0) {
      const b = t12Map.get(a.id);
      if (b && Math.hypot(b.lon - a.lon, b.lat - a.lat) > 1e-5) {
        movedTrains++;
      }
    }
    expect(movedTrains).toBeGreaterThanOrEqual(6);

    const lights = JSON.parse(
      fs.readFileSync(path.join(fixDir, "streetlights.json"), "utf8"),
    ) as { count: number; points: number[] };
    expect(lights.count).toBeGreaterThanOrEqual(500);
    expect(lights.points.length).toBe(lights.count * 4);
  });

  it("enriches Yokohama stations, libraries, universities, HQs, traffic, pedestrians & rain weather", () => {
    const releaseDir = path.resolve(
      __dirname,
      "../../public/releases/full-yokohama-v1",
    );
    const fixDir = path.join(releaseDir, "fixtures");
    const lmPayload = JSON.parse(
      fs.readFileSync(path.join(releaseDir, "landmarks.json"), "utf8"),
    ) as {
      landmarks: Array<{ id: string; nameJa: string; nameEn: string; descriptionEn: string }>;
      pois: Array<{ id: string; nameJa: string; nameEn: string; descriptionEn: string }>;
    };

    const allJa = new Set([
      ...lmPayload.landmarks.map((l) => l.nameJa),
      ...lmPayload.pois.map((p) => p.nameJa),
    ]);
    for (const required of [
      "桜木町駅",
      "関内駅",
      "パシフィコ横浜",
      "横浜市中央図書館",
      "神奈川県立図書館",
      "神奈川大学 みなとみらいキャンパス",
      "京急グループ本社",
      "資生堂グローバルイノベーションセンター (S/PARK)",
      "コーエーテクモゲームス本社",
      "横濱ゲートタワー（いすゞ自動車本社）",
    ]) {
      expect(allJa.has(required), `Missing landmark/HQ: ${required}`).toBe(true);
    }

    const traffic = JSON.parse(
      fs.readFileSync(path.join(fixDir, "ambient-traffic.json"), "utf8"),
    ) as AmbientTrafficBundle;
    expect(traffic.edges?.length ?? 0).toBeGreaterThanOrEqual(500);
    const hasConnectedNext = traffic.edges?.some((e) => e.next.length > 0 && e.endSig.length === 4);
    expect(hasConnectedNext).toBe(true);

    const fullCam = createFullYokohamaCamera();
    const cars0 = sampleVisibleAmbientCars(
      traffic,
      { x: 6000, y: 1800 },
      { x: 11800, y: 4200 },
      0,
      fullCam,
      420,
      8.0,
    );
    const cars6 = sampleVisibleAmbientCars(
      traffic,
      { x: 6000, y: 1800 },
      { x: 11800, y: 4200 },
      6,
      fullCam,
      420,
      8.0,
    );
    expect(cars0.length).toBeGreaterThanOrEqual(30);
    const movedCar = cars0.some(
      (c, i) => cars6[i] && Math.hypot(cars6[i]!.lon - c.lon, cars6[i]!.lat - c.lat) > 1e-5,
    );
    expect(movedCar).toBe(true);

    const rushCars = sampleVisibleAmbientCars(
      traffic,
      { x: 0, y: 0 },
      { x: 15488, y: 5888 },
      2,
      fullCam,
      3000,
      8.0,
    );
    const nightCars = sampleVisibleAmbientCars(
      traffic,
      { x: 0, y: 0 },
      { x: 15488, y: 5888 },
      2,
      fullCam,
      3000,
      3.0,
    );
    expect(rushCars.length).toBeGreaterThan(nightCars.length);

    const peds = JSON.parse(
      fs.readFileSync(path.join(fixDir, "pedestrians.json"), "utf8"),
    ) as { count: number; points: number[] };
    expect(peds.count).toBeGreaterThanOrEqual(1500);
    expect(peds.points.length).toBe(peds.count * 4);

    // Strictly verify ZERO pedestrians land on roadways (depth tile SURFACE_KIND.ROAD = 3) or building interiors
    const decodePng = (buf: Buffer) => {
      let pos = 8, w = 0, h = 0, ct = 0;
      const idat: Buffer[] = [];
      while (pos < buf.length) {
        const len = buf.readUInt32BE(pos);
        const type = buf.subarray(pos + 4, pos + 8).toString("ascii");
        const data = buf.subarray(pos + 8, pos + 8 + len);
        if (type === "IHDR") { w = data.readUInt32BE(0); h = data.readUInt32BE(4); ct = data[9]!; }
        else if (type === "IDAT") idat.push(data);
        else if (type === "IEND") break;
        pos += 12 + len;
      }
      const raw = zlib.inflateSync(Buffer.concat(idat));
      const bpp = ct === 6 ? 4 : 3;
      const stride = w * bpp;
      const out = new Uint8Array(w * h * bpp);
      for (let y = 0; y < h; y++) {
        const f = raw[y * (stride + 1)]!;
        const so = y * (stride + 1) + 1;
        const doff = y * stride;
        for (let x = 0; x < stride; x++) {
          let v = raw[so + x]!;
          const a = x >= bpp ? out[doff + x - bpp]! : 0;
          const b = y > 0 ? out[doff - stride + x]! : 0;
          const c = x >= bpp && y > 0 ? out[doff - stride + x - bpp]! : 0;
          if (f === 1) v = (v + a) & 255;
          else if (f === 2) v = (v + b) & 255;
          else if (f === 3) v = (v + ((a + b) >> 1)) & 255;
          else if (f === 4) {
            const p = a + b - c;
            const pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
            v = (v + (pa <= pb && pa <= pc ? a : pb <= pc ? b : c)) & 255;
          }
          out[doff + x] = v;
        }
      }
      return { w, h, bpp, data: out };
    };
    const { cols, rows, tileSizePx, scale } = fullCam.dataTileGrid;
    const dScale = scale ?? 0.5;
    const depthTiles = new Map<string, { w: number; h: number; bpp: number; data: Uint8Array }>();
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const tileBuf = fs.readFileSync(path.join(releaseDir, "depth", `tile_${c}_${r}.png`));
        depthTiles.set(`${c}_${r}`, decodePng(tileBuf));
      }
    }
    const sampleKind = (px: number, py: number): number => {
      const sx = Math.floor(px * dScale);
      const sy = Math.floor(py * dScale);
      const c = Math.floor(sx / tileSizePx);
      const r = Math.floor(sy / tileSizePx);
      const t = depthTiles.get(`${c}_${r}`);
      if (!t) return -1;
      const lx = sx - c * tileSizePx;
      const ly = sy - r * tileSizePx;
      if (lx < 0 || ly < 0 || lx >= t.w || ly >= t.h) return -1;
      return t.data[(ly * t.w + lx) * t.bpp + 2]!;
    };

    let roadViolations = 0;
    let bldgViolations = 0;
    for (let i = 0; i < peds.points.length; i += 4) {
      const px = peds.points[i]!;
      const py = peds.points[i + 1]!;
      const centerK = sampleKind(px, py);
      if (centerK === SURFACE_KIND.BUILDING) bldgViolations++;
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          if (sampleKind(px + dx / dScale, py + dy / dScale) === SURFACE_KIND.ROAD) {
            roadViolations++;
          }
        }
      }
      // Keep local projection helper imported/verified cleanly
      if (i === 0) {
        const loc = imageToLocalOnPlane(fullCam, px, py, 2.2);
        expect(Number.isFinite(loc[0])).toBe(true);
      }
    }
    expect(roadViolations).toBe(0);
    expect(bldgViolations).toBe(0);

    const makeWeather = (code: number, precip: number, rainInt: number): LiveWeatherPayload => ({
      ok: true,
      fetchedAt: "2026-11-25T16:00:00Z",
      tempC: 13,
      weatherCode: code,
      precipitationMm: precip,
      windSpeedKmh: 16,
      cloudCover: code === 0 ? 10 : 90,
      condition: rainInt > 0 ? "rain" : "clear",
      rainIntensity: rainInt,
      labelJa: rainInt > 0 ? "雨の横浜港" : "晴れの横浜港",
      labelEn: rainInt > 0 ? "raining" : "clear",
    });

    expect(resolveWeatherState("rain", makeWeather(0, 0, 0), "晴天の横浜港", "ja").rainIntensity).toBeGreaterThanOrEqual(0.5);
    expect(resolveWeatherState("live", makeWeather(61, 1.2, 0.56), "晴天の横浜港", "ja").rainIntensity).toBeGreaterThanOrEqual(0.5);
    expect(resolveWeatherState("live", makeWeather(63, 2.0, 0.78), "晴天の横浜港", "ja").rainIntensity).toBeGreaterThanOrEqual(0.5);
    expect(resolveWeatherState("live", makeWeather(80, 1.0, 0.56), "晴天の横浜港", "ja").rainIntensity).toBeGreaterThanOrEqual(0.5);
    expect(resolveWeatherState("live", makeWeather(0, 0, 0), "晴天の横浜港", "ja").rainIntensity).toBe(0);
    expect(resolveWeatherState("clear", makeWeather(63, 2.0, 0.78), "晴天の横浜港", "ja").rainIntensity).toBe(0);
  });
});
