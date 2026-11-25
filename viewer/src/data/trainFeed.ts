import type { CameraManifest } from "@small-yokohama/core";

export type RailLineId =
  | "jr-keihin-tohoku"
  | "jr-tokaido"
  | "jr-yokosuka"
  | "keikyu-main"
  | "sotetsu-main";

export interface RailTrackPoint {
  lon: number;
  lat: number;
  elevM: number;
  distM: number;
  bearingDeg: number;
}

export interface RailStationStop {
  id: string;
  nameJa: string;
  nameEn: string;
  distM: number;
  lon: number;
  lat: number;
  odptStationId?: string;
}

export interface RailLineTrack {
  id: RailLineId;
  code: string;
  operatorJa: string;
  operatorEn: string;
  lineNameJa: string;
  lineNameEn: string;
  odptRailway: string;
  colorHex: string;
  cars: number;
  carLengthM: number;
  carWidthM: number;
  carHeightM: number;
  speedMps: number;
  headwaySec: number;
  dwellSec: number;
  totalDistM: number;
  inboundLabelJa: string;
  inboundLabelEn: string;
  outboundLabelJa: string;
  outboundLabelEn: string;
  points: RailTrackPoint[];
  stations: RailStationStop[];
}

export interface YokohamaRailBundle {
  schemaVersion: string;
  generatedAt: string;
  lines: RailLineTrack[];
}

export interface LiveTrainRecord {
  id: string;
  lineId: RailLineId;
  railway: string;
  trainNumber: string;
  trainType?: string;
  direction?: string;
  fromStation: string | null;
  toStation: string | null;
  delaySec: number;
  carComposition: number | null;
  destinationStation: string | null;
  observedAt: string | null;
}

export interface LiveTrainApiPayload {
  mode: "observed" | "scheduled";
  sourceJa: string;
  sourceEn: string;
  fetchedAt: string;
  trains: LiveTrainRecord[];
}

export interface ResolvedTrainCar {
  lon: number;
  lat: number;
  elevM: number;
  bearingDeg: number;
  carIndex: number;
  isLead: boolean;
}

export interface ResolvedTrain {
  id: string;
  lineId: RailLineId;
  code: string;
  lineNameJa: string;
  lineNameEn: string;
  operatorJa: string;
  operatorEn: string;
  trainNumber: string;
  trainTypeJa: string;
  trainTypeEn: string;
  directionJa: string;
  directionEn: string;
  nextStopJa: string;
  nextStopEn: string;
  statusJa: string;
  statusEn: string;
  mode: "observed" | "scheduled";
  colorHex: string;
  carCount: number;
  carLengthM: number;
  carWidthM: number;
  carHeightM: number;
  delaySec: number;
  speedKmh: number;
  lon: number;
  lat: number;
  elevM: number;
  bearingDeg: number;
  sourceJa: string;
  sourceEn: string;
  cars: ResolvedTrainCar[];
}

function clamp(v: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, v));
}

function lerpBearing(a: number, b: number, t: number): number {
  const diff = ((((b - a) % 360) + 540) % 360) - 180;
  return (((a + diff * t) % 360) + 360) % 360;
}

export async function loadRailBundle(baseReleaseUrl: string): Promise<{
  railBundle: YokohamaRailBundle | null;
  streetlights: Float32Array | null;
}> {
  const [railRes, lampRes] = await Promise.all([
    fetch(`${baseReleaseUrl}/fixtures/yokohama-trains.json`, { cache: "no-store" }).catch(
      () => null,
    ),
    fetch(`${baseReleaseUrl}/fixtures/streetlights.json`, { cache: "no-store" }).catch(
      () => null,
    ),
  ]);

  let railBundle: YokohamaRailBundle | null = null;
  if (railRes?.ok) {
    try {
      railBundle = (await railRes.json()) as YokohamaRailBundle;
    } catch {
      railBundle = null;
    }
  }

  let streetlights: Float32Array | null = null;
  if (lampRes?.ok) {
    try {
      const json = (await lampRes.json()) as { points?: number[] };
      if (Array.isArray(json.points) && json.points.length >= 4) {
        streetlights = new Float32Array(json.points);
      }
    } catch {
      streetlights = null;
    }
  }

  return { railBundle, streetlights };
}

export async function fetchLiveTrainsApi(): Promise<LiveTrainApiPayload | null> {
  try {
    const res = await fetch("/api/trains", { cache: "no-store" });
    if (!res.ok) return null;
    return (await res.json()) as LiveTrainApiPayload;
  } catch {
    return null;
  }
}

export function sampleLineAtDist(
  line: RailLineTrack,
  rawDistM: number,
  reverse = false,
): { lon: number; lat: number; elevM: number; bearingDeg: number } {
  const pts = line.points;
  if (pts.length === 0) {
    return { lon: 139.6238, lat: 35.4658, elevM: 4, bearingDeg: 0 };
  }
  if (pts.length === 1) {
    const p = pts[0]!;
    return {
      lon: p.lon,
      lat: p.lat,
      elevM: p.elevM,
      bearingDeg: reverse ? (p.bearingDeg + 180) % 360 : p.bearingDeg,
    };
  }

  const d = clamp(rawDistM, 0, line.totalDistM);
  let lo = 0;
  let hi = pts.length - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (pts[mid]!.distM <= d) lo = mid;
    else hi = mid;
  }
  const a = pts[lo]!;
  const b = pts[Math.min(pts.length - 1, lo + 1)]!;
  const span = b.distM - a.distM;
  const f = span > 1e-4 ? clamp((d - a.distM) / span, 0, 1) : 0;
  const bearing = lerpBearing(a.bearingDeg, b.bearingDeg, f);

  return {
    lon: a.lon + (b.lon - a.lon) * f,
    lat: a.lat + (b.lat - a.lat) * f,
    elevM: a.elevM + (b.elevM - a.elevM) * f,
    bearingDeg: reverse ? (bearing + 180) % 360 : bearing,
  };
}

function buildCarConsist(
  line: RailLineTrack,
  centerDistM: number,
  carCount: number,
  reverse: boolean,
): ResolvedTrainCar[] {
  const spacing = line.carLengthM + 1.1;
  const halfSpan = ((carCount - 1) * spacing) * 0.5;
  const cars: ResolvedTrainCar[] = [];

  for (let i = 0; i < carCount; i++) {
    // Car 0 is front (in travel direction), carCount-1 is tail
    const offsetAlongTrack = (halfSpan - i * spacing) * (reverse ? -1 : 1);
    const sample = sampleLineAtDist(line, centerDistM + offsetAlongTrack, reverse);
    cars.push({
      lon: sample.lon,
      lat: sample.lat,
      elevM: sample.elevM,
      bearingDeg: sample.bearingDeg,
      carIndex: i,
      isLead: i === 0 || i === carCount - 1,
    });
  }

  return cars;
}

function getJstSecondsOfDay(date: Date): number {
  const jst = new Date(date.getTime() + 9 * 3600_000);
  return (
    jst.getUTCHours() * 3600 +
    jst.getUTCMinutes() * 60 +
    jst.getUTCSeconds() +
    jst.getUTCMilliseconds() / 1000
  );
}

/**
 * Evaluate progress along a one-way transit corridor with smooth dwells at each interior station stop.
 */
function evaluateScheduledMotion(
  line: RailLineTrack,
  elapsedInTripSec: number,
  tripRunSec: number,
  reverse: boolean,
): { distM: number; dwellingStation: RailStationStop | null; nextStation: RailStationStop | null; speedKmh: number } {
  const interiorStops = line.stations.filter(
    (st) => st.distM > 40 && st.distM < line.totalDistM - 40,
  );
  const stopsOrdered = reverse ? [...interiorStops].reverse() : interiorStops;
  const dwell = Math.min(12, Math.max(4, line.dwellSec));
  const totalDwell = stopsOrdered.length * dwell;
  const moveSec = Math.max(12, tripRunSec - totalDwell);
  const fRaw = clamp(elapsedInTripSec / tripRunSec, 0, 1);

  // Build piecewise-linear timeline: travel segments + brief dwells at interior stations
  let curT = 0;
  let prevFrac = 0;
  const segSpeedKmh = Math.round((line.totalDistM / moveSec) * 3.6);

  for (let i = 0; i < stopsOrdered.length; i++) {
    const st = stopsOrdered[i]!;
    const fracAtStop = reverse
      ? 1 - st.distM / line.totalDistM
      : st.distM / line.totalDistM;
    const travelSec = ((fracAtStop - prevFrac) * moveSec) / tripRunSec;
    if (fRaw <= curT + travelSec) {
      const segT = travelSec > 1e-5 ? clamp((fRaw - curT) / travelSec, 0, 1) : 1;
      const effFrac = prevFrac + (fracAtStop - prevFrac) * segT;
      return {
        distM: (reverse ? 1 - effFrac : effFrac) * line.totalDistM,
        dwellingStation: null,
        nextStation: st,
        speedKmh: segSpeedKmh,
      };
    }
    curT += travelSec;
    const dwellNorm = dwell / tripRunSec;
    if (fRaw <= curT + dwellNorm) {
      return {
        distM: st.distM,
        dwellingStation: st,
        nextStation: stopsOrdered[i + 1] ?? null,
        speedKmh: 0,
      };
    }
    curT += dwellNorm;
    prevFrac = fracAtStop;
  }

  const remNorm = Math.max(1e-5, 1 - curT);
  const endSegT = clamp((fRaw - curT) / remNorm, 0, 1);
  const effFrac = prevFrac + (1 - prevFrac) * endSegT;
  return {
    distM: (reverse ? 1 - effFrac : effFrac) * line.totalDistM,
    dwellingStation: null,
    nextStation: null,
    speedKmh: segSpeedKmh,
  };
}

function findStationDist(line: RailLineTrack, stationUri: string | null): number | null {
  if (!stationUri) return null;
  const short = stationUri.split(".").pop()?.toLowerCase() ?? "";
  for (const st of line.stations) {
    if (st.odptStationId && st.odptStationId === stationUri) return st.distM;
    const cleanEn = st.nameEn.replace(/[^a-zA-Z0-9]/g, "").toLowerCase();
    const cleanUri = short.replace(/[^a-zA-Z0-9]/g, "").toLowerCase();
    if (cleanEn && cleanUri && (cleanUri.includes(cleanEn) || cleanEn.includes(cleanUri))) {
      return st.distM;
    }
  }
  return null;
}

export function resolveTrainsForFrame(
  railBundle: YokohamaRailBundle | null,
  liveApi: LiveTrainApiPayload | null,
  simTimeSec: number,
  nowDate = new Date(),
  _camera?: CameraManifest,
): ResolvedTrain[] {
  if (!railBundle || railBundle.lines.length === 0) {
    return [];
  }

  const out: ResolvedTrain[] = [];
  const linesWithLive = new Set<RailLineId>();
  const wallMs = nowDate.getTime() + simTimeSec * 1000;

  // 1. Live ODPT trains if observed telemetry exists
  if (liveApi?.mode === "observed" && liveApi.trains.length > 0) {
    for (const obs of liveApi.trains) {
      const line = railBundle.lines.find((l) => l.id === obs.lineId);
      if (!line) continue;
      const fromDist = findStationDist(line, obs.fromStation);
      const toDist = findStationDist(line, obs.toStation);
      if (fromDist === null && toDist === null) continue;

      linesWithLive.add(line.id);
      const isAtStation = fromDist !== null && toDist === null;
      let centerDist = fromDist ?? toDist ?? line.totalDistM * 0.5;
      let reverse = (obs.direction ?? "").toLowerCase().includes("inbound");

      if (fromDist !== null && toDist !== null) {
        reverse = toDist < fromDist;
        const obsTs = obs.observedAt ? Date.parse(obs.observedAt) : wallMs;
        const elapsed = clamp((wallMs - obsTs) / 1000, 0, 75);
        const progress = clamp(0.25 + (elapsed * line.speedMps) / Math.max(120, Math.abs(toDist - fromDist)), 0.1, 0.92);
        centerDist = fromDist + (toDist - fromDist) * progress;
      }

      const carCount = clamp(obs.carComposition ?? line.cars, 2, Math.min(8, line.cars + 2));
      const margin = ((carCount - 1) * (line.carLengthM + 1.1)) * 0.5;
      if (centerDist < margin || centerDist > line.totalDistM - margin) continue;

      const rawCars = buildCarConsist(line, centerDist, carCount, reverse);
      const cars = rawCars.filter((c) => c.elevM >= 0);
      if (cars.length === 0) continue;
      const lead = cars[0]!;
      const trainTypeName = obs.trainType?.split(".").pop() || "Local";

      out.push({
        id: obs.id,
        lineId: line.id,
        code: line.code,
        lineNameJa: line.lineNameJa,
        lineNameEn: line.lineNameEn,
        operatorJa: line.operatorJa,
        operatorEn: line.operatorEn,
        trainNumber: obs.trainNumber,
        trainTypeJa: trainTypeName === "Rapid" ? "快速" : trainTypeName === "Express" ? "急行" : "各駅停車",
        trainTypeEn: trainTypeName,
        directionJa: reverse ? line.inboundLabelJa : line.outboundLabelJa,
        directionEn: reverse ? line.inboundLabelEn : line.outboundLabelEn,
        nextStopJa: line.lineNameJa,
        nextStopEn: line.lineNameEn,
        statusJa: isAtStation ? "停車中" : obs.delaySec > 60 ? `約${Math.round(obs.delaySec / 60)}分遅れ` : "走行中",
        statusEn: isAtStation ? "Stopped at station" : obs.delaySec > 60 ? `Delayed ~${Math.round(obs.delaySec / 60)} min` : "Running on time",
        mode: "observed",
        colorHex: line.colorHex,
        carCount,
        carLengthM: line.carLengthM,
        carWidthM: line.carWidthM,
        carHeightM: line.carHeightM,
        delaySec: obs.delaySec,
        speedKmh: isAtStation ? 0 : Math.round(line.speedMps * 3.6),
        lon: lead.lon,
        lat: lead.lat,
        elevM: lead.elevM,
        bearingDeg: lead.bearingDeg,
        sourceJa: liveApi.sourceJa,
        sourceEn: liveApi.sourceEn,
        cars,
      });
    }
  }

  // 2. Live JST-synchronized real-track timetable trains for remaining lines
  const jstClockSec = getJstSecondsOfDay(nowDate) + simTimeSec;
  const sourceJa = liveApi?.sourceJa ?? "横浜実時刻ダイヤ運行（OSM実線路）";
  const sourceEn = liveApi?.sourceEn ?? "Yokohama Live JST Timetable (OSM Tracks)";

  for (let li = 0; li < railBundle.lines.length; li++) {
    const line = railBundle.lines[li]!;
    if (linesWithLive.has(line.id)) continue;

    const headway = clamp(line.headwaySec, 90, 360);
    const runSec = Math.max(70, line.totalDistM / Math.max(8, line.speedMps) + line.stations.length * Math.min(8, line.dwellSec * 0.5));

    for (let dirIdx = 0; dirIdx < 2; dirIdx++) {
      const reverse = dirIdx === 1;
      const phaseOffset = li * 37 + dirIdx * (headway * 0.48);
      const tShifted = jstClockSec + phaseOffset;
      const firstK = Math.floor((tShifted - runSec) / headway) + 1;
      const lastK = Math.floor(tShifted / headway);

      for (let k = firstK; k <= lastK; k++) {
        const depTime = k * headway;
        const elapsed = tShifted - depTime;
        if (elapsed < 0 || elapsed > runSec) continue;

        const motion = evaluateScheduledMotion(line, elapsed, runSec, reverse);
        const margin = 12;
        if (motion.distM < margin || motion.distM > line.totalDistM - margin) continue;

        const rawCars = buildCarConsist(line, motion.distM, line.cars, reverse);
        const cars = rawCars.filter((c) => c.elevM >= 0);
        if (cars.length === 0) continue;
        const lead = cars[0]!;
        const slotNum = (((k % 40) + 40) % 40) + 1;
        const trainNumber = `${line.code}-${reverse ? "B" : "A"}${String(slotNum).padStart(2, "0")}`;

        const nextStopJa = motion.dwellingStation
          ? `${motion.dwellingStation.nameJa}（停車中）`
          : motion.nextStation
            ? `次駅：${motion.nextStation.nameJa}`
            : reverse
              ? line.inboundLabelJa
              : line.outboundLabelJa;
        const nextStopEn = motion.dwellingStation
          ? `${motion.dwellingStation.nameEn} (Stopped)`
          : motion.nextStation
            ? `Next: ${motion.nextStation.nameEn}`
            : reverse
              ? line.inboundLabelEn
              : line.outboundLabelEn;

        out.push({
          id: `${line.id}:${dirIdx}:${k}`,
          lineId: line.id,
          code: line.code,
          lineNameJa: line.lineNameJa,
          lineNameEn: line.lineNameEn,
          operatorJa: line.operatorJa,
          operatorEn: line.operatorEn,
          trainNumber,
          trainTypeJa:
            line.id === "jr-tokaido"
              ? "普通"
              : line.id === "jr-yokosuka"
                ? "普通・湘南新宿"
                : line.id === "keikyu-main"
                  ? "快特・急行"
                  : "各駅停車",
          trainTypeEn:
            line.id === "jr-tokaido"
              ? "Local"
              : line.id === "jr-yokosuka"
                ? "Yokosuka / Shonan-Shinjuku"
                : line.id === "keikyu-main"
                  ? "Limited Express"
                  : "Local",
          directionJa: reverse ? line.inboundLabelJa : line.outboundLabelJa,
          directionEn: reverse ? line.inboundLabelEn : line.outboundLabelEn,
          nextStopJa,
          nextStopEn,
          statusJa: motion.dwellingStation
            ? `駅停車中 (${motion.dwellingStation.nameJa})`
            : `走行中 · ${motion.speedKmh} km/h`,
          statusEn: motion.dwellingStation
            ? `At ${motion.dwellingStation.nameEn}`
            : `Running · ${motion.speedKmh} km/h`,
          mode: "scheduled",
          colorHex: line.colorHex,
          carCount: line.cars,
          carLengthM: line.carLengthM,
          carWidthM: line.carWidthM,
          carHeightM: line.carHeightM,
          delaySec: 0,
          speedKmh: motion.speedKmh,
          lon: lead.lon,
          lat: lead.lat,
          elevM: lead.elevM,
          bearingDeg: lead.bearingDeg,
          sourceJa,
          sourceEn,
          cars,
        });
      }
    }
  }

  return out;
}
