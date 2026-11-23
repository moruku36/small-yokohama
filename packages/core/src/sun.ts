import type { Rgb } from "./types.js";

const DEG_TO_RAD = Math.PI / 180;
const RAD_TO_DEG = 180 / Math.PI;

export interface YokohamaSunState {
  altitudeDeg: number;
  azimuthDeg: number;
  phase: "day" | "golden" | "twilight" | "night";
  overlayRgba: readonly [number, number, number, number];
  waterTintRgb: Rgb;
}

/**
 * Approximate solar position at Shinko / Yokohama (35.453 N, 139.6415 E)
 * using NOAA solar position equations.
 */
export function computeYokohamaSun(
  date: Date,
  latDeg = 35.453,
  lonDeg = 139.6415,
): YokohamaSunState {
  const startOfYear = Date.UTC(date.getUTCFullYear(), 0, 1, 0, 0, 0);
  const dayOfYear = Math.floor((date.getTime() - startOfYear) / 86400000) + 1;
  const utcHours =
    date.getUTCHours() + date.getUTCMinutes() / 60 + date.getUTCSeconds() / 3600;

  const gamma = ((2 * Math.PI) / 365) * (dayOfYear - 1 + (utcHours - 12) / 24);
  const eqTimeMin =
    229.18 *
    (0.000075 +
      0.001868 * Math.cos(gamma) -
      0.032077 * Math.sin(gamma) -
      0.014615 * Math.cos(2 * gamma) -
      0.040849 * Math.sin(2 * gamma));

  const declRad =
    0.006918 -
    0.399912 * Math.cos(gamma) +
    0.070257 * Math.sin(gamma) -
    0.006758 * Math.cos(2 * gamma) +
    0.000907 * Math.sin(2 * gamma) -
    0.002697 * Math.cos(3 * gamma) +
    0.00148 * Math.sin(3 * gamma);

  const trueSolarTimeMin = ((utcHours * 60 + eqTimeMin + 4 * lonDeg) % 1440 + 1440) % 1440;
  const hourAngleDeg = trueSolarTimeMin / 4 - 180;
  const hourAngleRad = hourAngleDeg * DEG_TO_RAD;
  const latRad = latDeg * DEG_TO_RAD;

  const cosZenith = Math.min(
    1,
    Math.max(
      -1,
      Math.sin(latRad) * Math.sin(declRad) +
        Math.cos(latRad) * Math.cos(declRad) * Math.cos(hourAngleRad),
    ),
  );
  const zenithRad = Math.acos(cosZenith);
  const altitudeDeg = 90 - zenithRad * RAD_TO_DEG;

  const sinAzDenom = Math.sin(zenithRad) * Math.cos(latRad);
  let azimuthDeg = 180;
  if (Math.abs(sinAzDenom) > 1e-6) {
    const cosAz = Math.min(
      1,
      Math.max(
        -1,
        (Math.sin(latRad) * cosZenith - Math.sin(declRad)) / sinAzDenom,
      ),
    );
    const rawAz = Math.acos(cosAz) * RAD_TO_DEG;
    azimuthDeg = hourAngleDeg > 0 ? (rawAz + 180) % 360 : (540 - rawAz) % 360;
  }

  if (altitudeDeg >= 12) {
    return {
      altitudeDeg,
      azimuthDeg,
      phase: "day",
      overlayRgba: [255, 252, 245, 0],
      waterTintRgb: [86, 138, 174],
    };
  }
  if (altitudeDeg >= 0) {
    const t = 1 - altitudeDeg / 12;
    return {
      altitudeDeg,
      azimuthDeg,
      phase: "golden",
      overlayRgba: [232, 134, 72, Math.round(t * 48)],
      waterTintRgb: [72, 112, 148],
    };
  }
  if (altitudeDeg >= -9) {
    const t = Math.min(1, -altitudeDeg / 9);
    return {
      altitudeDeg,
      azimuthDeg,
      phase: "twilight",
      overlayRgba: [36, 54, 96, Math.round(48 + t * 68)],
      waterTintRgb: [36, 62, 98],
    };
  }
  return {
    altitudeDeg,
    azimuthDeg,
    phase: "night",
    overlayRgba: [14, 24, 52, 128],
    waterTintRgb: [22, 38, 66],
  };
}
