import type { SelectedEntity } from "../state.js";
import type {
  RailLineId,
  RailLineTrack,
  ResolvedTrain,
  YokohamaRailBundle,
} from "./trainFeed.js";

export interface StationDepartureRow {
  id: string;
  lineCode: string;
  lineNameJa: string;
  lineNameEn: string;
  lineColorHex: string;
  destinationJa: string;
  destinationEn: string;
  trainTypeJa: string;
  trainTypeEn: string;
  minutesUntil: number;
  secondsUntil: number;
  delayMin: number;
  mode: "observed" | "scheduled";
  platformJa?: string;
  platformEn?: string;
}

export interface StationBoardResult {
  stationKey: string;
  stationNameJa: string;
  stationNameEn: string;
  linesSummary: string[];
  hasLiveTelemetry: boolean;
  isOvernightPause: boolean;
  departures: StationDepartureRow[];
}

export type CanonicalStationKey =
  | "yokohama"
  | "sakuragicho"
  | "kannai"
  | "ishikawacho"
  | "kanagawa"
  | "tobe"
  | "hinodecho"
  | "hiranumabashi"
  | "shin-takashima"
  | "minatomirai"
  | "bashamichi"
  | "nihon-odori"
  | "motomachi-chukagai"
  | "takashimacho"
  | "isezaki-chojamachi"
  | "tammachi";

interface StationLineProfile {
  surfaceLines: ReadonlyArray<{ lineId: RailLineId; stationNameEnMatch: string }>;
  undergroundLines: ReadonlyArray<"MM" | "B" | "TY">;
  summaryCodes: readonly string[];
  defaultNameJa: string;
  defaultNameEn: string;
}

const STATION_PROFILES: Record<CanonicalStationKey, StationLineProfile> = {
  yokohama: {
    surfaceLines: [
      { lineId: "jr-keihin-tohoku", stationNameEnMatch: "Yokohama" },
      { lineId: "jr-tokaido", stationNameEnMatch: "Yokohama" },
      { lineId: "jr-yokosuka", stationNameEnMatch: "Yokohama" },
      { lineId: "keikyu-main", stationNameEnMatch: "Yokohama" },
      { lineId: "sotetsu-main", stationNameEnMatch: "Yokohama" },
    ],
    undergroundLines: ["MM", "B", "TY"],
    summaryCodes: ["JK", "JT", "JO", "KK", "SO", "MM", "B", "TY"],
    defaultNameJa: "横浜駅",
    defaultNameEn: "Yokohama Station",
  },
  sakuragicho: {
    surfaceLines: [{ lineId: "jr-keihin-tohoku", stationNameEnMatch: "Sakuragicho" }],
    undergroundLines: ["B"],
    summaryCodes: ["JK", "B"],
    defaultNameJa: "桜木町駅",
    defaultNameEn: "Sakuragicho Station",
  },
  kannai: {
    surfaceLines: [{ lineId: "jr-keihin-tohoku", stationNameEnMatch: "Kannai" }],
    undergroundLines: ["B"],
    summaryCodes: ["JK", "B"],
    defaultNameJa: "関内駅",
    defaultNameEn: "Kannai Station",
  },
  ishikawacho: {
    surfaceLines: [{ lineId: "jr-keihin-tohoku", stationNameEnMatch: "Ishikawacho" }],
    undergroundLines: [],
    summaryCodes: ["JK"],
    defaultNameJa: "石川町駅",
    defaultNameEn: "Ishikawacho Station",
  },
  kanagawa: {
    surfaceLines: [{ lineId: "keikyu-main", stationNameEnMatch: "Kanagawa" }],
    undergroundLines: [],
    summaryCodes: ["KK"],
    defaultNameJa: "神奈川駅",
    defaultNameEn: "Kanagawa Station",
  },
  tobe: {
    surfaceLines: [{ lineId: "keikyu-main", stationNameEnMatch: "Tobe" }],
    undergroundLines: [],
    summaryCodes: ["KK"],
    defaultNameJa: "戸部駅",
    defaultNameEn: "Tobe Station",
  },
  hinodecho: {
    surfaceLines: [{ lineId: "keikyu-main", stationNameEnMatch: "Hinodecho" }],
    undergroundLines: [],
    summaryCodes: ["KK"],
    defaultNameJa: "日ノ出町駅",
    defaultNameEn: "Hinodecho Station",
  },
  hiranumabashi: {
    surfaceLines: [{ lineId: "sotetsu-main", stationNameEnMatch: "Hiranumabashi" }],
    undergroundLines: [],
    summaryCodes: ["SO"],
    defaultNameJa: "平沼橋駅",
    defaultNameEn: "Hiranumabashi Station",
  },
  "shin-takashima": {
    surfaceLines: [],
    undergroundLines: ["MM"],
    summaryCodes: ["MM"],
    defaultNameJa: "新高島駅",
    defaultNameEn: "Shin-Takashima Station",
  },
  minatomirai: {
    surfaceLines: [],
    undergroundLines: ["MM"],
    summaryCodes: ["MM"],
    defaultNameJa: "みなとみらい駅",
    defaultNameEn: "Minatomirai Station",
  },
  bashamichi: {
    surfaceLines: [],
    undergroundLines: ["MM"],
    summaryCodes: ["MM"],
    defaultNameJa: "馬車道駅",
    defaultNameEn: "Bashamichi Station",
  },
  "nihon-odori": {
    surfaceLines: [],
    undergroundLines: ["MM"],
    summaryCodes: ["MM"],
    defaultNameJa: "日本大通り駅",
    defaultNameEn: "Nihon-odori Station",
  },
  "motomachi-chukagai": {
    surfaceLines: [],
    undergroundLines: ["MM"],
    summaryCodes: ["MM"],
    defaultNameJa: "元町・中華街駅",
    defaultNameEn: "Motomachi-Chukagai Station",
  },
  takashimacho: {
    surfaceLines: [],
    undergroundLines: ["B"],
    summaryCodes: ["B"],
    defaultNameJa: "高島町駅",
    defaultNameEn: "Takashimacho Station",
  },
  "isezaki-chojamachi": {
    surfaceLines: [],
    undergroundLines: ["B"],
    summaryCodes: ["B"],
    defaultNameJa: "伊勢佐木長者町駅",
    defaultNameEn: "Isezaki-chojamachi Station",
  },
  tammachi: {
    surfaceLines: [],
    undergroundLines: ["TY"],
    summaryCodes: ["TY"],
    defaultNameJa: "反町駅",
    defaultNameEn: "Tammachi Station",
  },
};

const STATION_ID_MAP: Record<string, CanonicalStationKey> = {
  "lm-yokohama-station": "yokohama",
  "cur-station-yokohama": "yokohama",
  "cur-station-sakuragicho": "sakuragicho",
  "cur-station-kannai": "kannai",
  "cur-station-ishikawacho": "ishikawacho",
  "cur-station-kanagawa": "kanagawa",
  "cur-station-tobe": "tobe",
  "cur-station-hinodecho": "hinodecho",
  "cur-station-hiranumabashi": "hiranumabashi",
  "cur-station-shin-takashima": "shin-takashima",
  "cur-station-minatomirai": "minatomirai",
  "cur-station-bashamichi": "bashamichi",
  "cur-station-nihon-odori": "nihon-odori",
  "cur-station-motomachi-chukagai": "motomachi-chukagai",
  "cur-station-takashimacho": "takashimacho",
  "cur-station-isezaki-chojamachi": "isezaki-chojamachi",
  "cur-station-tammachi": "tammachi",
};

const UNDERGROUND_LINE_META = {
  MM: {
    code: "MM",
    lineNameJa: "みなとみらい線",
    lineNameEn: "Minatomirai Line",
    colorHex: "#005bac",
    directions: [
      {
        dir: 0,
        destJa: "元町・中華街ゆき",
        destEn: "Motomachi-Chukagai",
        skipAt: "motomachi-chukagai",
        types: [
          { ja: "各駅停車", en: "Local" },
          { ja: "急行", en: "Express" },
          { ja: "特急 (Fライナー)", en: "F-Liner Ltd. Exp" },
        ],
      },
      {
        dir: 1,
        destJa: "横浜・渋谷・池袋方面",
        destEn: "Yokohama / Shibuya",
        skipAt: null,
        types: [
          { ja: "各駅停車", en: "Local" },
          { ja: "急行", en: "Express" },
          { ja: "特急 (S-TRAIN)", en: "Ltd. Express" },
        ],
      },
    ],
    stationOffsetsSec: {
      yokohama: 10,
      "shin-takashima": 55,
      minatomirai: 110,
      bashamichi: 165,
      "nihon-odori": 215,
      "motomachi-chukagai": 265,
    } as Record<string, number>,
  },
  B: {
    code: "B",
    lineNameJa: "横浜市営地下鉄ブルーライン",
    lineNameEn: "Yokohama Blue Line",
    colorHex: "#0070c0",
    directions: [
      {
        dir: 0,
        destJa: "湘南台方面（関内・戸塚）",
        destEn: "Shonandai / Totsuka",
        skipAt: null,
        types: [
          { ja: "普通", en: "Local" },
          { ja: "快速", en: "Rapid" },
        ],
      },
      {
        dir: 1,
        destJa: "あざみ野方面（新横浜）",
        destEn: "Azamino / Shin-Yokohama",
        skipAt: null,
        types: [
          { ja: "普通", en: "Local" },
          { ja: "快速", en: "Rapid" },
        ],
      },
    ],
    stationOffsetsSec: {
      yokohama: 25,
      takashimacho: 80,
      sakuragicho: 135,
      kannai: 190,
      "isezaki-chojamachi": 245,
    } as Record<string, number>,
  },
  TY: {
    code: "TY",
    lineNameJa: "東急東横線",
    lineNameEn: "Tokyu Toyoko Line",
    colorHex: "#da0442",
    directions: [
      {
        dir: 0,
        destJa: "横浜・元町・中華街方面",
        destEn: "Yokohama / Minatomirai",
        skipAt: null,
        types: [
          { ja: "各駅停車", en: "Local" },
          { ja: "急行", en: "Express" },
        ],
      },
      {
        dir: 1,
        destJa: "武蔵小杉・渋谷方面",
        destEn: "Musashi-Kosugi / Shibuya",
        skipAt: null,
        types: [
          { ja: "各駅停車", en: "Local" },
          { ja: "急行", en: "Express" },
        ],
      },
    ],
    stationOffsetsSec: {
      yokohama: 40,
      tammachi: 105,
    } as Record<string, number>,
  },
} as const;

function clamp(v: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, v));
}

function getJstParts(date: Date): { secOfDay: number; hourJst: number } {
  const jst = new Date(date.getTime() + 9 * 3600_000);
  const hourJst = jst.getUTCHours() + jst.getUTCMinutes() / 60;
  const secOfDay =
    jst.getUTCHours() * 3600 +
    jst.getUTCMinutes() * 60 +
    jst.getUTCSeconds() +
    jst.getUTCMilliseconds() / 1000;
  return { secOfDay, hourJst };
}

/**
 * Matches trainFeed.ts evaluateScheduledMotion piecewise-linear arrival timing
 * so departure countdowns align with the 3D trains pulling into platforms.
 */
function computeStopOffsetSec(
  line: RailLineTrack,
  targetDistM: number,
  tripRunSec: number,
  reverse: boolean,
): number {
  const interiorStops = line.stations.filter(
    (st) => st.distM > 40 && st.distM < line.totalDistM - 40,
  );
  const stopsOrdered = reverse ? [...interiorStops].reverse() : interiorStops;
  const dwell = Math.min(12, Math.max(4, line.dwellSec));
  const totalDwell = stopsOrdered.length * dwell;
  const moveSec = Math.max(12, tripRunSec - totalDwell);

  const targetFrac = reverse
    ? clamp(1 - targetDistM / line.totalDistM, 0, 1)
    : clamp(targetDistM / line.totalDistM, 0, 1);

  let curSec = 0;
  let prevFrac = 0;

  for (const st of stopsOrdered) {
    const fracAtStop = reverse
      ? 1 - st.distM / line.totalDistM
      : st.distM / line.totalDistM;
    const travelSec = (fracAtStop - prevFrac) * moveSec;

    if (targetFrac <= fracAtStop + 1e-4) {
      const spanFrac = Math.max(1e-5, fracAtStop - prevFrac);
      const u = clamp((targetFrac - prevFrac) / spanFrac, 0, 1);
      return curSec + u * travelSec;
    }
    curSec += travelSec + dwell;
    prevFrac = fracAtStop;
  }

  const remFrac = Math.max(1e-5, 1 - prevFrac);
  const u = clamp((targetFrac - prevFrac) / remFrac, 0, 1);
  return curSec + u * ((1 - prevFrac) * moveSec);
}

export function resolveCanonicalStationKey(
  id: string | undefined,
  nameJa?: string,
  nameEn?: string,
  category?: string,
): CanonicalStationKey | null {
  if (id && STATION_ID_MAP[id]) {
    return STATION_ID_MAP[id]!;
  }
  const combined = `${nameJa ?? ""} ${nameEn ?? ""}`.trim();
  const isStationLike =
    category === "station" ||
    id?.startsWith("cur-station-") ||
    /駅|\bStation\b/i.test(combined);
  if (!isStationLike) return null;

  for (const [key, profile] of Object.entries(STATION_PROFILES) as Array<
    [CanonicalStationKey, StationLineProfile]
  >) {
    if (
      (nameJa && nameJa.includes(profile.defaultNameJa)) ||
      (nameEn && nameEn.toLowerCase().includes(profile.defaultNameEn.toLowerCase()))
    ) {
      return key;
    }
  }
  return null;
}

export function isStationSelection(sel: SelectedEntity): boolean {
  if (!sel) return false;
  if (sel.kind === "landmark") {
    return (
      resolveCanonicalStationKey(
        sel.landmark.id,
        sel.landmark.nameJa,
        sel.landmark.nameEn,
        sel.landmark.category,
      ) !== null
    );
  }
  if (sel.kind === "poi") {
    return (
      resolveCanonicalStationKey(
        sel.poi.id,
        sel.poi.nameJa,
        sel.poi.nameEn,
        sel.poi.category,
      ) !== null
    );
  }
  if (sel.kind === "feature") {
    return (
      resolveCanonicalStationKey(
        sel.feature.poiId ?? sel.feature.landmarkId,
        sel.feature.nameJa,
        sel.feature.nameEn,
        sel.feature.category,
      ) !== null
    );
  }
  return false;
}

function getServiceTypeForSurfaceLine(lineId: RailLineId, slotK: number): { ja: string; en: string } {
  if (lineId === "jr-tokaido") {
    return slotK % 4 === 0 ? { ja: "快速アクティー", en: "Rapid Acty" } : { ja: "普通", en: "Local" };
  }
  if (lineId === "jr-yokosuka") {
    return slotK % 3 === 0
      ? { ja: "湘南新宿ライン", en: "Shonan-Shinjuku" }
      : { ja: "普通 (横須賀線)", en: "Yokosuka Local" };
  }
  if (lineId === "keikyu-main") {
    return slotK % 3 === 0 ? { ja: "快特", en: "Ltd. Express" } : { ja: "急行・普通", en: "Express / Local" };
  }
  if (lineId === "sotetsu-main") {
    return slotK % 3 === 0 ? { ja: "特急", en: "Ltd. Express" } : { ja: "各駅停車", en: "Local" };
  }
  return slotK % 2 === 0 ? { ja: "快速", en: "Rapid" } : { ja: "各駅停車", en: "Local" };
}

export function resolveStationDepartures(
  stationId: string | undefined,
  stationNameJa: string,
  stationNameEn: string,
  category: string | undefined,
  railBundle: YokohamaRailBundle | null,
  liveTrains: readonly ResolvedTrain[],
  simTimeSec: number,
  nowDate = new Date(),
  maxRows = 8,
): StationBoardResult | null {
  const key = resolveCanonicalStationKey(stationId, stationNameJa, stationNameEn, category);
  if (!key) return null;

  const profile = STATION_PROFILES[key];
  const simNowDate = new Date(nowDate.getTime() + simTimeSec * 1000);
  const { secOfDay, hourJst } = getJstParts(simNowDate);
  const jstClockSec = getJstParts(nowDate).secOfDay + simTimeSec;

  // Overnight service pause roughly 00:40 - 04:50 JST for normal commuter departures
  const isOvernightPause = hourJst >= 0.65 && hourJst < 4.85;

  const departures: StationDepartureRow[] = [];
  let hasLiveTelemetry = false;

  // 1. Surface Rail Corridors synchronized directly with trainFeed.ts & live ODPT telemetry
  if (railBundle && !isOvernightPause) {
    for (const ref of profile.surfaceLines) {
      const li = railBundle.lines.findIndex((l) => l.id === ref.lineId);
      if (li < 0) continue;
      const line = railBundle.lines[li]!;
      const stop = line.stations.find(
        (st) => st.nameEn.toLowerCase() === ref.stationNameEnMatch.toLowerCase(),
      );
      if (!stop) continue;

      const headway = clamp(line.headwaySec, 90, 360);
      const runSec = Math.max(
        70,
        line.totalDistM / Math.max(8, line.speedMps) +
          line.stations.length * Math.min(8, line.dwellSec * 0.5),
      );

      for (let dirIdx = 0; dirIdx < 2; dirIdx++) {
        const reverse = dirIdx === 1;
        // Skip Yokohama terminating arrivals on Sotetsu Main
        if (line.id === "sotetsu-main" && key === "yokohama" && reverse) {
          continue;
        }

        const dirLive = liveTrains.filter((tr) => tr.lineId === line.id && tr.mode === "observed");
        if (dirLive.length > 0) hasLiveTelemetry = true;
        const maxDelaySec = dirLive.reduce((acc, tr) => Math.max(acc, tr.delaySec || 0), 0);
        const delayMin = maxDelaySec >= 60 ? Math.round(maxDelaySec / 60) : 0;
        const mode: "observed" | "scheduled" = dirLive.length > 0 ? "observed" : "scheduled";

        const phaseOffset = li * 37 + dirIdx * (headway * 0.48);
        const stopOffsetSec = computeStopOffsetSec(line, stop.distM, runSec, reverse);
        const tShifted = jstClockSec + phaseOffset;
        const baseK = Math.ceil((tShifted - stopOffsetSec - 6) / headway);

        for (let step = 0; step < 2; step++) {
          const k = baseK + step;
          const depClockSec = k * headway - phaseOffset + stopOffsetSec + (delayMin > 0 ? maxDelaySec : 0);
          const secondsUntil = Math.max(0, Math.round(depClockSec - jstClockSec));
          const svc = getServiceTypeForSurfaceLine(line.id, Math.abs(k));
          const destJa = reverse ? line.outboundLabelJa : line.inboundLabelJa;
          const destEn = reverse ? line.outboundLabelEn : line.inboundLabelEn;

          departures.push({
            id: `${line.id}:${key}:${dirIdx}:${k}`,
            lineCode: line.code,
            lineNameJa: line.lineNameJa,
            lineNameEn: line.lineNameEn,
            lineColorHex: line.colorHex,
            destinationJa: destJa,
            destinationEn: destEn,
            trainTypeJa: svc.ja,
            trainTypeEn: svc.en,
            secondsUntil,
            minutesUntil: Math.floor(secondsUntil / 60),
            delayMin,
            mode,
          });
        }
      }
    }
  }

  // 2. Underground Metro / Tokyu Lines (MM, B, TY) using JST rush/off-peak headways
  if (!isOvernightPause) {
    const isRush = (hourJst >= 7.5 && hourJst <= 9.5) || (hourJst >= 17.5 && hourJst <= 20.5);
    const isDay = hourJst >= 6.5 && hourJst <= 22.5;

    for (const uCode of profile.undergroundLines) {
      const meta = UNDERGROUND_LINE_META[uCode];
      const baseHeadway =
        uCode === "B" ? (isRush ? 240 : isDay ? 360 : 480) : isRush ? 210 : isDay ? 300 : 480;
      const stOffset = meta.stationOffsetsSec[key] ?? 45;

      for (const dirCfg of meta.directions) {
        if (dirCfg.skipAt === key) continue;
        // Skip Shibuya/Yokohama terminating loop on MM toward Yokohama if terminal? No, Yokohama continues through Toyoko!
        const dirPhase = dirCfg.dir === 0 ? stOffset : baseHeadway * 0.48 + (280 - stOffset);
        const firstK = Math.ceil((secOfDay - dirPhase - 8) / baseHeadway);

        for (let step = 0; step < 2; step++) {
          const k = firstK + step;
          const depSec = k * baseHeadway + dirPhase;
          const secondsUntil = Math.max(0, Math.round(depSec - secOfDay));
          const svc = dirCfg.types[Math.abs(k) % dirCfg.types.length]!;

          departures.push({
            id: `${uCode}:${key}:${dirCfg.dir}:${k}`,
            lineCode: meta.code,
            lineNameJa: meta.lineNameJa,
            lineNameEn: meta.lineNameEn,
            lineColorHex: meta.colorHex,
            destinationJa: dirCfg.destJa,
            destinationEn: dirCfg.destEn,
            trainTypeJa: svc.ja,
            trainTypeEn: svc.en,
            secondsUntil,
            minutesUntil: Math.floor(secondsUntil / 60),
            delayMin: 0,
            mode: "scheduled",
          });
        }
      }
    }
  }

  departures.sort((a, b) => a.secondsUntil - b.secondsUntil || a.lineCode.localeCompare(b.lineCode));

  return {
    stationKey: key,
    stationNameJa: stationNameJa || profile.defaultNameJa,
    stationNameEn: stationNameEn || profile.defaultNameEn,
    linesSummary: [...profile.summaryCodes],
    hasLiveTelemetry,
    isOvernightPause,
    departures: departures.slice(0, maxRows),
  };
}
