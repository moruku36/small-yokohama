import { computeYokohamaSun } from "@small-yokohama/core";

export interface SkyGrade {
  matrixRgb: [number, number, number];
  glowRgba: [number, number, number, number];
  nightLights: number;
  vehicleBrightness: number;
  cssBrightness: number;
  cssContrast: number;
  cssSaturate: number;
  cssFilter: string;
  scrimRgba: [number, number, number, number];
  multiplyCssRgb: [number, number, number];
  multiplyOpacity: number;
  cloudShadowRgb: [number, number, number];
  cloudBaseRgb: [number, number, number];
  cloudHighlightRgb: [number, number, number];
}

type Keyframe = readonly [
  altDeg: number,
  multRgb: readonly [number, number, number],
  multStrength: number,
  glowRgb: readonly [number, number, number],
  glowStrength: number,
  nightLights: number,
  vehicleBrightness: number,
  cssBri: number,
  cssCon: number,
  cssSat: number,
  sepia: number,
  hueDeg: number,
  scrimRgb: readonly [number, number, number],
  scrimAlpha: number,
  cloudShadow: readonly [number, number, number],
  cloudBase: readonly [number, number, number],
  cloudHighlight: readonly [number, number, number],
];

const SKY_KEYS: readonly Keyframe[] = [
  [-18, [26, 40, 88], 0.86, [40, 62, 128], 0.1, 1.0, 0.72, 0.32, 1.22, 0.76, 0.0, -10, [8, 18, 46], 0.46, [38, 48, 76], [56, 69, 99], [74, 89, 122]],
  [-10, [44, 58, 114], 0.74, [68, 78, 148], 0.12, 0.90, 0.78, 0.42, 1.18, 0.82, 0.0, -8, [18, 28, 68], 0.38, [52, 62, 92], [76, 90, 126], [102, 114, 152]],
  [-5, [92, 86, 148], 0.52, [220, 120, 148], 0.16, 0.62, 0.85, 0.58, 1.14, 0.90, 0.0, -6, [32, 36, 92], 0.30, [76, 84, 120], [117, 122, 158], [163, 148, 173]],
  [-1, [194, 128, 134], 0.34, [255, 142, 88], 0.2, 0.28, 0.92, 0.78, 1.09, 1.04, 0.08, -2, [185, 88, 72], 0.22, [136, 118, 146], [192, 162, 168], [235, 194, 180]],
  [4.5, [255, 192, 140], 0.24, [255, 170, 90], 0.08, 0.0, 0.96, 0.94, 1.05, 1.12, 0.08, 0, [255, 148, 66], 0.07, [184, 153, 153], [235, 206, 184], [255, 232, 204]],
  [14, [255, 236, 210], 0.08, [255, 220, 170], 0.04, 0.0, 1.0, 0.99, 1.01, 1.02, 0.03, 0, [255, 224, 175], 0.03, [196, 209, 222], [232, 237, 242], [252, 252, 250]],
  [24, [255, 255, 255], 0.0, [255, 255, 255], 0.0, 0.0, 1.0, 1.0, 1.0, 1.0, 0.0, 0, [0, 0, 0], 0.0, [196, 209, 222], [232, 237, 242], [252, 252, 250]],
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
  const cssBrightness = lerp(lo[7], hi[7], t);
  const cssContrast = lerp(lo[8], hi[8], t);
  const cssSaturate = lerp(lo[9], hi[9], t);
  const sepia = lerp(lo[10], hi[10], t);
  const hueDeg = lerp(lo[11], hi[11], t);

  const sR = Math.round(lerp(lo[12][0], hi[12][0], t));
  const sG = Math.round(lerp(lo[12][1], hi[12][1], t));
  const sB = Math.round(lerp(lo[12][2], hi[12][2], t));
  const sA = lerp(lo[13], hi[13], t);

  const cShadow: [number, number, number] = [
    Math.round(lerp(lo[14][0], hi[14][0], t)),
    Math.round(lerp(lo[14][1], hi[14][1], t)),
    Math.round(lerp(lo[14][2], hi[14][2], t)),
  ];
  const cBase: [number, number, number] = [
    Math.round(lerp(lo[15][0], hi[15][0], t)),
    Math.round(lerp(lo[15][1], hi[15][1], t)),
    Math.round(lerp(lo[15][2], hi[15][2], t)),
  ];
  const cHighlight: [number, number, number] = [
    Math.round(lerp(lo[16][0], hi[16][0], t)),
    Math.round(lerp(lo[16][1], hi[16][1], t)),
    Math.round(lerp(lo[16][2], hi[16][2], t)),
  ];

  const cssFilter =
    nightLights < 0.01 && Math.abs(cssBrightness - 1) < 0.005 && sepia < 0.01
      ? ""
      : [
          `brightness(${cssBrightness.toFixed(3)})`,
          `contrast(${cssContrast.toFixed(3)})`,
          `saturate(${cssSaturate.toFixed(3)})`,
          ...(sepia > 0.01 ? [`sepia(${sepia.toFixed(3)})`] : []),
          ...(Math.abs(hueDeg) > 0.5 ? [`hue-rotate(${hueDeg.toFixed(1)}deg)`] : []),
        ].join(" ");

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
    cssBrightness,
    cssContrast,
    cssSaturate,
    cssFilter,
    scrimRgba: [sR, sG, sB, sA],
    multiplyCssRgb: [Math.round(mR), Math.round(mG), Math.round(mB)],
    multiplyOpacity: Math.min(0.92, strength),
    cloudShadowRgb: cShadow,
    cloudBaseRgb: cBase,
    cloudHighlightRgb: cHighlight,
  };
}
