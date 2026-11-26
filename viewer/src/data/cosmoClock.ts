export interface CosmoClockVisualState {
  digits: readonly [number, number, number, number];
  colonOn: boolean;
  timeText: string;
  showMode: 0 | 1 | 2 | 3;
  showNameJa: string;
  showNameEn: string;
  wheelAngleRad: number;
}

/**
 * Verified OSM coordinates for Cosmo Clock 21 (osmId: 363854124, Minato Mirai / Shinko):
 * real total height 112.5 m, 100 m wheel diameter -> hub center at ~62.5 m elevation.
 */
export const COSMO_CLOCK_ORIGIN = {
  lon: 139.636762,
  lat: 35.455358,
  hubElevM: 62.5,
  wheelRadiusM: 50.0,
  topElevM: 112.5,
  planeAzimuthDeg: 22.0,
} as const;

const SHOW_PROGRAMS: ReadonlyArray<{
  mode: 0 | 1 | 2 | 3;
  ja: string;
  en: string;
}> = [
  { mode: 0, ja: "エメラルド・クラシック", en: "Emerald Classic" },
  { mode: 1, ja: "レインボー万華鏡", en: "Rainbow Kaleidoscope" },
  { mode: 2, ja: "大花火イルミネーション", en: "Harbor Fireworks" },
  { mode: 3, ja: "みなとみらいウェーブ", en: "Minato Mirai Wave" },
];

export function resolveCosmoClockState(
  sunDate: Date,
  simTimeSec: number,
  reducedMotion = false,
): CosmoClockVisualState {
  const jst = new Date(sunDate.getTime() + 9 * 3600_000);
  const hour = jst.getUTCHours();
  const min = jst.getUTCMinutes();
  const h1 = Math.floor(hour / 10);
  const h2 = hour % 10;
  const m1 = Math.floor(min / 10);
  const m2 = min % 10;
  const colonOn = reducedMotion ? true : Math.floor(simTimeSec) % 2 === 0;
  const progIdx = Math.floor(Math.max(0, simTimeSec) / 18) % SHOW_PROGRAMS.length;
  const prog = SHOW_PROGRAMS[progIdx]!;
  const wheelAngleRad = reducedMotion ? 0 : (simTimeSec * 0.085) % (Math.PI * 2);

  return {
    digits: [h1, h2, m1, m2],
    colonOn,
    timeText: `${String(hour).padStart(2, "0")}:${String(min).padStart(2, "0")}`,
    showMode: prog.mode,
    showNameJa: prog.ja,
    showNameEn: prog.en,
    wheelAngleRad,
  };
}
