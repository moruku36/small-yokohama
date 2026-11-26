const ADSB_UPSTREAMS = [
  "https://api.adsb.lol/v2/point/35.453/139.635/15",
  "https://opendata.adsb.fi/api/v2/lat/35.453/lon/139.635/dist/15",
];

const YOKOHAMA_AIRSPACE_BBOX = {
  minLon: 139.585,
  maxLon: 139.685,
  minLat: 35.412,
  maxLat: 35.492,
};

function isInYokohamaAirspace(lon, lat) {
  return (
    typeof lon === "number" &&
    typeof lat === "number" &&
    Number.isFinite(lon) &&
    Number.isFinite(lat) &&
    lon >= YOKOHAMA_AIRSPACE_BBOX.minLon &&
    lon <= YOKOHAMA_AIRSPACE_BBOX.maxLon &&
    lat >= YOKOHAMA_AIRSPACE_BBOX.minLat &&
    lat <= YOKOHAMA_AIRSPACE_BBOX.maxLat
  );
}

function normalizeAdsbAircraft(ac, nowMs = Date.now()) {
  if (!ac || typeof ac.lat !== "number" || typeof ac.lon !== "number") return null;
  if (!Number.isFinite(ac.lat) || !Number.isFinite(ac.lon)) return null;
  if (ac.alt_baro === "ground") return null;

  const gs = typeof ac.gs === "number" && Number.isFinite(ac.gs) ? ac.gs : 0;
  if (gs <= 20) return null;

  const altitudeFt =
    typeof ac.alt_baro === "number" && Number.isFinite(ac.alt_baro)
      ? ac.alt_baro
      : typeof ac.alt_geom === "number" && Number.isFinite(ac.alt_geom)
        ? ac.alt_geom
        : null;
  if (altitudeFt === null || altitudeFt < 120) return null;

  const rawSeen =
    typeof ac.seen_pos === "number" && Number.isFinite(ac.seen_pos)
      ? ac.seen_pos
      : typeof ac.seen === "number" && Number.isFinite(ac.seen)
        ? ac.seen
        : 0;
  const seenSec = Math.max(0, rawSeen);
  if (seenSec > 45) return null;

  const icao = typeof ac.hex === "string" ? ac.hex.trim().toLowerCase() : "";
  if (!icao) return null;

  const flight = typeof ac.flight === "string" ? ac.flight.trim() : "";
  const reg = typeof ac.r === "string" ? ac.r.trim() : "";
  const callsign = flight || reg || icao.toUpperCase();
  const trackDeg =
    typeof ac.track === "number" && Number.isFinite(ac.track)
      ? ((ac.track % 360) + 360) % 360
      : 0;
  const verticalRateFpm =
    typeof ac.baro_rate === "number" && Number.isFinite(ac.baro_rate)
      ? Math.round(ac.baro_rate)
      : typeof ac.geom_rate === "number" && Number.isFinite(ac.geom_rate)
        ? Math.round(ac.geom_rate)
        : 0;

  return {
    icao,
    callsign,
    registration: reg,
    aircraftType: typeof ac.t === "string" ? ac.t.trim().toUpperCase() : "",
    category: typeof ac.category === "string" ? ac.category.trim().toUpperCase() : "",
    lat: Math.round(ac.lat * 1e6) / 1e6,
    lon: Math.round(ac.lon * 1e6) / 1e6,
    altitudeFt: Math.round(altitudeFt),
    altitudeM: Math.round(altitudeFt * 0.3048),
    groundSpeedKt: Math.round(gs),
    trackDeg: Math.round(trackDeg * 10) / 10,
    verticalRateFpm,
    seenSec: Math.round(seenSec * 10) / 10,
    observedAt: new Date(nowMs - seenSec * 1000).toISOString(),
  };
}

function filterAdsbResponse(rawJson, nowMs = Date.now()) {
  const list = rawJson && Array.isArray(rawJson.ac) ? rawJson.ac : [];
  let nearbyCount = 0;
  const planes = [];
  const seen = new Set();

  for (const row of list) {
    const norm = normalizeAdsbAircraft(row, nowMs);
    if (!norm || seen.has(norm.icao)) continue;
    seen.add(norm.icao);
    nearbyCount++;
    if (isInYokohamaAirspace(norm.lon, norm.lat)) {
      planes.push(norm);
    }
  }

  planes.sort((a, b) => a.altitudeFt - b.altitudeFt || a.callsign.localeCompare(b.callsign));
  return {
    nearbyCount,
    planes: planes.slice(0, 24),
  };
}

async function fetchLiveAdsb() {
  for (const url of ADSB_UPSTREAMS) {
    try {
      const res = await fetch(url, {
        headers: {
          Accept: "application/json",
          "User-Agent": "small-yokohama/1.0",
        },
        signal: AbortSignal.timeout(4500),
      });
      if (!res.ok) continue;
      const json = await res.json();
      if (json && Array.isArray(json.ac)) {
        return json;
      }
    } catch {
      // try next mirror
    }
  }
  return null;
}

async function handler(_req, res) {
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "public, s-maxage=10, stale-while-revalidate=20");

  const nowMs = Date.now();
  const fetchedAt = new Date(nowMs).toISOString();

  try {
    const raw = await fetchLiveAdsb();
    if (raw) {
      const { nearbyCount, planes } = filterAdsbResponse(raw, nowMs);
      res.statusCode = 200;
      res.end(
        JSON.stringify({
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
          fetchedAt,
          nearbyCount,
          planes,
        }),
      );
      return;
    }
  } catch {
    // Graceful fallback when upstream ADS-B fails
  }

  res.statusCode = 200;
  res.end(
    JSON.stringify({
      mode: "scheduled",
      upstreamOk: false,
      sourceJa: "羽田発着ルート・横浜遊覧（時刻表推定）",
      sourceEn: "Haneda Approach / Bay Heli (Scheduled)",
      fetchedAt,
      nearbyCount: 0,
      planes: [],
    }),
  );
}

handler.normalizeAdsbAircraft = normalizeAdsbAircraft;
handler.isInYokohamaAirspace = isInYokohamaAirspace;
handler.filterAdsbResponse = filterAdsbResponse;

module.exports = handler;
