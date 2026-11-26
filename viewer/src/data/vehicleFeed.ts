import {
  evaluateVehicleFreshness,
  interpolateTrackSample,
  sampleReplayTrack,
  type FeedHealth,
  type FreshnessEvaluation,
  type PortCallRecord,
  type VehicleRecord,
  type VehicleSnapshot,
} from "@small-yokohama/core";
import type { FeedPreset } from "../state.js";

export type VesselKind = "cruise" | "cruiser" | "waterbus" | "tug";

export interface BoatKeyframe {
  timeSec: number;
  lon: number;
  lat: number;
  bearingDeg: number;
}

export interface AnimatedPortCall extends PortCallRecord {
  vesselKind?: VesselKind;
  lengthM?: number;
  widthM?: number;
  heightM?: number;
  bearingDeg?: number;
  speedKnots?: number;
  moving?: boolean;
  keyframes?: BoatKeyframe[];
}

export interface ResolvedVehicle {
  record: VehicleRecord;
  freshness: FreshnessEvaluation;
  displayMode: "observed" | "stale" | "scheduled" | "synthetic" | "replay";
  noteJa?: string;
  noteEn?: string;
}

export interface LiveBusApiPayload extends VehicleSnapshot {
  mode?: "observed" | "scheduled";
  fallback?: boolean;
}

export interface ResolvedFeedState {
  feedHealth: FeedHealth;
  messageJa: string;
  messageEn: string;
  sourceLabelJa: string;
  sourceLabelEn: string;
  fetchedAt: string;
  vehicles: ResolvedVehicle[];
  portCalls: AnimatedPortCall[];
}

const FIXTURE_FILES: Record<Exclude<FeedPreset, "live">, string> = {
  synthetic: "fixtures/synthetic-bayside-blue.json",
  scheduled: "fixtures/scheduled-bayside-blue.json",
  stale: "fixtures/stale-observed.json",
  "missing-time": "fixtures/missing-time-observed.json",
  outage: "fixtures/outage.json",
};

export async function fetchSnapshotForPreset(
  baseReleaseUrl: string,
  preset: FeedPreset,
  liveEndpoint: string,
): Promise<VehicleSnapshot> {
  const url =
    preset === "live"
      ? liveEndpoint
      : `${baseReleaseUrl}/${FIXTURE_FILES[preset]}`;

  try {
    const res = await fetch(url, { cache: "no-store" });
    if (!res.ok) {
      throw new Error(`HTTP ${res.status}`);
    }
    return (await res.json()) as VehicleSnapshot;
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    const nowIso = new Date().toISOString();
    return {
      schemaVersion: "1.0.0",
      generatedAt: nowIso,
      fetchedAt: nowIso,
      feedHealth: "outage",
      feedMessage: {
        ja: `配信障害（${reason}）：実測データを取得できません。地図探索と予定情報は引き続き利用可能です。`,
        en: `Feed outage (${reason}): live telemetry unavailable; map exploration and schedules remain available.`,
      },
      source: {
        id: "collector-outage",
        labelJa: "ライブ取得エラー",
        labelEn: "Live Collector Unavailable",
        attribution: "Yokohama Municipal Bus / ODPT",
      },
      vehicles: [],
      portCalls: [],
    };
  }
}

export async function fetchLiveBusesApi(
  endpoint = "/api/buses",
): Promise<LiveBusApiPayload | null> {
  try {
    const res = await fetch(endpoint, { cache: "no-store" });
    if (!res.ok) return null;
    const json = (await res.json()) as LiveBusApiPayload;
    if (!json || !Array.isArray(json.vehicles)) return null;
    return json;
  } catch {
    return null;
  }
}

function deadReckonLiveBus(v: VehicleRecord, ageSec: number): VehicleRecord {
  if (v.speedMps <= 0.5 || ageSec <= 0) return v;
  const cappedDist = Math.min(90, v.speedMps * Math.min(18, ageSec));
  const rad = (v.bearingDeg * Math.PI) / 180;
  const latRad = (v.lat * Math.PI) / 180;
  return {
    ...v,
    lon: v.lon + (cappedDist * Math.sin(rad)) / (111320 * Math.cos(latRad)),
    lat: v.lat + (cappedDist * Math.cos(rad)) / 111320,
  };
}

export function resolveVehiclesForFrame(
  snapshot: VehicleSnapshot,
  preset: FeedPreset,
  simTimeSec: number,
  wallNowMs = Date.now(),
  liveBusesApi: LiveBusApiPayload | null = null,
): ResolvedFeedState {
  // Diagnostic static presets (stale / missing-time) evaluate relative to snapshot.generatedAt
  // so testers can observe the exact 135s freeze & 360s removal thresholds anytime;
  // live feeds ALWAYS compare against wall-clock Date.now().
  const referenceNowMs =
    preset === "live" ? wallNowMs : Date.parse(snapshot.generatedAt) || wallNowMs;

  const resolved: ResolvedVehicle[] = [];
  let sourceLabelJa = snapshot.source.labelJa;
  let sourceLabelEn = snapshot.source.labelEn;
  let messageJa = snapshot.feedMessage.ja;
  let messageEn = snapshot.feedMessage.en;
  let fetchedAt = snapshot.fetchedAt;
  let feedHealth = snapshot.feedHealth;

  const useLiveOdpt =
    (preset === "synthetic" || preset === "scheduled") &&
    liveBusesApi?.mode === "observed" &&
    liveBusesApi.vehicles.length > 0;

  if (useLiveOdpt && liveBusesApi) {
    for (const v of liveBusesApi.vehicles) {
      const freshness = evaluateVehicleFreshness(v, wallNowMs);
      if (!freshness.visible) continue;
      const animated =
        freshness.allowInterpolation && freshness.ageSec !== null
          ? deadReckonLiveBus(v, freshness.ageSec)
          : v;
      const displayMode: ResolvedVehicle["displayMode"] =
        freshness.status === "stale" ? "stale" : "observed";
      resolved.push({
        record: animated,
        freshness,
        displayMode,
      });
    }
    if (resolved.length > 0) {
      feedHealth = liveBusesApi.feedHealth;
      messageJa = liveBusesApi.feedMessage.ja;
      messageEn = liveBusesApi.feedMessage.en;
      sourceLabelJa = liveBusesApi.source.labelJa;
      sourceLabelEn = liveBusesApi.source.labelEn;
      fetchedAt = liveBusesApi.fetchedAt;
    }
  }

  if (resolved.length === 0) {
    for (const v of snapshot.vehicles) {
      const freshness = evaluateVehicleFreshness(v, referenceNowMs);
      if (!freshness.visible) {
        continue;
      }

      let animated = v;
      let noteJa: string | undefined;
      let noteEn: string | undefined;

      const kfList = snapshot.keyframes?.[v.entityId];
      if (kfList && kfList.length > 0) {
        if (v.mode === "synthetic" || v.mode === "replay" || v.mode === "scheduled") {
          const lastKfTime = kfList[kfList.length - 1]!.timeSec;
          const dur =
            v.entityId === "syn-bayside-blue-01" && snapshot.replayDurationSec
              ? snapshot.replayDurationSec
              : lastKfTime > 0
                ? lastKfTime
                : (snapshot.replayDurationSec ?? 60);
          const sample = sampleReplayTrack(kfList, simTimeSec, dur);
          animated = {
            ...v,
            lon: sample.lon,
            lat: sample.lat,
            bearingDeg: sample.bearingDeg,
            roadElevationM: sample.roadElevationM,
            deckId: sample.deckId ?? v.deckId,
          };
          noteJa = sample.noteJa;
          noteEn = sample.noteEn;
        } else if (v.mode === "observed" && freshness.allowInterpolation) {
          const sample = interpolateTrackSample(kfList, simTimeSec);
          animated = {
            ...v,
            lon: sample.lon,
            lat: sample.lat,
            bearingDeg: sample.bearingDeg,
            roadElevationM: sample.roadElevationM,
          };
        }
      }

      const displayMode: ResolvedVehicle["displayMode"] =
        freshness.status === "stale" ? "stale" : animated.mode;

      resolved.push({
        record: animated,
        freshness,
        displayMode,
        noteJa,
        noteEn,
      });
    }
  }

  const rawPortCalls = (snapshot.portCalls ?? []) as AnimatedPortCall[];
  const portCalls: AnimatedPortCall[] = rawPortCalls.map((pc) => {
    const kfs = pc.keyframes;
    if (!kfs || kfs.length < 2) {
      return pc;
    }
    const dur = kfs[kfs.length - 1]!.timeSec;
    if (dur <= 0) return pc;
    const mapped = kfs.map((k) => ({
      timeSec: k.timeSec,
      lon: k.lon,
      lat: k.lat,
      bearingDeg: k.bearingDeg,
      roadElevationM: 0,
    }));
    const sample = sampleReplayTrack(mapped, simTimeSec, dur);
    return {
      ...pc,
      lon: sample.lon,
      lat: sample.lat,
      bearingDeg: sample.bearingDeg,
    };
  });

  return {
    feedHealth,
    messageJa,
    messageEn,
    sourceLabelJa,
    sourceLabelEn,
    fetchedAt,
    vehicles: resolved,
    portCalls,
  };
}
