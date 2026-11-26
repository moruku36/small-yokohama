export type PlaneMeshKind = "heavyJet" | "narrowJet" | "heli";

export interface LivePlaneRecord {
  icao: string;
  callsign: string;
  registration: string;
  aircraftType: string;
  category: string;
  lat: number;
  lon: number;
  altitudeFt: number;
  altitudeM: number;
  groundSpeedKt: number;
  trackDeg: number;
  verticalRateFpm: number;
  seenSec: number;
  observedAt: string;
}

export interface LivePlaneApiPayload {
  mode: "observed" | "scheduled";
  upstreamOk?: boolean;
  sourceJa: string;
  sourceEn: string;
  fetchedAt: string;
  nearbyCount: number;
  planes: LivePlaneRecord[];
}

export interface ResolvedPlane {
  id: string;
  callsign: string;
  airlineJa: string;
  airlineEn: string;
  registration: string;
  aircraftType: string;
  meshKind: PlaneMeshKind;
  mode: "observed" | "scheduled";
  lon: number;
  lat: number;
  altitudeM: number;
  altitudeFt: number;
  displayElevM: number;
  groundSpeedKt: number;
  groundSpeedKmh: number;
  trackDeg: number;
  verticalRateFpm: number;
  sourceJa: string;
  sourceEn: string;
  nearbyCount: number;
  observedAt: string;
}

const AIRLINE_PREFIXES: Record<string, { ja: string; en: string }> = {
  ANA: { ja: "全日本空輸 (ANA)", en: "All Nippon Airways (ANA)" },
  JAL: { ja: "日本航空 (JAL)", en: "Japan Airlines (JAL)" },
  SKY: { ja: "スカイマーク", en: "Skymark Airlines" },
  ADO: { ja: "AIRDO", en: "AIRDO" },
  SNJ: { ja: "ソラシドエア", en: "Solaseed Air" },
  SFJ: { ja: "スターフライヤー", en: "StarFlyer" },
  APJ: { ja: "Peach Aviation", en: "Peach Aviation" },
  JJP: { ja: "ジェットスター・ジャパン", en: "Jetstar Japan" },
  JTA: { ja: "日本トランスオーシャン航空", en: "Japan Transocean Air" },
  FDA: { ja: "フジドリームエアラインズ", en: "Fuji Dream Airlines" },
  IBX: { ja: "IBEXエアラインズ", en: "IBEX Airlines" },
  UAL: { ja: "ユナイテッド航空", en: "United Airlines" },
  DAL: { ja: "デルタ航空", en: "Delta Air Lines" },
  AAL: { ja: "アメリカン航空", en: "American Airlines" },
  CPA: { ja: "キャセイパシフィック航空", en: "Cathay Pacific" },
  KAL: { ja: "大韓航空", en: "Korean Air" },
  AAR: { ja: "アシアナ航空", en: "Asiana Airlines" },
  EVA: { ja: "エバー航空", en: "EVA Air" },
  CAL: { ja: "チャイナエアライン", en: "China Airlines" },
  SIA: { ja: "シンガポール航空", en: "Singapore Airlines" },
  DLH: { ja: "ルフトハンザ航空", en: "Lufthansa" },
  BAW: { ja: "ブリティッシュ・エアウェイズ", en: "British Airways" },
  AFR: { ja: "エールフランス航空", en: "Air France" },
  QFA: { ja: "カンタス航空", en: "Qantas" },
  ANZ: { ja: "ニュージーランド航空", en: "Air New Zealand" },
  THA: { ja: "タイ国際航空", en: "Thai Airways" },
  JCG: { ja: "海上保安庁", en: "Japan Coast Guard" },
};

const YOKOHAMA_AIRSPACE = {
  minLon: 139.58,
  maxLon: 139.69,
  minLat: 35.408,
  maxLat: 35.496,
};

function clamp(v: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, v));
}

export function classifyPlaneMesh(aircraftType: string, category = ""): PlaneMeshKind {
  const cat = category.trim().toUpperCase();
  const t = aircraftType.trim().toUpperCase();
  if (
    cat === "A7" ||
    /^(EC|AS3|AW1|B06|B407|B412|B429|S76|S92|R44|R66|H1|H2|BK11|UH|CH47|BELL|MD52|MD90)/.test(
      t,
    )
  ) {
    return "heli";
  }
  if (
    cat === "A5" ||
    /^(B74|B76|B77|B78|A33|A34|A35|A38|MD11|DC10)/.test(t)
  ) {
    return "heavyJet";
  }
  return "narrowJet";
}

export function resolveAirline(
  callsign: string,
  meshKind: PlaneMeshKind,
): { ja: string; en: string } {
  const upper = callsign.trim().toUpperCase();
  const prefix = upper.slice(0, 3);
  if (AIRLINE_PREFIXES[prefix]) {
    return AIRLINE_PREFIXES[prefix]!;
  }
  if (upper.startsWith("JA")) {
    return meshKind === "heli"
      ? { ja: "横浜遊覧ヘリ・航空機", en: "Yokohama Bay Helicopter" }
      : { ja: "民間登録機 (日本)", en: "General Aviation (Japan)" };
  }
  return meshKind === "heli"
    ? { ja: "ヘリコプター", en: "Helicopter" }
    : { ja: "民間航空機", en: "Commercial Aircraft" };
}

export function computePlaneDisplayElevM(altitudeM: number, meshKind: PlaneMeshKind): number {
  if (meshKind === "heli") {
    return clamp(100 + (altitudeM / 1200) * 55, 95, 160);
  }
  return clamp(155 + (altitudeM / 3500) * 90, 145, 248);
}

function advanceCoords(
  lon: number,
  lat: number,
  trackDeg: number,
  distM: number,
): { lon: number; lat: number } {
  const rad = (trackDeg * Math.PI) / 180;
  const latRad = (lat * Math.PI) / 180;
  const dLat = (distM * Math.cos(rad)) / 111320;
  const dLon = (distM * Math.sin(rad)) / (111320 * Math.cos(latRad));
  return { lon: lon + dLon, lat: lat + dLat };
}

function normalizeClientRawAdsb(
  rawJson: { ac?: Array<Record<string, unknown>> },
  nowMs: number,
): LivePlaneApiPayload {
  const list = Array.isArray(rawJson?.ac) ? rawJson.ac : [];
  let nearbyCount = 0;
  const planes: LivePlaneRecord[] = [];
  const seen = new Set<string>();

  for (const ac of list) {
    const lat = ac.lat;
    const lon = ac.lon;
    const gs = typeof ac.gs === "number" ? ac.gs : 0;
    if (typeof lat !== "number" || typeof lon !== "number" || !Number.isFinite(lat) || !Number.isFinite(lon)) {
      continue;
    }
    if (ac.alt_baro === "ground" || gs <= 20) continue;
    const altFt =
      typeof ac.alt_baro === "number"
        ? ac.alt_baro
        : typeof ac.alt_geom === "number"
          ? ac.alt_geom
          : null;
    if (altFt === null || !Number.isFinite(altFt) || altFt < 120) continue;

    const seenSec = Math.max(
      0,
      typeof ac.seen_pos === "number"
        ? ac.seen_pos
        : typeof ac.seen === "number"
          ? ac.seen
          : 0,
    );
    if (seenSec > 45) continue;

    const icao = typeof ac.hex === "string" ? ac.hex.trim().toLowerCase() : "";
    if (!icao || seen.has(icao)) continue;
    seen.add(icao);
    nearbyCount++;

    if (lon < 139.585 || lon > 139.685 || lat < 35.412 || lat > 35.492) continue;

    const flight = typeof ac.flight === "string" ? ac.flight.trim() : "";
    const reg = typeof ac.r === "string" ? ac.r.trim() : "";
    const callsign = flight || reg || icao.toUpperCase();
    const trackDeg = typeof ac.track === "number" && Number.isFinite(ac.track) ? ((ac.track % 360) + 360) % 360 : 0;
    const vRate =
      typeof ac.baro_rate === "number"
        ? Math.round(ac.baro_rate)
        : typeof ac.geom_rate === "number"
          ? Math.round(ac.geom_rate)
          : 0;

    planes.push({
      icao,
      callsign,
      registration: reg,
      aircraftType: typeof ac.t === "string" ? ac.t.trim().toUpperCase() : "",
      category: typeof ac.category === "string" ? ac.category.trim().toUpperCase() : "",
      lat,
      lon,
      altitudeFt: Math.round(altFt),
      altitudeM: Math.round(altFt * 0.3048),
      groundSpeedKt: Math.round(gs),
      trackDeg,
      verticalRateFpm: vRate,
      seenSec,
      observedAt: new Date(nowMs - seenSec * 1000).toISOString(),
    });
  }

  return {
    mode: planes.length > 0 ? "observed" : "scheduled",
    upstreamOk: true,
    sourceJa:
      planes.length > 0
        ? "ADS-B 実測フライト（横浜上空）"
        : "羽田発着ルート・横浜遊覧（上空待機なし・時刻表推定）",
    sourceEn:
      planes.length > 0
        ? "Live ADS-B Flight Telemetry"
        : "Haneda Approach / Bay Heli (Scheduled)",
    fetchedAt: new Date(nowMs).toISOString(),
    nearbyCount,
    planes,
  };
}

export async function fetchLivePlanesApi(): Promise<LivePlaneApiPayload | null> {
  try {
    const res = await fetch("/api/planes", { cache: "no-store" });
    if (res.ok) {
      const json = (await res.json()) as LivePlaneApiPayload;
      if (json && Array.isArray(json.planes)) {
        return json;
      }
    }
  } catch {
    // try direct browser ADS-B fallback for local Vite dev without serverless functions
  }

  try {
    const res = await fetch("https://api.adsb.lol/v2/point/35.453/139.635/15", {
      cache: "no-store",
    });
    if (!res.ok) return null;
    const raw = (await res.json()) as { ac?: Array<Record<string, unknown>> };
    return normalizeClientRawAdsb(raw, Date.now());
  } catch {
    return null;
  }
}

function buildScheduledFallbackPlanes(
  simTimeSec: number,
  wallNowMs: number,
  nearbyCount: number,
): ResolvedPlane[] {
  const tSec = ((wallNowMs / 1000) % 86400) + simTimeSec;
  const obsIso = new Date(wallNowMs).toISOString();
  const sourceJa = "羽田発着ルート・横浜遊覧（時刻表推定）";
  const sourceEn = "Haneda Approach / Bay Heli (Scheduled)";

  // 1. Haneda 34L Bay Approach SW -> NE over Yokohama waterfront / Tokyo Bay
  const p1U = ((tSec * 0.011 + 0.12) % 1 + 1) % 1;
  const p1Lon = 139.605 + (139.678 - 139.605) * p1U;
  const p1Lat = 35.424 + (35.482 - 35.424) * p1U;
  const p1AltM = Math.round(1620 - 380 * p1U);

  // 2. Haneda South Arrival NW -> SE across Minato Mirai / Bay
  const p2U = ((tSec * 0.009 + 0.56) % 1 + 1) % 1;
  const p2Lon = 139.596 + (139.676 - 139.596) * p2U;
  const p2Lat = 35.481 + (35.428 - 35.481) * p2U;
  const p2AltM = Math.round(2050 - 420 * p2U);

  // 3. Yokohama Bay Sightseeing Helicopter loop off Minato Mirai & Osanbashi
  const heliTheta = (tSec * 0.045) % (Math.PI * 2);
  const hCos = Math.cos(heliTheta);
  const hSin = Math.sin(heliTheta);
  const hLon = 139.647 + 0.014 * hCos;
  const hLat = 35.451 + 0.009 * hSin;
  // Derivative along ellipse: dLon/dTheta = -0.014 sin, dLat/dTheta = +0.009 cos
  const vx = -0.014 * Math.sin(heliTheta) * 90700;
  const vy = 0.009 * Math.cos(heliTheta) * 111320;
  const hTrack = ((Math.atan2(vx, vy) * 180) / Math.PI + 360) % 360;
  const hAltM = 420;

  return [
    {
      id: "sched-ana-hnd",
      callsign: "ANA-HND",
      airlineJa: AIRLINE_PREFIXES.ANA!.ja,
      airlineEn: AIRLINE_PREFIXES.ANA!.en,
      registration: "JA899A",
      aircraftType: "B789",
      meshKind: "heavyJet",
      mode: "scheduled",
      lon: p1Lon,
      lat: p1Lat,
      altitudeM: p1AltM,
      altitudeFt: Math.round(p1AltM / 0.3048),
      displayElevM: computePlaneDisplayElevM(p1AltM, "heavyJet"),
      groundSpeedKt: 235,
      groundSpeedKmh: Math.round(235 * 1.852),
      trackDeg: 45.2,
      verticalRateFpm: -750,
      sourceJa,
      sourceEn,
      nearbyCount,
      observedAt: obsIso,
    },
    {
      id: "sched-jal-hnd",
      callsign: "JAL-HND",
      airlineJa: AIRLINE_PREFIXES.JAL!.ja,
      airlineEn: AIRLINE_PREFIXES.JAL!.en,
      registration: "JA08XJ",
      aircraftType: "A359",
      meshKind: "heavyJet",
      mode: "scheduled",
      lon: p2Lon,
      lat: p2Lat,
      altitudeM: p2AltM,
      altitudeFt: Math.round(p2AltM / 0.3048),
      displayElevM: computePlaneDisplayElevM(p2AltM, "heavyJet"),
      groundSpeedKt: 242,
      groundSpeedKmh: Math.round(242 * 1.852),
      trackDeg: 130.6,
      verticalRateFpm: -820,
      sourceJa,
      sourceEn,
      nearbyCount,
      observedAt: obsIso,
    },
    {
      id: "sched-ja01yk",
      callsign: "JA01YK",
      airlineJa: "横浜スカイクルーズ",
      airlineEn: "Yokohama Sky Cruise",
      registration: "JA01YK",
      aircraftType: "EC35",
      meshKind: "heli",
      mode: "scheduled",
      lon: hLon,
      lat: hLat,
      altitudeM: hAltM,
      altitudeFt: Math.round(hAltM / 0.3048),
      displayElevM: computePlaneDisplayElevM(hAltM, "heli"),
      groundSpeedKt: 88,
      groundSpeedKmh: Math.round(88 * 1.852),
      trackDeg: Math.round(hTrack * 10) / 10,
      verticalRateFpm: 0,
      sourceJa,
      sourceEn,
      nearbyCount,
      observedAt: obsIso,
    },
  ];
}

export function resolvePlanesForFrame(
  liveApi: LivePlaneApiPayload | null,
  simTimeSec: number,
  wallNowMs = Date.now(),
): ResolvedPlane[] {
  const nearbyCount = liveApi?.nearbyCount ?? 0;

  if (liveApi && liveApi.planes.length > 0) {
    const out: ResolvedPlane[] = [];
    for (const p of liveApi.planes) {
      const obsMs = Date.parse(p.observedAt);
      const dt = Number.isFinite(obsMs)
        ? clamp((wallNowMs - obsMs) / 1000, 0, 35)
        : 0;
      const speedMps = Math.max(0, p.groundSpeedKt) * 0.514444;
      const moved = dt > 0 && speedMps > 0
        ? advanceCoords(p.lon, p.lat, p.trackDeg, speedMps * dt)
        : { lon: p.lon, lat: p.lat };

      if (
        moved.lon < YOKOHAMA_AIRSPACE.minLon ||
        moved.lon > YOKOHAMA_AIRSPACE.maxLon ||
        moved.lat < YOKOHAMA_AIRSPACE.minLat ||
        moved.lat > YOKOHAMA_AIRSPACE.maxLat
      ) {
        continue;
      }

      const meshKind = classifyPlaneMesh(p.aircraftType, p.category);
      const airline = resolveAirline(p.callsign, meshKind);
      const altitudeM = clamp(Math.round(p.altitudeM + p.verticalRateFpm * 0.00508 * dt), 40, 14000);

      out.push({
        id: `adsb-${p.icao}`,
        callsign: p.callsign,
        airlineJa: airline.ja,
        airlineEn: airline.en,
        registration: p.registration,
        aircraftType: p.aircraftType || (meshKind === "heli" ? "HELI" : "JET"),
        meshKind,
        mode: "observed",
        lon: moved.lon,
        lat: moved.lat,
        altitudeM,
        altitudeFt: Math.round(altitudeM / 0.3048),
        displayElevM: computePlaneDisplayElevM(altitudeM, meshKind),
        groundSpeedKt: p.groundSpeedKt,
        groundSpeedKmh: Math.round(p.groundSpeedKt * 1.852),
        trackDeg: p.trackDeg,
        verticalRateFpm: p.verticalRateFpm,
        sourceJa: liveApi.sourceJa,
        sourceEn: liveApi.sourceEn,
        nearbyCount,
        observedAt: p.observedAt,
      });
    }

    if (out.length > 0) {
      return out;
    }
  }

  return buildScheduledFallbackPlanes(simTimeSec, wallNowMs, nearbyCount);
}
