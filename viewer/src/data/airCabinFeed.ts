export interface AirCabinTerminal {
  id: "sakuragicho" | "ungapark";
  nameJa: string;
  nameEn: string;
  lon: number;
  lat: number;
  elevM: number;
}

export interface AirCabinPylonSpec {
  id: string;
  t01: number;
  lon: number;
  lat: number;
  saddleElevM: number;
}

export interface ResolvedAirCabinGondola {
  id: string;
  cabinNumber: number;
  lon: number;
  lat: number;
  cableElevM: number;
  bearingDeg: number;
  direction: "to-ungapark" | "to-sakuragicho";
  directionJa: string;
  directionEn: string;
  sectionJa: string;
  sectionEn: string;
  progress01: number;
  speedKmh: number;
  etaSec: number;
}

export const AIR_CABIN_TERMINALS: Readonly<Record<"sakuragicho" | "ungapark", AirCabinTerminal>> = {
  sakuragicho: {
    id: "sakuragicho",
    nameJa: "桜木町駅（エアキャビン）",
    nameEn: "Sakuragicho Station (AIR CABIN)",
    lon: 139.631573,
    lat: 35.451535,
    elevM: 14.0,
  },
  ungapark: {
    id: "ungapark",
    nameJa: "運河パーク駅（エアキャビン）",
    nameEn: "Unga Park Station (AIR CABIN)",
    lon: 139.638491,
    lat: 35.453314,
    elevM: 13.0,
  },
};

export const AIR_CABIN_LATERAL_HALF_M = 3.0;
const AIR_CABIN_SPEED_MPS = 2.3;
const GONDOLAS_PER_DIRECTION = 8;

const S0 = AIR_CABIN_TERMINALS.sakuragicho;
const S1 = AIR_CABIN_TERMINALS.ungapark;
const MID_LAT_RAD = (((S0.lat + S1.lat) * 0.5) * Math.PI) / 180;
const M_PER_DEG_LAT = 111320;
const M_PER_DEG_LON = 111320 * Math.cos(MID_LAT_RAD);

const DX_M = (S1.lon - S0.lon) * M_PER_DEG_LON;
const DY_M = (S1.lat - S0.lat) * M_PER_DEG_LAT;
export const AIR_CABIN_SPAN_M = Math.hypot(DX_M, DY_M);
export const AIR_CABIN_FORWARD_BEARING_DEG =
  ((Math.atan2(DX_M, DY_M) * 180) / Math.PI + 360) % 360;

// Unit right-hand perpendicular to Sakuragicho -> Unga Park axis (in local E, N meters)
const AXIS_E = DX_M / AIR_CABIN_SPAN_M;
const AXIS_N = DY_M / AIR_CABIN_SPAN_M;
const PERP_E = AXIS_N;
const PERP_N = -AXIS_E;

export const AIR_CABIN_PYLONS: readonly AirCabinPylonSpec[] = [
  { t01: 0.16, saddleElevM: 25.0 },
  { t01: 0.4, saddleElevM: 35.0 },
  { t01: 0.65, saddleElevM: 36.0 },
  { t01: 0.86, saddleElevM: 26.0 },
].map((p, idx) => ({
  id: `pylon-${idx + 1}`,
  t01: p.t01,
  lon: S0.lon + (S1.lon - S0.lon) * p.t01,
  lat: S0.lat + (S1.lat - S0.lat) * p.t01,
  saddleElevM: p.saddleElevM,
}));

const CONTROL_NODES: ReadonlyArray<{ t: number; elevM: number }> = [
  { t: 0, elevM: S0.elevM },
  ...AIR_CABIN_PYLONS.map((p) => ({ t: p.t01, elevM: p.saddleElevM })),
  { t: 1, elevM: S1.elevM },
];

function clamp(v: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, v));
}

export function sampleAirCabinCable(
  rawT: number,
  lateralM = 0,
): { lon: number; lat: number; cableElevM: number; bearingDeg: number } {
  const t = clamp(rawT, 0, 1);
  let idx = 0;
  while (idx < CONTROL_NODES.length - 2 && CONTROL_NODES[idx + 1]!.t < t) {
    idx++;
  }
  const a = CONTROL_NODES[idx]!;
  const b = CONTROL_NODES[idx + 1]!;
  const spanT = Math.max(1e-5, b.t - a.t);
  const localU = clamp((t - a.t) / spanT, 0, 1);
  // Subtle realistic catenary sag between towers without dropping into water/buildings
  const sagM = 1.25 * 4 * localU * (1 - localU) * Math.min(1, spanT / 0.22);
  const cableElevM = a.elevM + (b.elevM - a.elevM) * localU - sagM;

  const lon = S0.lon + (S1.lon - S0.lon) * t + (PERP_E * lateralM) / M_PER_DEG_LON;
  const lat = S0.lat + (S1.lat - S0.lat) * t + (PERP_N * lateralM) / M_PER_DEG_LAT;

  return {
    lon,
    lat,
    cableElevM,
    bearingDeg: AIR_CABIN_FORWARD_BEARING_DEG,
  };
}

export function resolveAirCabinForFrame(
  simTimeSec: number,
  nowDate = new Date(),
): ResolvedAirCabinGondola[] {
  const oneWaySec = AIR_CABIN_SPAN_M / AIR_CABIN_SPEED_MPS;
  const speedKmh = Math.round(AIR_CABIN_SPEED_MPS * 3.6 * 10) / 10;
  // Combine wall-clock UTC seconds + simTimeSec so motion advances monotonically with simTimeSec
  const basePhase = ((nowDate.getTime() / 1000) % 86400) + simTimeSec;
  const cycle01 = ((basePhase / oneWaySec) % 1 + 1) % 1;

  const gondolas: ResolvedAirCabinGondola[] = [];

  for (let i = 0; i < GONDOLAS_PER_DIRECTION; i++) {
    const tOut = (i / GONDOLAS_PER_DIRECTION + cycle01) % 1;
    const pOut = sampleAirCabinCable(tOut, AIR_CABIN_LATERAL_HALF_M);
    gondolas.push({
      id: `aircabin-${String(i + 1).padStart(2, "0")}`,
      cabinNumber: i + 1,
      lon: pOut.lon,
      lat: pOut.lat,
      cableElevM: pOut.cableElevM,
      bearingDeg: AIR_CABIN_FORWARD_BEARING_DEG,
      direction: "to-ungapark",
      directionJa: "運河パーク駅ゆき",
      directionEn: "Bound for Unga Park",
      sectionJa: "桜木町駅 → 運河パーク駅",
      sectionEn: "Sakuragicho -> Unga Park",
      progress01: tOut,
      speedKmh,
      etaSec: Math.max(0, Math.round((1 - tOut) * oneWaySec)),
    });
  }

  for (let i = 0; i < GONDOLAS_PER_DIRECTION; i++) {
    const progressIn = (i / GONDOLAS_PER_DIRECTION + cycle01) % 1;
    const tCable = 1 - progressIn;
    const pIn = sampleAirCabinCable(tCable, -AIR_CABIN_LATERAL_HALF_M);
    const cabinNo = GONDOLAS_PER_DIRECTION + i + 1;
    gondolas.push({
      id: `aircabin-${String(cabinNo).padStart(2, "0")}`,
      cabinNumber: cabinNo,
      lon: pIn.lon,
      lat: pIn.lat,
      cableElevM: pIn.cableElevM,
      bearingDeg: (AIR_CABIN_FORWARD_BEARING_DEG + 180) % 360,
      direction: "to-sakuragicho",
      directionJa: "桜木町駅ゆき",
      directionEn: "Bound for Sakuragicho",
      sectionJa: "運河パーク駅 → 桜木町駅",
      sectionEn: "Unga Park -> Sakuragicho",
      progress01: progressIn,
      speedKmh,
      etaSec: Math.max(0, Math.round((1 - progressIn) * oneWaySec)),
    });
  }

  return gondolas;
}
