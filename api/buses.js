const crypto = require("node:crypto");

const ODPT_BUS_RT_BASES = [
  "https://api.odpt.org/api/v4/gtfs/realtime/yokohamamunicipal_vehicle_position",
  "https://api-challenge.odpt.org/api/v4/gtfs/realtime/yokohamamunicipal_vehicle_position",
];

const YOKOHAMA_BUS_BBOX = {
  minLon: 139.595,
  maxLon: 139.675,
  minLat: 35.42,
  maxLat: 35.485,
};

function readVarint(buf, state) {
  let result = 0n;
  let shift = 0n;
  while (state.pos < buf.length) {
    const byte = buf[state.pos++];
    result |= BigInt(byte & 0x7f) << shift;
    if ((byte & 0x80) === 0) {
      return result <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(result) : Number(result & 0xffffffffn);
    }
    shift += 7n;
    if (shift > 63n) {
      throw new Error("Protobuf varint overflow");
    }
  }
  throw new Error("Truncated protobuf varint");
}

function skipField(buf, state, wireType) {
  if (wireType === 0) {
    readVarint(buf, state);
  } else if (wireType === 1) {
    state.pos = Math.min(buf.length, state.pos + 8);
  } else if (wireType === 2) {
    const len = readVarint(buf, state);
    state.pos = Math.min(buf.length, state.pos + Math.max(0, len));
  } else if (wireType === 5) {
    state.pos = Math.min(buf.length, state.pos + 4);
  } else {
    throw new Error(`Unsupported protobuf wire type: ${wireType}`);
  }
}

function readBytesSlice(buf, state) {
  const len = readVarint(buf, state);
  if (len < 0 || state.pos + len > buf.length) {
    throw new Error("Truncated protobuf length-delimited field");
  }
  const slice = buf.subarray(state.pos, state.pos + len);
  state.pos += len;
  return slice;
}

function decodeTripDescriptor(buf) {
  const state = { pos: 0 };
  const out = { tripId: null, routeId: null, directionId: null };
  while (state.pos < buf.length) {
    const tag = readVarint(buf, state);
    const field = tag >>> 3;
    const wire = tag & 0x7;
    if (field === 1 && wire === 2) {
      out.tripId = readBytesSlice(buf, state).toString("utf8") || null;
    } else if (field === 5 && wire === 2) {
      out.routeId = readBytesSlice(buf, state).toString("utf8") || null;
    } else if (field === 6 && wire === 0) {
      out.directionId = readVarint(buf, state);
    } else {
      skipField(buf, state, wire);
    }
  }
  return out;
}

function decodePosition(buf) {
  const state = { pos: 0 };
  const out = { latitude: null, longitude: null, bearing: null, speed: null };
  while (state.pos < buf.length) {
    const tag = readVarint(buf, state);
    const field = tag >>> 3;
    const wire = tag & 0x7;
    if ((field === 1 || field === 2 || field === 3 || field === 5) && wire === 5) {
      if (state.pos + 4 > buf.length) throw new Error("Truncated float32 field");
      const val = buf.readFloatLE(state.pos);
      state.pos += 4;
      if (field === 1) out.latitude = val;
      else if (field === 2) out.longitude = val;
      else if (field === 3) out.bearing = val;
      else if (field === 5) out.speed = val;
    } else {
      skipField(buf, state, wire);
    }
  }
  return out;
}

function decodeVehicleDescriptor(buf) {
  const state = { pos: 0 };
  const out = { id: null, label: null };
  while (state.pos < buf.length) {
    const tag = readVarint(buf, state);
    const field = tag >>> 3;
    const wire = tag & 0x7;
    if (field === 1 && wire === 2) {
      out.id = readBytesSlice(buf, state).toString("utf8") || null;
    } else if (field === 2 && wire === 2) {
      out.label = readBytesSlice(buf, state).toString("utf8") || null;
    } else {
      skipField(buf, state, wire);
    }
  }
  return out;
}

function decodeVehiclePosition(buf) {
  const state = { pos: 0 };
  const out = {
    trip: null,
    position: null,
    timestamp: null,
    vehicle: null,
  };
  while (state.pos < buf.length) {
    const tag = readVarint(buf, state);
    const field = tag >>> 3;
    const wire = tag & 0x7;
    if (field === 1 && wire === 2) {
      out.trip = decodeTripDescriptor(readBytesSlice(buf, state));
    } else if (field === 2 && wire === 2) {
      out.position = decodePosition(readBytesSlice(buf, state));
    } else if (field === 5 && wire === 0) {
      out.timestamp = readVarint(buf, state);
    } else if (field === 8 && wire === 2) {
      out.vehicle = decodeVehicleDescriptor(readBytesSlice(buf, state));
    } else {
      skipField(buf, state, wire);
    }
  }
  return out;
}

function decodeFeedHeader(buf) {
  const state = { pos: 0 };
  let timestamp = null;
  while (state.pos < buf.length) {
    const tag = readVarint(buf, state);
    const field = tag >>> 3;
    const wire = tag & 0x7;
    if (field === 3 && wire === 0) {
      timestamp = readVarint(buf, state);
    } else {
      skipField(buf, state, wire);
    }
  }
  return { timestamp };
}

function decodeFeedEntity(buf) {
  const state = { pos: 0 };
  let id = "";
  let vehicle = null;
  while (state.pos < buf.length) {
    const tag = readVarint(buf, state);
    const field = tag >>> 3;
    const wire = tag & 0x7;
    if (field === 1 && wire === 2) {
      id = readBytesSlice(buf, state).toString("utf8");
    } else if (field === 4 && wire === 2) {
      vehicle = decodeVehiclePosition(readBytesSlice(buf, state));
    } else {
      skipField(buf, state, wire);
    }
  }
  return { id, vehicle };
}

function decodeGtfsRtVehiclePositions(input) {
  const buf = Buffer.isBuffer(input) ? input : Buffer.from(input);
  const state = { pos: 0 };
  let headerTimestamp = null;
  const reports = [];

  while (state.pos < buf.length) {
    const tag = readVarint(buf, state);
    const field = tag >>> 3;
    const wire = tag & 0x7;
    if (field === 1 && wire === 2) {
      const hdr = decodeFeedHeader(readBytesSlice(buf, state));
      headerTimestamp = hdr.timestamp;
    } else if (field === 2 && wire === 2) {
      const ent = decodeFeedEntity(readBytesSlice(buf, state));
      if (!ent.vehicle || !ent.vehicle.position) continue;
      const vp = ent.vehicle;
      const tsSec = vp.timestamp || headerTimestamp || null;
      reports.push({
        rawEntityId: ent.id || (vp.vehicle && (vp.vehicle.id || vp.vehicle.label)) || "unknown",
        vehicleLabel: (vp.vehicle && vp.vehicle.label) || null,
        tripId: (vp.trip && vp.trip.tripId) || null,
        routeId: (vp.trip && vp.trip.routeId) || null,
        directionId: vp.trip ? vp.trip.directionId : null,
        lat: vp.position.latitude,
        lon: vp.position.longitude,
        bearingDeg: vp.position.bearing,
        speedMps: vp.position.speed,
        timestampSec: tsSec,
      });
    } else {
      skipField(buf, state, wire);
    }
  }

  return reports;
}

function classifyYokohamaBusRoute(routeId, label) {
  const hint = `${routeId || ""} ${label || ""}`.trim();
  if (/bayside|ベイサイド|\bbb\b/i.test(hint)) {
    return {
      routeId: "bayside-blue",
      routeLabelJa: "ベイサイドブルー",
      routeLabelEn: "Bayside Blue",
      articulated: true,
      lengthM: 18.0,
      widthM: 2.5,
      heightM: 3.3,
    };
  }
  if (/akai|あかいくつ|271/i.test(hint)) {
    return {
      routeId: "akai-kutsu",
      routeLabelJa: "あかいくつ",
      routeLabelEn: "Akai Kutsu",
      articulated: false,
      lengthM: 9.4,
      widthM: 2.3,
      heightM: 3.0,
    };
  }
  if (/pier|ピアライン|280/i.test(hint)) {
    return {
      routeId: "pier-line",
      routeLabelJa: "ピアライン",
      routeLabelEn: "Pier Line",
      articulated: false,
      lengthM: 11.2,
      widthM: 2.45,
      heightM: 3.1,
    };
  }

  const cleanRoute = (routeId || "").split(":").pop() || "";
  const match = cleanRoute.match(/(?:^|[^0-9])([0-9]{1,3})(?:[^0-9]|$)/) ||
    (label || "").match(/(?:^|[^0-9])([0-9]{1,3})(?:系統|$)/);
  const code = match ? match[1] : "";
  if (code) {
    return {
      routeId: `city-bus-${code}`,
      routeLabelJa: `横浜市営バス ${code}系統`,
      routeLabelEn: `Yokohama City Bus Route ${code}`,
      articulated: false,
      lengthM: 11.2,
      widthM: 2.45,
      heightM: 3.1,
    };
  }

  return {
    routeId: "city-bus-loop",
    routeLabelJa: "横浜市営バス",
    routeLabelEn: "Yokohama City Bus",
    articulated: false,
    lengthM: 11.2,
    widthM: 2.45,
    heightM: 3.1,
  };
}

function normalizeBusPosition(raw, nowMs = Date.now()) {
  if (!raw || typeof raw.lat !== "number" || typeof raw.lon !== "number") return null;
  if (!Number.isFinite(raw.lat) || !Number.isFinite(raw.lon)) return null;
  if (
    raw.lon < YOKOHAMA_BUS_BBOX.minLon ||
    raw.lon > YOKOHAMA_BUS_BBOX.maxLon ||
    raw.lat < YOKOHAMA_BUS_BBOX.minLat ||
    raw.lat > YOKOHAMA_BUS_BBOX.maxLat
  ) {
    return null;
  }

  const tsMs =
    typeof raw.timestampSec === "number" && Number.isFinite(raw.timestampSec) && raw.timestampSec > 0
      ? raw.timestampSec * 1000
      : null;
  if (tsMs === null) return null;

  const ageSec = (nowMs - tsMs) / 1000;
  if (ageSec > 300 || ageSec < -60) return null;

  const hash = crypto
    .createHash("sha256")
    .update(`small-yokohama-bus:${raw.rawEntityId || "unknown"}`)
    .digest("hex")
    .slice(0, 12);

  const meta = classifyYokohamaBusRoute(raw.routeId, raw.vehicleLabel);
  const bearing =
    typeof raw.bearingDeg === "number" && Number.isFinite(raw.bearingDeg)
      ? ((raw.bearingDeg % 360) + 360) % 360
      : 0;
  const speed =
    typeof raw.speedMps === "number" && Number.isFinite(raw.speedMps) && raw.speedMps >= 0
      ? Math.round(raw.speedMps * 100) / 100
      : 0;

  const observedAt = new Date(tsMs).toISOString();
  const fetchedAt = new Date(nowMs).toISOString();

  return {
    entityId: `ybus-${hash}`,
    mode: "observed",
    routeId: meta.routeId,
    routeLabelJa: meta.routeLabelJa,
    routeLabelEn: meta.routeLabelEn,
    tripId: raw.tripId || null,
    directionId: typeof raw.directionId === "number" ? raw.directionId : null,
    directionLabelJa: "実測GPS運行中",
    directionLabelEn: "Live GPS Telemetry",
    observedAt,
    fetchedAt,
    lon: Math.round(raw.lon * 1e6) / 1e6,
    lat: Math.round(raw.lat * 1e6) / 1e6,
    bearingDeg: Math.round(bearing * 10) / 10,
    speedMps: speed,
    deckId: "ground-road",
    roadElevationM: 2.0,
    lengthM: meta.lengthM,
    widthM: meta.widthM,
    heightM: meta.heightM,
    articulated: meta.articulated,
    source: "ODPT / Yokohama Municipal Bus GTFS-RT",
  };
}

function buildFallbackPayload(nowIso) {
  return {
    schemaVersion: "1.0.0",
    generatedAt: nowIso,
    fetchedAt: nowIso,
    mode: "scheduled",
    fallback: true,
    feedHealth: "ok",
    feedMessage: {
      ja: "横浜市営バス GTFS-RT 未接続のため時刻表・デモ運行を表示中です。",
      en: "Live ODPT bus telemetry not active; showing scheduled harbor bus fleet.",
    },
    source: {
      id: "yokohama-bus-scheduled-fallback",
      labelJa: "横浜市営バス 時刻表ベース運行",
      labelEn: "Yokohama Municipal Bus Timetable",
      attribution: "Transportation Bureau, City of Yokohama / ODPT",
    },
    vehicles: [],
    portCalls: [],
  };
}

async function fetchOdptBusFeed(token) {
  for (const base of ODPT_BUS_RT_BASES) {
    const url = `${base}?acl:consumerKey=${encodeURIComponent(token)}`;
    try {
      const res = await fetch(url, {
        headers: {
          Accept: "application/x-protobuf, application/octet-stream",
          "User-Agent": "small-yokohama/1.0",
        },
        signal: AbortSignal.timeout(5000),
      });
      if (!res.ok) continue;
      const arr = await res.arrayBuffer();
      if (arr && arr.byteLength > 0) {
        return Buffer.from(arr);
      }
    } catch {
      // try next host
    }
  }
  return null;
}

async function handler(_req, res) {
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "public, s-maxage=15, stale-while-revalidate=30");

  const nowMs = Date.now();
  const fetchedAt = new Date(nowMs).toISOString();
  const token = (process.env.ODPT_ACCESS_TOKEN || "").trim();

  if (!token) {
    res.statusCode = 200;
    res.end(JSON.stringify(buildFallbackPayload(fetchedAt)));
    return;
  }

  try {
    const pbBuf = await fetchOdptBusFeed(token);
    if (pbBuf) {
      const rawReports = decodeGtfsRtVehiclePositions(pbBuf);
      const vehicles = [];
      const seen = new Set();
      for (const raw of rawReports) {
        const norm = normalizeBusPosition(raw, nowMs);
        if (!norm || seen.has(norm.entityId)) continue;
        seen.add(norm.entityId);
        vehicles.push(norm);
      }

      if (vehicles.length > 0) {
        res.statusCode = 200;
        res.end(
          JSON.stringify({
            schemaVersion: "1.0.0",
            generatedAt: fetchedAt,
            fetchedAt,
            mode: "observed",
            fallback: false,
            feedHealth: "ok",
            feedMessage: {
              ja: `横浜市営バス GTFS-RT 実測 ${vehicles.length} 台を受信中です。`,
              en: `Live Yokohama Municipal Bus telemetry: ${vehicles.length} vehicles.`,
            },
            source: {
              id: "odpt-yokohama-municipal-bus",
              labelJa: "横浜市営バス GTFS-RT (ODPT)",
              labelEn: "Yokohama Municipal Bus GTFS-RT (ODPT)",
              attribution: "Transportation Bureau, City of Yokohama / ODPT",
            },
            vehicles,
            portCalls: [],
          }),
        );
        return;
      }
    }
  } catch {
    // Graceful fallback if upstream protobuf or network fails
  }

  res.statusCode = 200;
  res.end(JSON.stringify(buildFallbackPayload(fetchedAt)));
}

handler.decodeGtfsRtVehiclePositions = decodeGtfsRtVehiclePositions;
handler.classifyYokohamaBusRoute = classifyYokohamaBusRoute;
handler.normalizeBusPosition = normalizeBusPosition;

module.exports = handler;
