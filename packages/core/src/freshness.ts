import type {
  FreshnessEvaluation,
  VehicleKeyframe,
  VehicleRecord,
} from "./types.js";

/** Fresh observation threshold: 90 seconds (design.md §Animate the city). */
export const FRESH_MAX_AGE_SEC = 90;

/** Stale marker removal threshold: 300 seconds / 5 minutes (design.md §Animate the city). */
export const STALE_MAX_AGE_SEC = 300;

export function evaluateVehicleFreshness(
  vehicle: Pick<VehicleRecord, "mode" | "observedAt">,
  nowMs: number,
): FreshnessEvaluation {
  if (vehicle.mode !== "observed") {
    return {
      status: "non_observed",
      visible: true,
      frozen: false,
      ageSec: null,
      allowInterpolation: false,
    };
  }

  if (!vehicle.observedAt) {
    return {
      status: "missing_timestamp",
      visible: false,
      frozen: true,
      ageSec: null,
      allowInterpolation: false,
    };
  }

  const obsMs = Date.parse(vehicle.observedAt);
  if (!Number.isFinite(obsMs)) {
    return {
      status: "missing_timestamp",
      visible: false,
      frozen: true,
      ageSec: null,
      allowInterpolation: false,
    };
  }

  const ageSec = Math.max(0, (nowMs - obsMs) / 1000);
  if (ageSec <= FRESH_MAX_AGE_SEC) {
    return {
      status: "fresh",
      visible: true,
      frozen: false,
      ageSec,
      allowInterpolation: true,
    };
  }

  if (ageSec <= STALE_MAX_AGE_SEC) {
    return {
      status: "stale",
      visible: true,
      frozen: true,
      ageSec,
      allowInterpolation: false,
    };
  }

  return {
    status: "expired",
    visible: false,
    frozen: true,
    ageSec,
    allowInterpolation: false,
  };
}

function lerpAngleDeg(a: number, b: number, t: number): number {
  const diff = ((((b - a) % 360) + 540) % 360) - 180;
  return ((a + diff * t) % 360 + 360) % 360;
}

/**
 * Interpolate between observed keyframes without extrapolating past the latest observation.
 */
export function interpolateTrackSample(
  keyframes: readonly VehicleKeyframe[],
  timeSec: number,
): VehicleKeyframe {
  if (keyframes.length === 0) {
    throw new Error("Keyframes array must not be empty");
  }
  const first = keyframes[0]!;
  if (keyframes.length === 1 || timeSec <= first.timeSec) {
    return first;
  }
  const last = keyframes[keyframes.length - 1]!;
  if (timeSec >= last.timeSec) {
    // Strictly clamp to the latest observation; never extrapolate ahead without an estimate label.
    return last;
  }

  for (let i = 0; i < keyframes.length - 1; i++) {
    const a = keyframes[i]!;
    const b = keyframes[i + 1]!;
    if (timeSec >= a.timeSec && timeSec <= b.timeSec) {
      const span = b.timeSec - a.timeSec;
      const t = span <= 0 ? 0 : (timeSec - a.timeSec) / span;
      return {
        timeSec,
        lon: a.lon + (b.lon - a.lon) * t,
        lat: a.lat + (b.lat - a.lat) * t,
        bearingDeg: lerpAngleDeg(a.bearingDeg, b.bearingDeg, t),
        roadElevationM: a.roadElevationM + (b.roadElevationM - a.roadElevationM) * t,
        deckId: a.deckId ?? b.deckId,
        noteJa: t < 0.5 ? a.noteJa : b.noteJa,
        noteEn: t < 0.5 ? a.noteEn : b.noteEn,
      };
    }
  }

  return last;
}

/**
 * Cyclic track sampling exclusively for explicitly labeled synthetic / replay / scheduled tracks.
 */
export function sampleReplayTrack(
  keyframes: readonly VehicleKeyframe[],
  elapsedSec: number,
  loopDurationSec: number,
): VehicleKeyframe {
  if (loopDurationSec <= 0) {
    return interpolateTrackSample(keyframes, 0);
  }
  const wrapped = ((elapsedSec % loopDurationSec) + loopDurationSec) % loopDurationSec;
  return interpolateTrackSample(keyframes, wrapped);
}
