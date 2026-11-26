// Fetches what the pedestrian generator needs from OpenStreetMap for the Small Yokohama map area:
//
// - data/yokohama-osm-buildings.json: building footprints with heights. The depth/surface data
//   only knows the Shinko pilot's buildings, so elsewhere a person could be placed on a roof, or
//   on the ground behind a tall building, where the drawing shows the building.
//     { meta, origin: [lon0, lat0], buildings: [[heightM, x0, y0, x1, y1, ...], ...] }
// - data/yokohama-osm-walkable.json: where people can actually stand in busy districts —
//   footways, pedestrian lanes and small streets (lines) and squares, pedestrian areas and parks
//   (polygons). Some drawn buildings are missing from OSM; requiring walkable ground keeps
//   people off those too.
//     { meta, origin, ways: [[x0, y0, x1, y1, ...], ...], areas: [[x0, y0, ...], ...] }
//
// Coordinates: x = round((lon - lon0) * 1e6), y = round((lat - lat0) * 1e6) (about 0.1 m steps).
import fs from "node:fs";
import path from "node:path";

const BBOX = "35.427,139.601,35.480,139.665";
const ORIGIN = [139.601, 35.427];
const OUT_PATH = path.resolve("data/yokohama-osm-buildings.json");
const META_OUT_PATH = path.resolve("data/yokohama-osm-building-meta.json");
const WALKABLE_OUT_PATH = path.resolve("data/yokohama-osm-walkable.json");

// The ground the drawing covers (the image corners of full-yokohama-v1 projected onto z = 0,
// with a 400 px margin so tall buildings just outside the near edge are kept).
const MAP_FOOTPRINT = [
  [139.64243, 35.42542],
  [139.5992, 35.46064],
  [139.6242, 35.48118],
  [139.66743, 35.44595],
];

function insideFootprint(lon, lat) {
  let inside = false;
  for (let i = 0, j = MAP_FOOTPRINT.length - 1; i < MAP_FOOTPRINT.length; j = i++) {
    const [xi, yi] = MAP_FOOTPRINT[i];
    const [xj, yj] = MAP_FOOTPRINT[j];
    if (yi > lat !== yj > lat && lon < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

const OVERPASS_ENDPOINTS = [
  "https://overpass.private.coffee/api/interpreter",
  "https://overpass-api.de/api/interpreter",
  "https://maps.mail.ru/osm/tools/overpass/api/interpreter",
  "https://lz4.overpass-api.de/api/interpreter",
  "https://z.overpass-api.de/api/interpreter",
];

// Above-ground buildings only (no underground malls, no parts: parts sit inside a building outline)
const QUERY = `[out:json][timeout:180];
(
  way["building"]["building"!~"^(underground|no)$"]["location"!="underground"](${BBOX});
  relation["building"]["type"="multipolygon"]["location"!="underground"](${BBOX});
);
out geom qt;`;

const WALKABLE_QUERY = `[out:json][timeout:180];
(
  way["highway"~"^(pedestrian|footway|living_street|residential|path)$"]["area"!="yes"]["tunnel"!~"^(yes|building_passage)$"]["covered"!="yes"]["layer"!~"^-"]["access"!~"^(private|no)$"]["indoor"!="yes"](${BBOX});
  way["highway"="pedestrian"]["area"="yes"](${BBOX});
  way["place"="square"](${BBOX});
  way["leisure"~"^(park|garden|playground)$"](${BBOX});
  relation["leisure"~"^(park|garden)$"]["type"="multipolygon"](${BBOX});
);
out geom qt;`;

async function fetchOverpass(query) {
  let lastErr = null;
  for (const url of OVERPASS_ENDPOINTS) {
    try {
      console.log(`[fetch-buildings] Querying ${url} ...`);
      const res = await fetch(url, {
        method: "POST",
        headers: {
          "User-Agent": "SmallYokohama/1.0 (https://github.com/moruku36/small-yokohama)",
          Accept: "application/json",
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: `data=${encodeURIComponent(query)}`,
        signal: AbortSignal.timeout(240_000),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      if (!data || !Array.isArray(data.elements) || data.elements.length === 0) {
        throw new Error("Empty elements response");
      }
      console.log(`[fetch-buildings] Received ${data.elements.length} elements from ${url}`);
      return { url, data };
    } catch (err) {
      lastErr = err;
      console.warn(`[fetch-buildings] Failed on ${url}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  throw lastErr ?? new Error("All Overpass endpoints failed");
}

const num = (v) => {
  if (v === undefined || v === null) return NaN;
  const m = /-?\d+(?:\.\d+)?/.exec(String(v));
  return m ? Number(m[0]) : NaN;
};

/** Height in metres: the tagged height, else levels × 3.2 m, else a guess from the building type. */
export function estimateHeightM(tags) {
  const h = num(tags.height);
  if (Number.isFinite(h) && h > 0) return Math.min(400, h);
  const levels = num(tags["building:levels"]);
  if (Number.isFinite(levels) && levels > 0) {
    return Math.min(400, levels * 3.2 + (tags["roof:shape"] && tags["roof:shape"] !== "flat" ? 1.5 : 0.8));
  }
  switch (tags.building) {
    case "roof":
    case "carport":
      return 4;
    case "house":
    case "detached":
    case "garage":
    case "shed":
    case "hut":
      return 7;
    case "train_station":
    case "transportation":
      return 12;
    case "apartments":
    case "commercial":
    case "retail":
    case "office":
    case "hotel":
    case "hospital":
    case "school":
    case "university":
      return 15;
    default:
      return 9;
  }
}

/** Drops points closer than ~0.5 m to the previous one and the closing duplicate. */
function encodeRing(geometry) {
  if (!geometry.some((g) => insideFootprint(g.lon, g.lat))) return null;
  const out = [];
  let px = NaN;
  let py = NaN;
  for (const g of geometry) {
    const x = Math.round((g.lon - ORIGIN[0]) * 1e6);
    const y = Math.round((g.lat - ORIGIN[1]) * 1e6);
    if (Math.abs(x - px) + Math.abs(y - py) < 5) continue;
    out.push(x, y);
    px = x;
    py = y;
  }
  if (out.length >= 4 && out[0] === out[out.length - 2] && out[1] === out[out.length - 1]) {
    out.length -= 2;
  }
  return out.length >= 6 ? out : null;
}

function encodeLine(geometry) {
  if (!geometry.some((g) => insideFootprint(g.lon, g.lat))) return null;
  const out = [];
  for (const g of geometry) {
    out.push(Math.round((g.lon - ORIGIN[0]) * 1e6), Math.round((g.lat - ORIGIN[1]) * 1e6));
  }
  return out.length >= 4 ? out : null;
}

async function fetchWalkable() {
  const { url, data } = await fetchOverpass(WALKABLE_QUERY);
  const ways = [];
  const areas = [];
  for (const el of data.elements) {
    const tags = el.tags ?? {};
    const isArea = tags.area === "yes" || tags.place === "square" || Boolean(tags.leisure);
    if (el.type === "way" && Array.isArray(el.geometry)) {
      if (isArea) {
        const ring = encodeRing(el.geometry);
        if (ring) areas.push(ring);
      } else {
        const line = encodeLine(el.geometry);
        if (line) ways.push(line);
      }
    } else if (el.type === "relation" && Array.isArray(el.members)) {
      for (const m of el.members) {
        if (m.role !== "outer" || !Array.isArray(m.geometry)) continue;
        const ring = encodeRing(m.geometry);
        if (ring) areas.push(ring);
      }
    }
  }
  const payload = {
    meta: {
      bbox: BBOX.split(",").map(Number),
      source: url,
      license: "© OpenStreetMap contributors (ODbL)",
      fetchedAt: new Date().toISOString(),
      wayCount: ways.length,
      areaCount: areas.length,
      encoding: "[x0, y0, x1, y1, ...] with x=(lon-origin[0])*1e6, y=(lat-origin[1])*1e6",
    },
    origin: ORIGIN,
    ways,
    areas,
  };
  fs.writeFileSync(WALKABLE_OUT_PATH, `${JSON.stringify(payload)}\n`, "utf8");
  const kb = Math.round(fs.statSync(WALKABLE_OUT_PATH).size / 1024);
  console.log(
    `[fetch-buildings] Wrote ${ways.length} walkways and ${areas.length} open areas to ${path.relative(process.cwd(), WALKABLE_OUT_PATH)} (${kb} KB)`,
  );
}

const HAS_JA = /[\u3040-\u30ff\u3400-\u9fff\uff65-\uff9f]/;
const LON_E6_TO_M = 1e-6 * Math.cos((35.45 * Math.PI) / 180) * 111320;
const LAT_E6_TO_M = 1e-6 * 110950;

function inferBuildingType(tags) {
  const raw = (tags.building || "yes").trim().toLowerCase();
  if (raw !== "yes") return raw;
  if (tags.railway === "station" || tags.public_transport === "station") return "station";
  if (tags.leisure === "stadium") return "stadium";
  if (tags.tourism === "hotel") return "hotel";
  if (tags.tourism === "museum") return "museum";
  if (tags.amenity === "library") return "library";
  if (tags.amenity === "hospital" || tags.amenity === "clinic") return "hospital";
  if (tags.amenity === "university" || tags.amenity === "college") return "university";
  if (tags.amenity === "school") return "school";
  if (tags.amenity === "kindergarten") return "kindergarten";
  if (tags.amenity === "place_of_worship") return "place_of_worship";
  if (tags.amenity === "parking") return "parking";
  if (tags.shop === "mall" || tags.shop === "department_store") return "mall";
  if (tags.shop) return "retail";
  if (tags.office) return "office";
  return "yes";
}

function extractBuildingAddress(tags) {
  if (tags["addr:full"]) return String(tags["addr:full"]).trim();
  const baseParts = [];
  for (const raw of [
    tags["addr:city"],
    tags["addr:suburb"],
    tags["addr:quarter"],
    tags["addr:neighbourhood"],
  ]) {
    const s = (raw ?? "").trim();
    if (s && !baseParts.includes(s)) baseParts.push(s);
  }
  const block = (tags["addr:block_number"] ?? "").trim();
  const house = (tags["addr:housenumber"] ?? "").trim();
  const numPart = block && house && block !== house ? `${block}-${house}` : block || house;
  if (baseParts.length === 0 && !numPart) return "";
  return `${baseParts.join("")}${numPart}`;
}

function computeRingCentroidAndArea(ring) {
  const n = Math.floor(ring.length / 2);
  let area2 = 0;
  let cxAcc = 0;
  let cyAcc = 0;
  let sx = 0;
  let sy = 0;
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    const x0 = ring[i * 2];
    const y0 = ring[i * 2 + 1];
    const x1 = ring[j * 2];
    const y1 = ring[j * 2 + 1];
    sx += x0;
    sy += y0;
    const cross = x0 * y1 - x1 * y0;
    area2 += cross;
    cxAcc += (x0 + x1) * cross;
    cyAcc += (y0 + y1) * cross;
  }
  const lonE6 =
    Math.abs(area2) > 1e-3 ? Math.round(cxAcc / (3 * area2)) : Math.round(sx / n);
  const latE6 =
    Math.abs(area2) > 1e-3 ? Math.round(cyAcc / (3 * area2)) : Math.round(sy / n);
  const areaM2 = Math.round(0.5 * Math.abs(area2) * LON_E6_TO_M * LAT_E6_TO_M);
  return { lonE6, latE6, areaM2 };
}

function buildMetaRecord(osmId, tags, heightM, ring, typeMap, types) {
  const height10 = Math.round(heightM * 10);
  const levelsRaw = num(tags["building:levels"]);
  const levels =
    Number.isFinite(levelsRaw) && levelsRaw > 0 ? Math.min(200, Math.round(levelsRaw)) : 0;
  const bType = inferBuildingType(tags);
  let typeIdx = typeMap.get(bType);
  if (typeIdx === undefined) {
    typeIdx = types.length;
    types.push(bType);
    typeMap.set(bType, typeIdx);
  }
  const { lonE6, latE6, areaM2 } = computeRingCentroidAndArea(ring);
  const rawName = (tags.name ?? "").trim();
  const nameJa = (tags["name:ja"] ?? rawName).trim();
  const rawEn = (tags["name:en"] ?? "").trim();
  const nameEn =
    rawEn && !HAS_JA.test(rawEn)
      ? rawEn
      : rawName && !HAS_JA.test(rawName) && /[A-Za-z0-9]/.test(rawName)
        ? rawName
        : "";
  const address = extractBuildingAddress(tags);
  const rawDate =
    tags.start_date ||
    tags["building:start_date"] ||
    tags.construction_date ||
    tags.year_of_construction ||
    "";
  const ym = /\b(18\d{2}|19\d{2}|20\d{2})\b/.exec(String(rawDate));
  const yearBuilt = ym ? ym[1] : "";
  const category = (
    tags.amenity ||
    tags.tourism ||
    tags.office ||
    tags.shop ||
    tags.historic ||
    ""
  ).trim();

  const tuple = [
    osmId,
    height10,
    levels,
    typeIdx,
    lonE6,
    latE6,
    areaM2,
    nameJa,
    nameEn,
    address,
    yearBuilt,
    category,
  ];
  while (tuple.length > 7 && tuple[tuple.length - 1] === "") {
    tuple.pop();
  }
  return tuple;
}

async function main() {
  if (process.argv.includes("--walkable-only")) {
    await fetchWalkable();
    return;
  }
  const buildingsOnly = process.argv.includes("--buildings-only");
  const { url, data } = await fetchOverpass(QUERY);
  const buildings = [];
  const metaRecords = [];
  const types = [];
  const typeMap = new Map();

  for (const el of data.elements) {
    const tags = el.tags ?? {};
    if (Number(tags.layer) < 0) continue;
    const h = Math.round(estimateHeightM(tags) * 10) / 10;
    if (el.type === "way" && Array.isArray(el.geometry)) {
      const ring = encodeRing(el.geometry);
      if (ring) {
        buildings.push([h, ...ring]);
        metaRecords.push(buildMetaRecord(el.id, tags, h, ring, typeMap, types));
      }
    } else if (el.type === "relation" && Array.isArray(el.members)) {
      for (const m of el.members) {
        if (m.role !== "outer" || !Array.isArray(m.geometry)) continue;
        const ring = encodeRing(m.geometry);
        if (ring) {
          buildings.push([h, ...ring]);
          metaRecords.push(buildMetaRecord(el.id, tags, h, ring, typeMap, types));
        }
      }
    }
  }
  const fetchedAt = new Date().toISOString();
  const payload = {
    meta: {
      bbox: BBOX.split(",").map(Number),
      source: url,
      license: "© OpenStreetMap contributors (ODbL)",
      fetchedAt,
      buildingCount: buildings.length,
      encoding: "[heightM, x0, y0, x1, y1, ...] with x=(lon-origin[0])*1e6, y=(lat-origin[1])*1e6",
    },
    origin: ORIGIN,
    buildings,
  };
  fs.writeFileSync(OUT_PATH, `${JSON.stringify(payload)}\n`, "utf8");
  const kb = Math.round(fs.statSync(OUT_PATH).size / 1024);
  console.log(`[fetch-buildings] Wrote ${buildings.length} buildings to ${path.relative(process.cwd(), OUT_PATH)} (${kb} KB)`);

  const metaPayload = {
    meta: {
      bbox: BBOX.split(",").map(Number),
      source: url,
      license: "© OpenStreetMap contributors (ODbL)",
      fetchedAt,
      buildingCount: metaRecords.length,
      encoding:
        "[osmId, height10, levels, typeIdx, lonE6, latE6, areaM2, nameJa?, nameEn?, address?, yearBuilt?, category?]",
    },
    origin: ORIGIN,
    types,
    records: metaRecords,
  };
  fs.writeFileSync(META_OUT_PATH, `${JSON.stringify(metaPayload)}\n`, "utf8");
  const metaKb = Math.round(fs.statSync(META_OUT_PATH).size / 1024);
  console.log(
    `[fetch-buildings] Wrote ${metaRecords.length} building metadata records (${types.length} types) to ${path.relative(process.cwd(), META_OUT_PATH)} (${metaKb} KB)`,
  );

  if (!buildingsOnly) {
    await fetchWalkable();
  }
}

if (import.meta.url === `file:///${process.argv[1]?.replace(/\\/g, "/")}` || process.argv[1]?.endsWith("fetch-yokohama-osm-buildings.mjs")) {
  await main();
}
