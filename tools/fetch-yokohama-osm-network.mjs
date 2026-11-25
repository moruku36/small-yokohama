import fs from "node:fs";
import path from "node:path";

const BBOX = "35.427,139.601,35.480,139.665";
const OUT_PATH = path.resolve("data/yokohama-osm-network.json");

const OVERPASS_ENDPOINTS = [
  "https://maps.mail.ru/osm/tools/overpass/api/interpreter",
  "https://overpass-api.de/api/interpreter",
  "https://lz4.overpass-api.de/api/interpreter",
  "https://z.overpass-api.de/api/interpreter",
  "https://overpass.private.coffee/api/interpreter",
];

const RAIL_QUERY = `[out:json][timeout:40];
(
  way["railway"="rail"]["tunnel"!="yes"]["service"!~"^(yard|siding|spur)$"](${BBOX});
  node["railway"="station"](${BBOX});
);
out body;
>;
out skel qt;`;

const ROAD_QUERY = `[out:json][timeout:45];
(
  way["highway"~"^(trunk|primary|secondary|tertiary|unclassified|trunk_link|primary_link|secondary_link|tertiary_link)$"]["tunnel"!="yes"]["area"!="yes"]["access"!="private"](${BBOX});
);
out body;
>;
out skel qt;`;

async function fetchOverpassQuery(label, query) {
  let lastErr = null;
  for (const url of OVERPASS_ENDPOINTS) {
    try {
      console.log(`[fetch-osm:${label}] Querying ${url} ...`);
      const res = await fetch(url, {
        method: "POST",
        headers: {
          "User-Agent": "SmallYokohama/1.0 (https://github.com/moruku36/small-yokohama)",
          Accept: "application/json",
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: `data=${encodeURIComponent(query)}`,
        signal: AbortSignal.timeout(45_000),
      });
      if (!res.ok) {
        throw new Error(`HTTP ${res.status}`);
      }
      const data = await res.json();
      if (!data || !Array.isArray(data.elements) || data.elements.length === 0) {
        throw new Error("Empty elements response");
      }
      console.log(`[fetch-osm:${label}] Received ${data.elements.length} elements from ${url}`);
      return { url, data };
    } catch (err) {
      lastErr = err;
      console.warn(
        `[fetch-osm:${label}] Failed on ${url}: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }
  throw new Error(
    `All Overpass endpoints failed for ${label}: ${lastErr instanceof Error ? lastErr.message : String(lastErr)}`,
  );
}

async function main() {
  const railRes = await fetchOverpassQuery("rail", RAIL_QUERY);
  const roadRes = await fetchOverpassQuery("roads", ROAD_QUERY);

  const allNodes = new Map();
  const roadWays = [];
  const railWays = [];
  const stations = [];
  const seenWayIds = new Set();
  const seenStationIds = new Set();
  const referencedNodeIds = new Set();

  for (const data of [railRes.data, roadRes.data]) {
    for (const el of data.elements) {
      if (el.type === "node") {
        allNodes.set(el.id, [Number(el.lon.toFixed(7)), Number(el.lat.toFixed(7))]);
        if (el.tags?.railway === "station" && !seenStationIds.has(el.id)) {
          seenStationIds.add(el.id);
          stations.push({
            id: el.id,
            name: el.tags.name ?? "",
            nameEn: el.tags["name:en"] ?? "",
            operator: el.tags.operator ?? "",
            lon: Number(el.lon.toFixed(7)),
            lat: Number(el.lat.toFixed(7)),
          });
        }
      } else if (el.type === "way" && Array.isArray(el.nodes) && el.nodes.length >= 2) {
        if (seenWayIds.has(el.id)) continue;
        seenWayIds.add(el.id);
        if (el.tags?.railway === "rail") {
          railWays.push({
            id: el.id,
            name: el.tags.name ?? "",
            nameEn: el.tags["name:en"] ?? "",
            operator: el.tags.operator ?? "",
            bridge: el.tags.bridge ?? "",
            layer: el.tags.layer ? Number(el.tags.layer) : 0,
            nodes: el.nodes,
          });
          for (const nid of el.nodes) referencedNodeIds.add(nid);
        } else if (el.tags?.highway) {
          roadWays.push({
            id: el.id,
            highway: el.tags.highway,
            name: el.tags.name ?? "",
            oneway: el.tags.oneway ?? "",
            bridge: el.tags.bridge ?? "",
            layer: el.tags.layer ? Number(el.tags.layer) : 0,
            nodes: el.nodes,
          });
          for (const nid of el.nodes) referencedNodeIds.add(nid);
        }
      }
    }
  }

  const nodes = {};
  for (const nid of referencedNodeIds) {
    const coord = allNodes.get(nid);
    if (coord) {
      nodes[String(nid)] = coord;
    }
  }

  const payload = {
    meta: {
      bbox: [35.427, 139.601, 35.480, 139.665],
      sources: [railRes.url, roadRes.url],
      fetchedAt: new Date().toISOString(),
      roadWayCount: roadWays.length,
      railWayCount: railWays.length,
      stationCount: stations.length,
      nodeCount: Object.keys(nodes).length,
    },
    nodes,
    roadWays,
    railWays,
    stations,
  };

  fs.mkdirSync(path.dirname(OUT_PATH), { recursive: true });
  fs.writeFileSync(OUT_PATH, JSON.stringify(payload), "utf8");
  console.log(
    `[fetch-osm] Wrote ${OUT_PATH}: roadWays=${roadWays.length}, railWays=${railWays.length}, stations=${stations.length}, nodes=${Object.keys(nodes).length}`,
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
