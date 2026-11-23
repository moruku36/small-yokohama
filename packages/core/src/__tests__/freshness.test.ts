import { describe, expect, it } from "vitest";
import {
  evaluateVehicleFreshness,
  interpolateTrackSample,
  type VehicleKeyframe,
  type VehicleRecord,
} from "@small-yokohama/core";

function makeObs(observedAt: string | null, fetchedAt: string): VehicleRecord {
  return {
    entityId: "veh-1",
    mode: "observed",
    routeId: "bayside-blue",
    routeLabelJa: "ベイサイドブルー",
    routeLabelEn: "Bayside Blue",
    tripId: "trip-1",
    directionId: 0,
    directionLabelJa: "山下ふ頭ゆき",
    directionLabelEn: "To Yamashita Pier",
    observedAt,
    fetchedAt,
    lon: 139.6394,
    lat: 35.4531,
    bearingDeg: 135,
    speedMps: 5,
    deckId: "ground-road",
    roadElevationM: 2.2,
    lengthM: 18,
    widthM: 2.5,
    heightM: 3.3,
    articulated: true,
  };
}

describe("Freshness thresholds and non-extrapolation policy", () => {
  const obsIso = "2026-11-24T08:00:00.000Z";
  const obsMs = Date.parse(obsIso);

  it("handles exact 0s / 90s / 91s / 300s / 301s boundaries", () => {
    const v = makeObs(obsIso, obsIso);

    expect(evaluateVehicleFreshness(v, obsMs)).toMatchObject({
      status: "fresh",
      visible: true,
      frozen: false,
      ageSec: 0,
      allowInterpolation: true,
    });

    expect(evaluateVehicleFreshness(v, obsMs + 90_000)).toMatchObject({
      status: "fresh",
      visible: true,
      frozen: false,
      ageSec: 90,
      allowInterpolation: true,
    });

    expect(evaluateVehicleFreshness(v, obsMs + 91_000)).toMatchObject({
      status: "stale",
      visible: true,
      frozen: true,
      ageSec: 91,
      allowInterpolation: false,
    });

    expect(evaluateVehicleFreshness(v, obsMs + 300_000)).toMatchObject({
      status: "stale",
      visible: true,
      frozen: true,
      ageSec: 300,
      allowInterpolation: false,
    });

    expect(evaluateVehicleFreshness(v, obsMs + 301_000)).toMatchObject({
      status: "expired",
      visible: false,
      frozen: true,
      ageSec: 301,
      allowInterpolation: false,
    });
  });

  it("never qualifies missing observation timestamps as fresh, even if fetchedAt is recent", () => {
    const nowIso = "2026-11-24T08:05:00.000Z";
    const v = makeObs(null, nowIso);
    expect(evaluateVehicleFreshness(v, Date.parse(nowIso))).toMatchObject({
      status: "missing_timestamp",
      visible: false,
      frozen: true,
      ageSec: null,
      allowInterpolation: false,
    });
  });

  it("keeps original observation age when cache refreshes fetchedAt", () => {
    const refreshedFetch = "2026-11-24T08:02:15.000Z";
    const v = makeObs(obsIso, refreshedFetch);
    const res = evaluateVehicleFreshness(v, Date.parse(refreshedFetch));
    expect(res.status).toBe("stale");
    expect(res.ageSec).toBe(135);
    expect(res.frozen).toBe(true);
  });

  it("never extrapolates past the latest observation keyframe", () => {
    const frames: VehicleKeyframe[] = [
      { timeSec: 0, lon: 139.639, lat: 35.453, bearingDeg: 135, roadElevationM: 2.2 },
      { timeSec: 10, lon: 139.640, lat: 35.452, bearingDeg: 135, roadElevationM: 2.2 },
    ];
    const mid = interpolateTrackSample(frames, 5);
    expect(mid.lon).toBeCloseTo(139.6395, 6);

    const pastLatest = interpolateTrackSample(frames, 45);
    expect(pastLatest.lon).toBe(139.640);
    expect(pastLatest.lat).toBe(35.452);
  });
});
