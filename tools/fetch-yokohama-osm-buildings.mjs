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
  "https://overpass-api.de/api/interpreter",
  "https://maps.mail.ru/osm/tools/overpass/api/interpreter",
  "https://lz4.overpass-api.de/api/interpreter",
  "https://z.overpass-api.de/api/interpreter",
  "https://overpass.private.coffee/api/interpreter",
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

async function main() {
  if (process.argv.includes("--walkable-only")) {
    await fetchWalkable();
    return;
  }
  const { url, data } = await fetchOverpass(QUERY);
  const buildings = [];
  for (const el of data.elements) {
    const tags = el.tags ?? {};
    if (Number(tags.layer) < 0) continue;
    const h = Math.round(estimateHeightM(tags) * 10) / 10;
    if (el.type === "way" && Array.isArray(el.geometry)) {
      const ring = encodeRing(el.geometry);
      if (ring) buildings.push([h, ...ring]);
    } else if (el.type === "relation" && Array.isArray(el.members)) {
      for (const m of el.members) {
        if (m.role !== "outer" || !Array.isArray(m.geometry)) continue;
        const ring = encodeRing(m.geometry);
        if (ring) buildings.push([h, ...ring]);
      }
    }
  }
  const payload = {
    meta: {
      bbox: BBOX.split(",").map(Number),
      source: url,
      license: "© OpenStreetMap contributors (ODbL)",
      fetchedAt: new Date().toISOString(),
      buildingCount: buildings.length,
      encoding: "[heightM, x0, y0, x1, y1, ...] with x=(lon-origin[0])*1e6, y=(lat-origin[1])*1e6",
    },
    origin: ORIGIN,
    buildings,
  };
  fs.writeFileSync(OUT_PATH, `${JSON.stringify(payload)}\n`, "utf8");
  const kb = Math.round(fs.statSync(OUT_PATH).size / 1024);
  console.log(`[fetch-buildings] Wrote ${buildings.length} buildings to ${path.relative(process.cwd(), OUT_PATH)} (${kb} KB)`);
  await fetchWalkable();
}

if (import.meta.url === `file:///${process.argv[1]?.replace(/\\/g, "/")}` || process.argv[1]?.endsWith("fetch-yokohama-osm-buildings.mjs")) {
  await main();
}
