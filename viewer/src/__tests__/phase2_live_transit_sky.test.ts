import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";
import { createFullYokohamaCamera } from "@small-yokohama/core";
import {
  AIR_CABIN_TERMINALS,
  resolveAirCabinForFrame,
} from "../data/airCabinFeed.js";
import {
  classifyPlaneMesh,
  computePlaneDisplayElevM,
  resolvePlanesForFrame,
  type LivePlaneApiPayload,
} from "../data/planeFeed.js";
import {
  isStationSelection,
  resolveStationDepartures,
} from "../data/stationDepartures.js";
import { resolveTrainsForFrame, type YokohamaRailBundle } from "../data/trainFeed.js";
import { resolveVehiclesForFrame } from "../data/vehicleFeed.js";
import { getDict } from "../i18n.js";
import { createInitialViewerState, serializeShareUrl } from "../state.js";
import { describePick } from "../ui/HoverTip.js";

const JA_REGEX = /[\u3040-\u30ff\u3400-\u9fff]/;

function loadCommonJsApi<T>(relPathFromTest: string): T {
  const absPath = path.resolve(__dirname, relPathFromTest);
  const code = fs.readFileSync(absPath, "utf8");
  const mod = { exports: {} as T };
  const cjsRequire = createRequire(absPath);
  const fn = new Function(
    "exports",
    "require",
    "module",
    "__filename",
    "__dirname",
    code,
  );
  fn(mod.exports, cjsRequire, mod, absPath, path.dirname(absPath));
  return mod.exports;
}

const busesHandler = loadCommonJsApi<{
  (req: unknown, res: unknown): Promise<void>;
  decodeGtfsRtVehiclePositions: (buf: Buffer) => Array<{
    rawEntityId: string;
    vehicleLabel: string | null;
    tripId: string | null;
    routeId: string | null;
    directionId: number | null;
    lat: number | null;
    lon: number | null;
    bearingDeg: number | null;
    speedMps: number | null;
    timestampSec: number | null;
  }>;
  classifyYokohamaBusRoute: (routeId: string | null, label: string | null) => {
    routeId: string;
    routeLabelJa: string;
    routeLabelEn: string;
    articulated: boolean;
  };
  normalizeBusPosition: (raw: unknown, nowMs?: number) => {
    entityId: string;
    routeId: string;
    routeLabelEn: string;
    directionLabelEn: string;
    articulated: boolean;
  } | null;
}>("../../../api/buses.js");

const planesHandler = loadCommonJsApi<{
  filterAdsbResponse: (rawJson: unknown, nowMs?: number) => {
    nearbyCount: number;
    planes: Array<{
      icao: string;
      callsign: string;
      altitudeFt: number;
      altitudeM: number;
    }>;
  };
}>("../../../api/planes.js");

function encodeVarint(value: number | bigint): Buffer {
  let v = BigInt(value);
  const bytes: number[] = [];
  do {
    let b = Number(v & 0x7fn);
    v >>= 7n;
    if (v > 0n) b |= 0x80;
    bytes.push(b);
  } while (v > 0n);
  return Buffer.from(bytes);
}

function pbFieldVarint(field: number, value: number | bigint): Buffer {
  return Buffer.concat([encodeVarint((field << 3) | 0), encodeVarint(value)]);
}

function pbFieldBytes(field: number, payload: Buffer | string): Buffer {
  const b = typeof payload === "string" ? Buffer.from(payload, "utf8") : payload;
  return Buffer.concat([encodeVarint((field << 3) | 2), encodeVarint(b.length), b]);
}

function pbFieldFloat32(field: number, val: number): Buffer {
  const out = Buffer.alloc(4);
  out.writeFloatLE(val, 0);
  return Buffer.concat([encodeVarint((field << 3) | 5), out]);
}

describe("Phase 2: Live buses, ADS-B planes, Air Cabin, and station departure boards", () => {
  it("decodes binary GTFS-RT protobuf vehicle positions and falls back gracefully without ODPT token", async () => {
    const nowMs = Date.parse("2026-11-26T09:00:00Z");
    const tsSec = Math.floor(nowMs / 1000) - 12;

    const header = pbFieldVarint(3, tsSec);
    const entInside = pbFieldBytes(
      2,
      Buffer.concat([
        pbFieldBytes(1, "raw-bus-001"),
        pbFieldBytes(
          4,
          Buffer.concat([
            pbFieldBytes(
              1,
              Buffer.concat([
                pbFieldBytes(1, "trip-bb-01"),
                pbFieldBytes(5, "bayside-blue"),
                pbFieldVarint(6, 0),
              ]),
            ),
            pbFieldBytes(
              2,
              Buffer.concat([
                pbFieldFloat32(1, 35.4518),
                pbFieldFloat32(2, 139.6395),
                pbFieldFloat32(3, 125.5),
                pbFieldFloat32(5, 8.4),
              ]),
            ),
            pbFieldVarint(5, tsSec),
            pbFieldBytes(8, pbFieldBytes(2, "ベイサイドブルー")),
          ]),
        ),
      ]),
    );
    const entOutside = pbFieldBytes(
      2,
      Buffer.concat([
        pbFieldBytes(1, "raw-bus-far"),
        pbFieldBytes(
          4,
          Buffer.concat([
            pbFieldBytes(1, pbFieldBytes(5, "26")),
            pbFieldBytes(
              2,
              Buffer.concat([pbFieldFloat32(1, 35.3), pbFieldFloat32(2, 139.5)]),
            ),
            pbFieldVarint(5, tsSec),
          ]),
        ),
      ]),
    );

    const pbBuf = Buffer.concat([pbFieldBytes(1, header), entInside, entOutside]);
    const rawReports = busesHandler.decodeGtfsRtVehiclePositions(pbBuf);
    expect(rawReports.length).toBe(2);
    expect(rawReports[0]!.lat).toBeCloseTo(35.4518, 4);
    expect(rawReports[0]!.lon).toBeCloseTo(139.6395, 4);
    expect(rawReports[0]!.bearingDeg).toBeCloseTo(125.5, 1);

    const normIn = busesHandler.normalizeBusPosition(rawReports[0]!, nowMs);
    const normOut = busesHandler.normalizeBusPosition(rawReports[1]!, nowMs);
    expect(normIn).not.toBeNull();
    expect(normIn!.entityId).toMatch(/^ybus-[0-9a-f]{12}$/);
    expect(normIn!.routeId).toBe("bayside-blue");
    expect(normIn!.articulated).toBe(true);
    expect(JA_REGEX.test(normIn!.routeLabelEn)).toBe(false);
    expect(JA_REGEX.test(normIn!.directionLabelEn)).toBe(false);
    expect(normOut).toBeNull();

    expect(busesHandler.classifyYokohamaBusRoute("271", "あかいくつ").routeId).toBe("akai-kutsu");
    expect(busesHandler.classifyYokohamaBusRoute("280", "ピアライン").routeId).toBe("pier-line");
    expect(busesHandler.classifyYokohamaBusRoute("route-26", "26系統").routeId).toBe("city-bus-26");

    const prevToken = process.env.ODPT_ACCESS_TOKEN;
    delete process.env.ODPT_ACCESS_TOKEN;
    let body = "";
    const headers = new Map<string, string>();
    const res = {
      statusCode: 0,
      setHeader(k: string, v: string) {
        headers.set(k.toLowerCase(), v);
      },
      end(str: string) {
        body = str;
      },
    };
    await busesHandler({}, res);
    if (prevToken !== undefined) process.env.ODPT_ACCESS_TOKEN = prevToken;
    expect(res.statusCode).toBe(200);
    const json = JSON.parse(body) as {
      mode: string;
      fallback: boolean;
      feedHealth: string;
      vehicles: unknown[];
    };
    expect(json.mode).toBe("scheduled");
    expect(json.fallback).toBe(true);
    expect(json.feedHealth).toBe("ok");
    expect(json.vehicles).toEqual([]);
  });

  it("filters live ADS-B aircraft into Yokohama airspace while counting nearby Haneda flights", () => {
    const nowMs = Date.parse("2026-11-26T09:00:00Z");
    const filtered = planesHandler.filterAdsbResponse(
      {
        ac: [
          {
            hex: "840001",
            flight: "ANA647  ",
            t: "A321",
            r: "JA131A",
            lat: 35.453,
            lon: 139.64,
            alt_baro: 4200,
            gs: 210,
            track: 42,
            baro_rate: -640,
            seen_pos: 2,
          },
          {
            hex: "840002",
            flight: "JAL284  ",
            t: "B763",
            lat: 35.515,
            lon: 139.74,
            alt_baro: 1800,
            gs: 165,
            track: 340,
            seen_pos: 1,
          },
          {
            hex: "840003",
            flight: "GND01",
            lat: 35.45,
            lon: 139.635,
            alt_baro: "ground",
            gs: 12,
          },
        ],
      },
      nowMs,
    );
    expect(filtered.nearbyCount).toBe(2);
    expect(filtered.planes.length).toBe(1);
    expect(filtered.planes[0]!.callsign).toBe("ANA647");
    expect(filtered.planes[0]!.altitudeM).toBe(Math.round(4200 * 0.3048));
  });

  it("generates JST-synchronized departure boards across all 16 Yokohama stations with 0 JA leaks in EN", () => {
    const releaseDir = path.resolve(__dirname, "../../public/releases/full-yokohama-v1");
    const railBundle = JSON.parse(
      fs.readFileSync(path.join(releaseDir, "fixtures/yokohama-trains.json"), "utf8"),
    ) as YokohamaRailBundle;
    const lmPayload = JSON.parse(
      fs.readFileSync(path.join(releaseDir, "landmarks.json"), "utf8"),
    ) as {
      landmarks: Array<{ id: string; nameJa: string; nameEn: string; category: string }>;
      pois: Array<{ id: string; nameJa: string; nameEn: string; category: string }>;
    };

    const refDate = new Date("2026-11-25T03:30:00Z"); // 12:30 JST
    const resolvedTrains = resolveTrainsForFrame(railBundle, null, 0, refDate);

    const allStationPois = lmPayload.pois.filter((p) => p.category === "station");
    expect(allStationPois.length).toBeGreaterThanOrEqual(16);

    for (const st of allStationPois) {
      const board = resolveStationDepartures(
        st.id,
        st.nameJa,
        st.nameEn,
        st.category,
        railBundle,
        resolvedTrains,
        0,
        refDate,
      );
      expect(board, `Missing departure board for ${st.id}`).not.toBeNull();
      expect(board!.departures.length, `No departures at ${st.id}`).toBeGreaterThan(0);
      expect(JA_REGEX.test(board!.stationNameEn), `${st.id} stationNameEn`).toBe(false);

      for (let i = 0; i < board!.departures.length; i++) {
        const dep = board!.departures[i]!;
        expect(JA_REGEX.test(dep.lineNameEn), `${st.id} lineNameEn`).toBe(false);
        expect(JA_REGEX.test(dep.destinationEn), `${st.id} destEn`).toBe(false);
        expect(JA_REGEX.test(dep.trainTypeEn), `${st.id} typeEn`).toBe(false);
        if (i > 0) {
          expect(dep.secondsUntil).toBeGreaterThanOrEqual(board!.departures[i - 1]!.secondsUntil);
        }
      }
    }

    const yokoLandmark = lmPayload.landmarks.find((l) => l.id === "lm-yokohama-station")!;
    expect(isStationSelection({ kind: "landmark", landmark: yokoLandmark as never })).toBe(true);
    const yokoBoard = resolveStationDepartures(
      yokoLandmark.id,
      yokoLandmark.nameJa,
      yokoLandmark.nameEn,
      yokoLandmark.category,
      railBundle,
      resolvedTrains.map((tr) =>
        tr.lineId === "jr-keihin-tohoku" ? { ...tr, mode: "observed", delaySec: 180 } : tr,
      ),
      0,
      refDate,
      32,
    )!;
    expect(yokoBoard.hasLiveTelemetry).toBe(true);
    expect(yokoBoard.departures.some((d) => d.lineCode === "JK" && d.delayMin === 3)).toBe(true);
    expect(yokoBoard.departures.some((d) => d.lineCode === "SO" && d.destinationJa === "横浜ゆき")).toBe(false);
  });

  it("simulates 16 circulating YOKOHAMA AIR CABIN gondolas smoothly between Sakuragicho and Unga Park", () => {
    const fixed = new Date("2026-11-26T03:00:00Z");
    const c0 = resolveAirCabinForFrame(0, fixed);
    const c15 = resolveAirCabinForFrame(15, fixed);
    expect(c0.length).toBe(16);
    expect(c0.filter((g) => g.direction === "to-ungapark").length).toBe(8);
    expect(c0.filter((g) => g.direction === "to-sakuragicho").length).toBe(8);

    const minLon = Math.min(AIR_CABIN_TERMINALS.sakuragicho.lon, AIR_CABIN_TERMINALS.ungapark.lon) - 0.0005;
    const maxLon = Math.max(AIR_CABIN_TERMINALS.sakuragicho.lon, AIR_CABIN_TERMINALS.ungapark.lon) + 0.0005;
    for (let i = 0; i < c0.length; i++) {
      const a = c0[i]!;
      const b = c15[i]!;
      expect(a.lon).toBeGreaterThanOrEqual(minLon);
      expect(a.lon).toBeLessThanOrEqual(maxLon);
      expect(a.cableElevM).toBeGreaterThanOrEqual(11);
      expect(a.cableElevM).toBeLessThanOrEqual(38);
      expect(JA_REGEX.test(a.directionEn)).toBe(false);
      expect(JA_REGEX.test(a.sectionEn)).toBe(false);
      expect(Math.hypot(b.lon - a.lon, b.lat - a.lat)).toBeGreaterThan(1e-5);
    }
  });

  it("classifies aircraft, dead-reckons live ADS-B planes, and falls back honestly when empty", () => {
    expect(classifyPlaneMesh("B789", "A5")).toBe("heavyJet");
    expect(classifyPlaneMesh("A321", "A3")).toBe("narrowJet");
    expect(classifyPlaneMesh("EC35", "A7")).toBe("heli");
    expect(computePlaneDisplayElevM(10000, "heavyJet")).toBeLessThanOrEqual(248);
    expect(computePlaneDisplayElevM(200, "heli")).toBeGreaterThanOrEqual(95);

    const baseMs = Date.parse("2026-11-26T09:00:00Z");
    const liveApi: LivePlaneApiPayload = {
      mode: "observed",
      sourceJa: "ADS-B 実測",
      sourceEn: "Live ADS-B Flight Telemetry",
      fetchedAt: new Date(baseMs).toISOString(),
      nearbyCount: 19,
      planes: [
        {
          icao: "840abc",
          callsign: "ANA647",
          registration: "JA131A",
          aircraftType: "B789",
          category: "A5",
          lat: 35.45,
          lon: 139.635,
          altitudeFt: 3000,
          altitudeM: 914,
          groundSpeedKt: 220,
          trackDeg: 45,
          verticalRateFpm: 0,
          seenSec: 0,
          observedAt: new Date(baseMs).toISOString(),
        },
      ],
    };

    const p0 = resolvePlanesForFrame(liveApi, 0, baseMs);
    const p10 = resolvePlanesForFrame(liveApi, 10, baseMs + 10_000);
    expect(p0.length).toBe(1);
    expect(p0[0]!.mode).toBe("observed");
    expect(p0[0]!.meshKind).toBe("heavyJet");
    expect(p10[0]!.lon).toBeGreaterThan(p0[0]!.lon);
    expect(p10[0]!.lat).toBeGreaterThan(p0[0]!.lat);

    const sched = resolvePlanesForFrame(
      {
        mode: "scheduled",
        sourceJa: "羽田",
        sourceEn: "Haneda",
        fetchedAt: new Date(baseMs).toISOString(),
        nearbyCount: 24,
        planes: [],
      },
      0,
      baseMs,
    );
    expect(sched.length).toBe(3);
    for (const p of sched) {
      expect(p.mode).toBe("scheduled");
      expect(p.nearbyCount).toBe(24);
      expect(JA_REGEX.test(p.airlineEn)).toBe(false);
      expect(JA_REGEX.test(p.sourceEn)).toBe(false);
    }
  });

  it("merges live ODPT bus telemetry seamlessly while preserving port calls", () => {
    const baseMs = Date.parse("2026-11-26T09:00:00Z");
    const snap = JSON.parse(
      fs.readFileSync(
        path.resolve(__dirname, "../../public/releases/full-yokohama-v1/fixtures/synthetic-bayside-blue.json"),
        "utf8",
      ),
    );
    const resolved = resolveVehiclesForFrame(snap, "synthetic", 0, baseMs, {
      ...snap,
      mode: "observed",
      fallback: false,
      vehicles: [
        {
          entityId: "ybus-live-001",
          mode: "observed",
          routeId: "bayside-blue",
          routeLabelJa: "ベイサイドブルー",
          routeLabelEn: "Bayside Blue",
          tripId: "t1",
          directionId: 0,
          directionLabelJa: "実測GPS",
          directionLabelEn: "Live GPS Telemetry",
          observedAt: new Date(baseMs - 10_000).toISOString(),
          fetchedAt: new Date(baseMs).toISOString(),
          lon: 139.639,
          lat: 35.452,
          bearingDeg: 90,
          speedMps: 6,
          deckId: "ground-road",
          roadElevationM: 2,
          lengthM: 18,
          widthM: 2.5,
          heightM: 3.3,
          articulated: true,
        },
      ],
    });
    expect(resolved.vehicles.length).toBe(1);
    expect(resolved.vehicles[0]!.displayMode).toBe("observed");
    expect(resolved.portCalls.length).toBeGreaterThanOrEqual(12);
  });

  it("round-trips planes=0 & cabin=0 share params, hover tooltips, and clean EN i18n dictionary", () => {
    const cam = createFullYokohamaCamera();
    const def = createInitialViewerState(cam, "", false);
    expect(def.showPlanes).toBe(true);
    expect(def.showAirCabin).toBe(true);
    const defUrl = new URL(serializeShareUrl(def, "https://small-yokohama.example/", cam));
    expect(defUrl.searchParams.has("planes")).toBe(false);
    expect(defUrl.searchParams.has("cabin")).toBe(false);

    const toggled = createInitialViewerState(cam, "?planes=0&cabin=0", false);
    expect(toggled.showPlanes).toBe(false);
    expect(toggled.showAirCabin).toBe(false);
    const toggledUrl = serializeShareUrl(toggled, "https://small-yokohama.example/", cam);
    expect(toggledUrl).toContain("planes=0");
    expect(toggledUrl).toContain("cabin=0");

    const sched = resolvePlanesForFrame(null, 0, Date.parse("2026-11-26T09:00:00Z"))[0]!;
    expect(JA_REGEX.test(describePick({ kind: "plane", plane: sched }, "en").sub)).toBe(false);

    const cab = resolveAirCabinForFrame(0, new Date("2026-11-26T09:00:00Z"))[0]!;
    expect(JA_REGEX.test(describePick({ kind: "aircabin", cabin: cab }, "en").sub)).toBe(false);

    const enJson = JSON.stringify(getDict("en"));
    expect(JA_REGEX.test(enJson)).toBe(false);
  });
});
