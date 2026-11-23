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

export interface ResolvedVehicle {
  record: VehicleRecord;
  freshness: FreshnessEvaluation;
  displayMode: "observed" | "stale" | "scheduled" | "synthetic" | "replay";
  noteJa?: string;
  noteEn?: string;
}

export interface ResolvedFeedState {
  feedHealth: FeedHealth;
  messageJa: string;
  messageEn: string;
  sourceLabelJa: string;
  sourceLabelEn: string;
  fetchedAt: string;
  vehicles: ResolvedVehicle[];
  portCalls: PortCallRecord[];
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

export function resolveVehiclesForFrame(
  snapshot: VehicleSnapshot,
  preset: FeedPreset,
  simTimeSec: number,
  wallNowMs = Date.now(),
): ResolvedFeedState {
  // Diagnostic static presets (stale / missing-time) evaluate relative to snapshot.generatedAt
  // so testers can observe the exact 135s freeze & 360s removal thresholds anytime;
  // live feeds ALWAYS compare against wall-clock Date.now().
  const referenceNowMs =
    preset === "live" ? wallNowMs : Date.parse(snapshot.generatedAt) || wallNowMs;

  const resolved: ResolvedVehicle[] = [];
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
        const dur = snapshot.replayDurationSec ?? kfList[kfList.length - 1]!.timeSec;
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

  return {
    feedHealth: snapshot.feedHealth,
    messageJa: snapshot.feedMessage.ja,
    messageEn: snapshot.feedMessage.en,
    sourceLabelJa: snapshot.source.labelJa,
    sourceLabelEn: snapshot.source.labelEn,
    fetchedAt: snapshot.fetchedAt,
    vehicles: resolved,
    portCalls: snapshot.portCalls ?? [],
  };
}
