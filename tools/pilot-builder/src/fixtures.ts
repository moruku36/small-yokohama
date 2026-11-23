import type { ShinkoSceneBundle, VehicleSnapshot } from "@small-yokohama/core";

export function buildPilotFixtures(
  scene: ShinkoSceneBundle,
  referenceIso = "2026-11-24T08:00:00+09:00",
): Record<string, VehicleSnapshot> {
  const refMs = Date.parse(referenceIso);
  const startKf = scene.syntheticKeyframes[0]!;
  const cwKf = scene.syntheticKeyframes[2]!;
  const rbKf = scene.syntheticKeyframes[7]!;

  const synthetic: VehicleSnapshot = {
    schemaVersion: "1.0.0",
    generatedAt: referenceIso,
    fetchedAt: referenceIso,
    feedHealth: "ok",
    feedMessage: {
      ja: "合成テスト軌道：新港サークルウォーク真下および赤レンガ倉庫2号館裏の遮蔽を検証中",
      en: "Synthetic test track: verifying occlusion underneath Circle Walk and behind Red Brick No. 2",
    },
    source: {
      id: "synthetic-shinko-fixture",
      labelJa: "合成テスト軌道（新港パイロット）",
      labelEn: "Synthetic Test Track (Shinko Pilot)",
      attribution: "Small Yokohama Pilot Fixture (MIT)",
    },
    vehicles: [
      {
        entityId: "syn-bayside-blue-01",
        mode: "synthetic",
        routeId: "bayside-blue",
        routeLabelJa: "ベイサイドブルー（試験）",
        routeLabelEn: "Bayside Blue (Synthetic)",
        tripId: "syn-trip-shinko-loop",
        directionId: 0,
        directionLabelJa: "山下ふ頭ゆき（合成軌道）",
        directionLabelEn: "To Yamashita Pier (Synthetic)",
        observedAt: referenceIso,
        fetchedAt: referenceIso,
        lon: startKf.lon,
        lat: startKf.lat,
        bearingDeg: startKf.bearingDeg,
        speedMps: 7.2,
        deckId: "ground-road",
        roadElevationM: 2.2,
        lengthM: 18.0,
        widthM: 2.5,
        heightM: 3.3,
        articulated: true,
        shapeProgress: 0,
        statusNote: "Synthetic articulated bus moving along ground-road (+2.2m)",
      },
    ],
    replayDurationSec: scene.syntheticLoopDurationSec,
    keyframes: {
      "syn-bayside-blue-01": scene.syntheticKeyframes,
    },
    portCalls: scene.portCalls,
  };

  const scheduled: VehicleSnapshot = {
    schemaVersion: "1.0.0",
    generatedAt: referenceIso,
    fetchedAt: referenceIso,
    feedHealth: "ok",
    feedMessage: {
      ja: "時刻表推定レイヤー：ODPT GTFS-JP 定時ダイヤに基づく推定位置（実測ではありません）",
      en: "Scheduled timetable layer: estimated from GTFS-JP stop times (not live GPS)",
    },
    source: {
      id: "gtfs-jp-scheduled-fixture",
      labelJa: "時刻表推定（GTFS-JP フィクスチャ）",
      labelEn: "Scheduled Timetable (GTFS-JP Fixture)",
      attribution: "Yokohama Municipal Bus Timetable Fixture",
    },
    vehicles: [
      {
        entityId: "sched-bayside-blue-102",
        mode: "scheduled",
        routeId: "bayside-blue",
        routeLabelJa: "ベイサイドブルー",
        routeLabelEn: "Bayside Blue",
        tripId: "sched-0800-outbound",
        directionId: 0,
        directionLabelJa: "横浜駅前 → 赤レンガ倉庫・山下ふ頭",
        directionLabelEn: "Yokohama Sta. → Red Brick / Yamashita Pier",
        observedAt: null,
        fetchedAt: referenceIso,
        lon: cwKf.lon,
        lat: cwKf.lat,
        bearingDeg: cwKf.bearingDeg,
        speedMps: 6.5,
        deckId: "ground-road",
        roadElevationM: 2.2,
        lengthM: 18.0,
        widthM: 2.5,
        heightM: 3.3,
        articulated: true,
        shapeProgress: 0.25,
        statusNote: "Estimated from GTFS-JP stop_times",
      },
    ],
    replayDurationSec: scene.syntheticLoopDurationSec,
    keyframes: {
      "sched-bayside-blue-102": scene.syntheticKeyframes,
    },
    portCalls: scene.portCalls,
  };

  // Stale & expired test fixture: 135s old (frozen + badge) and 360s old (>5m hidden)
  const staleIso135 = new Date(refMs - 135 * 1000).toISOString();
  const expiredIso360 = new Date(refMs - 360 * 1000).toISOString();

  const staleObserved: VehicleSnapshot = {
    schemaVersion: "1.0.0",
    generatedAt: referenceIso,
    fetchedAt: referenceIso,
    feedHealth: "ok",
    feedMessage: {
      ja: "鮮度劣化テスト：135秒前の車両を停止表示し、5分超過車両を非表示にします",
      en: "Stale freshness test: freezing 135s-old vehicle and hiding >5min expired vehicle",
    },
    source: {
      id: "odpt-stale-fixture",
      labelJa: "鮮度検証用フィクスチャ（実測模擬）",
      labelEn: "Stale Observation Fixture",
      attribution: "Small Yokohama Freshness Test Fixture",
    },
    vehicles: [
      {
        entityId: "obs-stale-135s",
        mode: "observed",
        routeId: "bayside-blue",
        routeLabelJa: "ベイサイドブルー",
        routeLabelEn: "Bayside Blue",
        tripId: "trip-bb-11",
        directionId: 0,
        directionLabelJa: "山下ふ頭ゆき",
        directionLabelEn: "To Yamashita Pier",
        observedAt: staleIso135,
        fetchedAt: referenceIso,
        lon: startKf.lon,
        lat: startKf.lat,
        bearingDeg: startKf.bearingDeg,
        speedMps: 0,
        deckId: "ground-road",
        roadElevationM: 2.2,
        lengthM: 18.0,
        widthM: 2.5,
        heightM: 3.3,
        articulated: true,
        statusNote: "Frozen at last observed position (age 135s > 90s)",
      },
      {
        entityId: "obs-expired-360s",
        mode: "observed",
        routeId: "bayside-blue",
        routeLabelJa: "ベイサイドブルー",
        routeLabelEn: "Bayside Blue",
        tripId: "trip-bb-12",
        directionId: 1,
        directionLabelJa: "横浜駅改札口ゆき",
        directionLabelEn: "To Yokohama Station",
        observedAt: expiredIso360,
        fetchedAt: referenceIso,
        lon: rbKf.lon,
        lat: rbKf.lat,
        bearingDeg: rbKf.bearingDeg,
        speedMps: 0,
        deckId: "ground-road",
        roadElevationM: 2.2,
        lengthM: 18.0,
        widthM: 2.5,
        heightM: 3.3,
        articulated: true,
        statusNote: "Expired (> 300s) and removed from map",
      },
    ],
    portCalls: scene.portCalls,
  };

  const missingTimeObserved: VehicleSnapshot = {
    schemaVersion: "1.0.0",
    generatedAt: referenceIso,
    fetchedAt: referenceIso,
    feedHealth: "no_match",
    feedMessage: {
      ja: "観測時刻欠損：observedAt が無い報告は新鮮扱いせず、未照合として扱います",
      en: "Missing observation timestamp: reports without observedAt cannot qualify as fresh",
    },
    source: {
      id: "odpt-missing-time-fixture",
      labelJa: "観測時刻欠損フィクスチャ",
      labelEn: "Missing Timestamp Fixture",
      attribution: "Small Yokohama Freshness Test Fixture",
    },
    vehicles: [
      {
        entityId: "obs-missing-ts",
        mode: "observed",
        routeId: "bayside-blue",
        routeLabelJa: "ベイサイドブルー",
        routeLabelEn: "Bayside Blue",
        tripId: null,
        directionId: null,
        directionLabelJa: "方向未照合",
        directionLabelEn: "Unmatched Direction",
        observedAt: null,
        fetchedAt: referenceIso,
        lon: cwKf.lon,
        lat: cwKf.lat,
        bearingDeg: cwKf.bearingDeg,
        speedMps: 0,
        deckId: "ground-road",
        roadElevationM: 2.2,
        lengthM: 18.0,
        widthM: 2.5,
        heightM: 3.3,
        articulated: true,
        statusNote: "Rejected from fresh observed layer due to missing observedAt",
      },
    ],
    portCalls: scene.portCalls,
  };

  const outage: VehicleSnapshot = {
    schemaVersion: "1.0.0",
    generatedAt: referenceIso,
    fetchedAt: referenceIso,
    feedHealth: "outage",
    feedMessage: {
      ja: "配信障害テスト：GTFS-RT 取得不能のため実測マーカーを非表示（背景・予定のみ表示）",
      en: "Feed outage test: GTFS-RT unavailable; observed markers withheld while map remains usable",
    },
    source: {
      id: "odpt-outage-fixture",
      labelJa: "配信停止テストフィクスチャ",
      labelEn: "Feed Outage Fixture",
      attribution: "Small Yokohama Resilience Test Fixture",
    },
    vehicles: [],
    portCalls: scene.portCalls,
  };

  return {
    "synthetic-bayside-blue.json": synthetic,
    "scheduled-bayside-blue.json": scheduled,
    "stale-observed.json": staleObserved,
    "missing-time-observed.json": missingTimeObserved,
    "outage.json": outage,
  };
}
