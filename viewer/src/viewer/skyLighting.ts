import { computeYokohamaSun } from "@small-yokohama/core";

export interface SkyGrade {
  matrixRgb: [number, number, number];
  glowRgba: [number, number, number, number];
  nightLights: number;
  vehicleBrightness: number;
  cssBrightness: number;
  cssContrast: number;
  cssSaturate: number;
  multiplyCssRgb: [number, number, number];
  multiplyOpacity: number;
}

type Keyframe = readonly [
  altDeg: number,
  multRgb: readonly [number, number, number],
  multStrength: number,
  glowRgb: readonly [number, number, number],
  glowStrength: number,
  nightLights: number,
  vehicleBrightness: number,
];

const SKY_KEYS: readonly Keyframe[] = [
  [-18, [30, 44, 92], 0.84, [40, 62, 128], 0.1, 1.0, 0.72],
  [-10, [48, 62, 118], 0.72, [68, 78, 148], 0.12, 0.85, 0.78],
  [-5, [92, 86, 148], 0.52, [220, 120, 148], 0.16, 0.55, 0.85],
  [-1, [194, 128, 134], 0.34, [255, 142, 88], 0.2, 0.25, 0.92],
  [5, [255, 192, 140], 0.24, [255, 170, 90], 0.14, 0.05, 0.96],
  [14, [255, 236, 210], 0.08, [255, 220, 170], 0.04, 0.0, 1.0],
  [24, [255, 255, 255], 0.0, [255, 255, 255], 0.0, 0.0, 1.0],
];

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

export function getSunDateForHourJst(sunHourJst: number | null, now = new Date()): Date {
  if (sunHourJst === null) {
    return now;
  }
  const h = Math.floor(sunHourJst);
  const m = Math.round((sunHourJst - h) * 60);
  // Extract current calendar date in Asia/Tokyo (UTC+9, no DST)
  const jst = new Date(now.getTime() + 9 * 3600_000);
  return new Date(
    Date.UTC(jst.getUTCFullYear(), jst.getUTCMonth(), jst.getUTCDate(), h - 9, m, 0),
  );
}

export function getSkyPresetsForDate(now = new Date()): {
  readonly day: number;
  readonly golden: number;
  readonly dusk: number;
  readonly night: number;
  readonly live: null;
} {
  let golden = 16.0;
  let bestGoldenDiff = Infinity;
  let dusk = 16.85;
  let bestDuskDiff = Infinity;

  for (let h = 15.0; h <= 20.501; h += 0.05) {
    const sun = computeYokohamaSun(getSunDateForHourJst(h, now));
    const gDiff = Math.abs(sun.altitudeDeg - 5.0);
    if (gDiff < bestGoldenDiff) {
      bestGoldenDiff = gDiff;
      golden = Math.round(h * 100) / 100;
    }
    const dDiff = Math.abs(sun.altitudeDeg - -4.0);
    if (dDiff < bestDuskDiff) {
      bestDuskDiff = dDiff;
      dusk = Math.round(h * 100) / 100;
    }
  }

  return {
    day: 10.5,
    golden,
    dusk,
    night: 20.5,
    live: null,
  } as const;
}

export const SKY_PRESETS = getSkyPresetsForDate(new Date());

export function isNightAltitude(altitudeDeg: number): boolean {
  return altitudeDeg < -6;
}

export function computeSkyGrade(altitudeDeg: number): SkyGrade {
  let lo = SKY_KEYS[0]!;
  let hi = SKY_KEYS[SKY_KEYS.length - 1]!;
  let t = 0;

  if (altitudeDeg <= lo[0]) {
    hi = lo;
    t = 0;
  } else if (altitudeDeg >= hi[0]) {
    lo = hi;
    t = 0;
  } else {
    for (let i = 1; i < SKY_KEYS.length; i++) {
      if (SKY_KEYS[i]![0] >= altitudeDeg) {
        lo = SKY_KEYS[i - 1]!;
        hi = SKY_KEYS[i]!;
        t = (altitudeDeg - lo[0]) / Math.max(1e-6, hi[0] - lo[0]);
        break;
      }
    }
  }

  const mR = lerp(lo[1][0], hi[1][0], t);
  const mG = lerp(lo[1][1], hi[1][1], t);
  const mB = lerp(lo[1][2], hi[1][2], t);
  const strength = lerp(lo[2], hi[2], t);

  const gR = lerp(lo[3][0], hi[3][0], t);
  const gG = lerp(lo[3][1], hi[3][1], t);
  const gB = lerp(lo[3][2], hi[3][2], t);
  const glowA = lerp(lo[4], hi[4], t);

  const nightLights = lerp(lo[5], hi[5], t);
  const vehicleBrightness = lerp(lo[6], hi[6], t);

  const matrixRgb: [number, number, number] = [
    1 - strength + strength * (mR / 255),
    1 - strength + strength * (mG / 255),
    1 - strength + strength * (mB / 255),
  ];

  return {
    matrixRgb,
    glowRgba: [gR / 255, gG / 255, gB / 255, glowA],
    nightLights,
    vehicleBrightness,
    cssBrightness: 1 - nightLights * 0.08,
    cssContrast: 1 + nightLights * 0.08,
    cssSaturate: 1 - nightLights * 0.12,
    multiplyCssRgb: [Math.round(mR), Math.round(mG), Math.round(mB)],
    multiplyOpacity: Math.min(0.92, strength),
  };
}
