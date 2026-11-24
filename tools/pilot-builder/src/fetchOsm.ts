import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { PoiRecord } from "@small-yokohama/core";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, "..", "..", "..");
const OUT_PATH = join(REPO_ROOT, "data", "shinko-osm.json");

const BBOX = [139.635, 35.4485, 139.6475, 35.4575] as const;
const OSM_MAP_URL = `https://api.openstreetmap.org/api/0.6/map.json?bbox=${BBOX.join(",")}`;

interface OsmNode {
  type: "node";
  id: number;
  lat: number;
  lon: number;
  tags?: Record<string, string>;
}

interface OsmWay {
  type: "way";
  id: number;
  nodes: number[];
  tags?: Record<string, string>;
}

interface OsmRelation {
  type: "relation";
  id: number;
  members: Array<{ type: string; ref: number; role: string }>;
  tags?: Record<string, string>;
}

interface OsmMapResponse {
  elements: Array<OsmNode | OsmWay | OsmRelation>;
}

export interface OsmBuildingRecord {
  osmId: number;
  isPart: boolean;
  nameJa: string;
  nameEn: string;
  buildingType: string;
  heightM: number;
  minHeightM: number;
  levels?: number;
  address?: string;
  ring: Array<[number, number]>;
  holes?: Array<Array<[number, number]>>;
  center: [number, number];
}

export interface OsmRoadRecord {
  osmId: number;
  nameJa: string;
  nameEn: string;
  highway: string;
  bridge: boolean;
  layer: number;
  widthM: number;
  coords: Array<[number, number]>;
}

export interface OsmAreaRecord {
  osmId: number;
  nameJa: string;
  nameEn: string;
  kind: string;
  ring: Array<[number, number]>;
  holes?: Array<Array<[number, number]>>;
}

export interface OsmCraneRecord {
  osmId: number;
  lon: number;
  lat: number;
  nameJa: string;
  nameEn: string;
}

export interface OsmShinkoDataset {
  meta: {
    retrievedAt: string;
    bbox: readonly [number, number, number, number];
    source: string;
    license: string;
    attribution: string;
  };
  coastlineChains: Array<Array<[number, number]>>;
  waterPolygons: OsmAreaRecord[];
  piers: OsmAreaRecord[];
  parks: OsmAreaRecord[];
  buildings: OsmBuildingRecord[];
  roads: OsmRoadRecord[];
  trees: Array<[number, number]>;
  cranes: OsmCraneRecord[];
  pois: PoiRecord[];
}

function makeGoogleMapsUrl(lon: number, lat: number, queryName?: string): string {
  if (queryName) {
    return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${queryName} 横浜`)}`;
  }
  return `https://www.google.com/maps/search/?api=1&query=${lat.toFixed(6)},${lon.toFixed(6)}`;
}

function buildAddress(tags: Record<string, string>): string | undefined {
  const parts = [
    tags["addr:province"] ?? tags["addr:prefecture"],
    tags["addr:city"],
    tags["addr:ward"] ?? tags["addr:suburb"],
    tags["addr:neighbourhood"] ?? tags["addr:quarter"],
    tags["addr:block_number"],
    tags["addr:housenumber"],
  ].filter(Boolean);
  if (parts.length > 0) return parts.join("");
  return tags["addr:full"];
}

function inferBuildingHeight(tags: Record<string, string>): { heightM: number; minHeightM: number; levels?: number } {
  const rawMin = parseFloat(tags.min_height ?? "");
  const minHeightM = Number.isFinite(rawMin) ? rawMin : 0;

  const rawLevels = parseFloat(tags["building:levels"] ?? "");
  const levels = Number.isFinite(rawLevels) && rawLevels > 0 ? Math.round(rawLevels) : undefined;

  const rawHeight = parseFloat((tags.height ?? "").replace(/[^\d.]/g, ""));
  if (Number.isFinite(rawHeight) && rawHeight > 1.5) {
    return { heightM: rawHeight, minHeightM, levels };
  }
  if (levels !== undefined) {
    return { heightM: Math.max(4, levels * 3.8), minHeightM, levels };
  }

  const bType = tags.building ?? tags["building:part"] ?? "yes";
  if (bType === "warehouse") return { heightM: 15, minHeightM, levels };
  if (bType === "hotel") return { heightM: 32, minHeightM, levels };
  if (bType === "commercial" || bType === "office") return { heightM: 22, minHeightM, levels };
  if (bType === "retail" || bType === "public") return { heightM: 18, minHeightM, levels };
  if (bType === "roof" || bType === "kiosk") return { heightM: 4.5, minHeightM, levels };
  return { heightM: 11, minHeightM, levels };
}

function inferRoadWidth(tags: Record<string, string>): number {
  const rawW = parseFloat((tags.width ?? "").replace(/[^\d.]/g, ""));
  if (Number.isFinite(rawW) && rawW >= 1.5 && rawW <= 40) return rawW;
  const hw = tags.highway ?? "";
  if (hw === "primary" || hw === "trunk") return 16;
  if (hw === "secondary") return 14;
  if (hw === "tertiary") return 11;
  if (hw === "unclassified" || hw === "residential") return 8.5;
  if (hw === "service") return 5.5;
  if (hw === "pedestrian") return 5.5;
  if (hw === "cycleway") return 3.2;
  return 3.0;
}

function polygonCenter(ring: Array<[number, number]>): [number, number] {
  if (ring.length === 0) return [0, 0];
  let sx = 0;
  let sy = 0;
  for (const [x, y] of ring) {
    sx += x;
    sy += y;
  }
  return [sx / ring.length, sy / ring.length];
}

function stitchCoastlineChains(
  coastWays: OsmWay[],
  nodeById: Map<number, OsmNode>,
): Array<Array<[number, number]>> {
  const remaining = coastWays.map((w) => [...w.nodes]);
  const chains: number[][] = [];

  while (remaining.length > 0) {
    const chain = remaining.shift()!;
    let merged = true;
    while (merged) {
      merged = false;
      const head = chain[0]!;
      const tail = chain[chain.length - 1]!;
      for (let i = 0; i < remaining.length; i++) {
        const w = remaining[i]!;
        if (w[0] === tail) {
          chain.push(...w.slice(1));
          remaining.splice(i, 1);
          merged = true;
          break;
        }
        if (w[w.length - 1] === head) {
          chain.unshift(...w.slice(0, -1));
          remaining.splice(i, 1);
          merged = true;
          break;
        }
      }
    }
    chains.push(chain);
  }

  return chains
    .map((ids) =>
      ids
        .map((id) => nodeById.get(id))
        .filter((n): n is OsmNode => Boolean(n))
        .map((n): [number, number] => [n.lon, n.lat]),
    )
    .filter((c) => c.length >= 2);
}

const TIER1_PATTERNS =
  /赤レンガ倉庫|サークルウォーク|ワールドポーターズ|World Porters|Cupnoodles|カップヌードル|ハンマーヘッド|インターコンチネンタル|InterContinental|会議センター|大さん橋|ナビオス|万葉倶楽部|JICA|象の鼻|汽車道|万国橋/i;

function classifyPoiTier(tags: Record<string, string>, name: string): 1 | 2 | 3 {
  if (TIER1_PATTERNS.test(name)) return 1;
  if (
    tags.tourism ||
    tags.leisure === "park" ||
    tags.man_made === "pier" ||
    tags.highway === "primary" ||
    tags.highway === "secondary" ||
    tags.bridge === "yes" ||
    tags.building === "hotel" ||
    tags.building === "public" ||
    tags.building === "retail"
  ) {
    return 2;
  }
  return 3;
}

function classifyPoiCategory(tags: Record<string, string>): string {
  if (tags.highway === "bus_stop" || tags.public_transport) return "transit";
  if (tags.bridge === "yes" || tags.highway === "pedestrian") return "bridge";
  if (tags.highway) return "street";
  if (tags.leisure || tags.landuse) return "park";
  if (tags.man_made === "pier") return "pier";
  if (tags.tourism || tags.amenity || tags.shop) return tags.tourism ?? tags.amenity ?? tags.shop ?? "poi";
  if (tags.building) return "building";
  return "landmark";
}

async function main(): Promise<void> {
  console.log(`[fetchOsm] Fetching ${OSM_MAP_URL} ...`);
  const res = await fetch(OSM_MAP_URL, {
    headers: {
      "User-Agent": "SmallYokohamaDev/0.1 (https://github.com/moruku36/small-yokohama)",
      Accept: "application/json",
    },
  });
  if (!res.ok) {
    throw new Error(`OSM API returned HTTP ${res.status}`);
  }
  const raw = (await res.json()) as OsmMapResponse;

  const nodeById = new Map<number, OsmNode>();
  const ways: OsmWay[] = [];
  const wayById = new Map<number, OsmWay>();
  const relations: OsmRelation[] = [];
  for (const el of raw.elements) {
    if (el.type === "node") nodeById.set(el.id, el);
    else if (el.type === "way") {
      ways.push(el);
      wayById.set(el.id, el);
    } else if (el.type === "relation") {
      relations.push(el);
    }
  }

  const stitchWayLoops = (memberWays: OsmWay[]): Array<Array<[number, number]>> => {
    const remaining = memberWays
      .map((w) => [...w.nodes])
      .filter((ids) => ids.length >= 2);
    const loops: Array<Array<[number, number]>> = [];

    while (remaining.length > 0) {
      const chain = remaining.shift()!;
      let merged = true;
      while (merged && chain[0] !== chain[chain.length - 1]) {
        merged = false;
        const head = chain[0]!;
        const tail = chain[chain.length - 1]!;
        for (let i = 0; i < remaining.length; i++) {
          const seg = remaining[i]!;
          const sHead = seg[0]!;
          const sTail = seg[seg.length - 1]!;
          if (sHead === tail) {
            chain.push(...seg.slice(1));
            remaining.splice(i, 1);
            merged = true;
            break;
          }
          if (sTail === tail) {
            chain.push(...[...seg].reverse().slice(1));
            remaining.splice(i, 1);
            merged = true;
            break;
          }
          if (sTail === head) {
            chain.unshift(...seg.slice(0, -1));
            remaining.splice(i, 1);
            merged = true;
            break;
          }
          if (sHead === head) {
            chain.unshift(...[...seg].reverse().slice(0, -1));
            remaining.splice(i, 1);
            merged = true;
            break;
          }
        }
      }
      const coords = chain
        .map((nid) => nodeById.get(nid))
        .filter((n): n is OsmNode => Boolean(n))
        .map((n): [number, number] => [n.lon, n.lat]);
      if (coords.length >= 4 && coords[0]![0] === coords[coords.length - 1]![0] && coords[0]![1] === coords[coords.length - 1]![1]) {
        coords.pop();
      }
      if (coords.length >= 3) {
        loops.push(coords);
      }
    }
    return loops;
  };

  const wayRingCoords = (w: OsmWay): Array<[number, number]> => {
    const pts: Array<[number, number]> = [];
    for (const nid of w.nodes) {
      const n = nodeById.get(nid);
      if (n) pts.push([n.lon, n.lat]);
    }
    if (pts.length >= 3) {
      const first = pts[0]!;
      const last = pts[pts.length - 1]!;
      if (first[0] === last[0] && first[1] === last[1]) {
        pts.pop();
      }
    }
    return pts;
  };

  const coastWays = ways.filter((w) => w.tags?.natural === "coastline");
  const coastlineChains = stitchCoastlineChains(coastWays, nodeById);

  const waterPolygons: OsmAreaRecord[] = [];
  const piers: OsmAreaRecord[] = [];
  const parks: OsmAreaRecord[] = [];
  const buildings: OsmBuildingRecord[] = [];
  const roads: OsmRoadRecord[] = [];
  const trees: Array<[number, number]> = [];
  const cranes: OsmCraneRecord[] = [];
  const poiMap = new Map<string, PoiRecord>();

  const registerPoi = (
    key: string,
    osmId: number,
    tags: Record<string, string>,
    lon: number,
    lat: number,
    elevM: number,
    heightM?: number,
    levels?: number,
  ) => {
    const nameJa = tags["name:ja"] ?? tags.name ?? tags["name:en"] ?? "";
    if (!nameJa) return;
    const nameEn = tags["name:en"] ?? nameJa;
    const normKey = `${nameJa.trim()}::${key.split("-")[0]}`;
    const existing = poiMap.get(normKey);
    const tier = classifyPoiTier(tags, `${nameJa} ${nameEn}`);
    const category = classifyPoiCategory(tags);
    const addr = buildAddress(tags);

    if (existing) {
      // Keep higher-priority tier or richer building metadata
      if (tier < existing.tier || (heightM && !existing.heightM)) {
        poiMap.set(normKey, {
          ...existing,
          tier: Math.min(existing.tier, tier) as 1 | 2 | 3,
          heightM: heightM ?? existing.heightM,
          levels: levels ?? existing.levels,
          address: addr ?? existing.address,
        });
      }
      return;
    }

    const descParts: string[] = [];
    if (tags.building && tags.building !== "yes") descParts.push(tags.building);
    if (heightM) descParts.push(`${heightM.toFixed(1)}m`);
    if (levels) descParts.push(`${levels}F`);
    if (addr) descParts.push(addr);
    if (tags.description) descParts.push(tags.description);

    poiMap.set(normKey, {
      id: `osm-${key}-${osmId}`,
      osmId,
      nameJa,
      nameEn,
      category,
      lon,
      lat,
      elevationM: elevM,
      heightM,
      levels,
      address: addr,
      descriptionJa: descParts.length > 0 ? descParts.join(" · ") : "OpenStreetMap 実測地物 (ODbL)",
      descriptionEn: descParts.length > 0 ? descParts.join(" · ") : "Measured OpenStreetMap feature (ODbL)",
      tier,
      googleMapsUrl: makeGoogleMapsUrl(lon, lat, nameJa),
    });
  };

  for (const w of ways) {
    const tags = w.tags ?? {};
    const isClosed = w.nodes.length >= 4 && w.nodes[0] === w.nodes[w.nodes.length - 1];

    if (tags.natural === "water" && isClosed) {
      const ring = wayRingCoords(w);
      if (ring.length >= 3) {
        waterPolygons.push({
          osmId: w.id,
          nameJa: tags["name:ja"] ?? tags.name ?? "水面",
          nameEn: tags["name:en"] ?? tags.name ?? "Water",
          kind: tags.water ?? "water",
          ring,
        });
      }
    }

    if ((tags.man_made === "pier" || tags.man_made === "breakwater") && isClosed) {
      const ring = wayRingCoords(w);
      if (ring.length >= 3) {
        piers.push({
          osmId: w.id,
          nameJa: tags["name:ja"] ?? tags.name ?? "桟橋",
          nameEn: tags["name:en"] ?? tags.name ?? "Pier",
          kind: tags.man_made,
          ring,
        });
        const [cx, cy] = polygonCenter(ring);
        registerPoi("pier", w.id, tags, cx, cy, 2.2);
      }
    }

    if (
      isClosed &&
      (tags.leisure === "park" ||
        tags.leisure === "garden" ||
        tags.leisure === "pitch" ||
        tags.landuse === "grass" ||
        tags.landuse === "recreation_ground" ||
        tags.landuse === "meadow")
    ) {
      const ring = wayRingCoords(w);
      if (ring.length >= 3) {
        parks.push({
          osmId: w.id,
          nameJa: tags["name:ja"] ?? tags.name ?? "緑地",
          nameEn: tags["name:en"] ?? tags.name ?? "Park",
          kind: tags.leisure ?? tags.landuse ?? "park",
          ring,
        });
        const [cx, cy] = polygonCenter(ring);
        registerPoi("park", w.id, tags, cx, cy, 2.2);
      }
    }

    if ((tags.building || tags["building:part"]) && isClosed) {
      const ring = wayRingCoords(w);
      if (ring.length >= 3) {
        const { heightM, minHeightM, levels } = inferBuildingHeight(tags);
        const center = polygonCenter(ring);
        const nameJa = tags["name:ja"] ?? tags.name ?? tags["name:en"] ?? "";
        const nameEn = tags["name:en"] ?? nameJa;
        buildings.push({
          osmId: w.id,
          isPart: Boolean(tags["building:part"]) && !tags.building,
          nameJa,
          nameEn,
          buildingType: tags.building ?? tags["building:part"] ?? "yes",
          heightM,
          minHeightM,
          levels,
          address: buildAddress(tags),
          ring,
          center,
        });
        if (nameJa) {
          registerPoi("bldg", w.id, tags, center[0], center[1], heightM, heightM, levels);
        }
      }
    }

    if (tags.highway) {
      const coords = w.nodes
        .map((nid) => nodeById.get(nid))
        .filter((n): n is OsmNode => Boolean(n))
        .map((n): [number, number] => [n.lon, n.lat]);
      if (coords.length >= 2) {
        const layerNum = Number.parseInt(tags.layer ?? "0", 10);
        const isBridge = tags.bridge === "yes" || tags.man_made === "bridge";
        roads.push({
          osmId: w.id,
          nameJa: tags["name:ja"] ?? tags.name ?? "",
          nameEn: tags["name:en"] ?? tags.name ?? "",
          highway: tags.highway,
          bridge: isBridge,
          layer: Number.isFinite(layerNum) ? layerNum : 0,
          widthM: inferRoadWidth(tags),
          coords,
        });
        if (tags.name) {
          const mid = coords[Math.floor(coords.length / 2)]!;
          registerPoi("way", w.id, tags, mid[0], mid[1], isBridge ? 6.9 : 2.2);
        }
      }
    }
  }

  // Parse OSM multipolygon relations (e.g., rel 11066652 Yokohama Hammerhead with courtyard)
  for (const rel of relations) {
    const tags = rel.tags ?? {};
    if (tags.type !== "multipolygon") continue;
    const outerWays = rel.members
      .filter((m) => m.type === "way" && (m.role === "outer" || m.role === ""))
      .map((m) => wayById.get(m.ref))
      .filter((w): w is OsmWay => Boolean(w));
    const innerWays = rel.members
      .filter((m) => m.type === "way" && m.role === "inner")
      .map((m) => wayById.get(m.ref))
      .filter((w): w is OsmWay => Boolean(w));

    const outerRings = stitchWayLoops(outerWays);
    if (outerRings.length === 0) continue;
    const innerRings = stitchWayLoops(innerWays);

    if (tags.building || tags["building:part"]) {
      const { heightM, minHeightM, levels } = inferBuildingHeight(tags);
      const nameJa = tags["name:ja"] ?? tags.name ?? tags["name:en"] ?? "";
      const nameEn = tags["name:en"] ?? nameJa;
      outerRings.forEach((ring, idx) => {
        const center = polygonCenter(ring);
        buildings.push({
          osmId: rel.id,
          isPart: Boolean(tags["building:part"]) && !tags.building,
          nameJa,
          nameEn,
          buildingType: tags.building ?? tags["building:part"] ?? "yes",
          heightM,
          minHeightM,
          levels,
          address: buildAddress(tags),
          ring,
          holes: idx === 0 && innerRings.length > 0 ? innerRings : undefined,
          center,
        });
        if (idx === 0 && nameJa) {
          registerPoi("rel-bldg", rel.id, tags, center[0], center[1], heightM, heightM, levels);
        }
      });
    } else if (
      tags.leisure === "park" ||
      tags.leisure === "garden" ||
      tags.leisure === "pitch" ||
      tags.landuse === "grass" ||
      tags.landuse === "recreation_ground" ||
      tags.landuse === "meadow"
    ) {
      outerRings.forEach((ring, idx) => {
        const center = polygonCenter(ring);
        parks.push({
          osmId: rel.id,
          nameJa: tags["name:ja"] ?? tags.name ?? "緑地",
          nameEn: tags["name:en"] ?? tags.name ?? "Park",
          kind: tags.leisure ?? tags.landuse ?? "park",
          ring,
          holes: idx === 0 && innerRings.length > 0 ? innerRings : undefined,
        });
        if (idx === 0 && tags.name) {
          registerPoi("rel-park", rel.id, tags, center[0], center[1], 2.2);
        }
      });
    }
  }

  for (const n of nodeById.values()) {
    const tags = n.tags ?? {};
    if (tags.natural === "tree") {
      trees.push([n.lon, n.lat]);
    } else {
      if (tags.man_made === "crane") {
        cranes.push({
          osmId: n.id,
          lon: n.lon,
          lat: n.lat,
          nameJa: tags["name:ja"] ?? tags.name ?? "産業遺産ハンマーヘッドクレーン",
          nameEn: tags["name:en"] ?? tags.name ?? "1914 Hammerhead Crane",
        });
      }
      if (tags.name) {
        registerPoi("node", n.id, tags, n.lon, n.lat, 4.0);
      }
    }
  }

  const pois = Array.from(poiMap.values()).sort((a, b) => a.tier - b.tier || a.nameJa.localeCompare(b.nameJa, "ja"));

  const dataset: OsmShinkoDataset = {
    meta: {
      retrievedAt: new Date().toISOString(),
      bbox: BBOX,
      source: OSM_MAP_URL,
      license: "ODbL 1.0",
      attribution: "© OpenStreetMap contributors",
    },
    coastlineChains,
    waterPolygons,
    piers,
    parks,
    buildings,
    roads,
    trees,
    cranes,
    pois,
  };

  mkdirSync(dirname(OUT_PATH), { recursive: true });
  writeFileSync(OUT_PATH, JSON.stringify(dataset, null, 2), "utf8");
  console.log(
    `[fetchOsm] Saved ${OUT_PATH} | coastlines=${coastlineChains.length}, water=${waterPolygons.length}, piers=${piers.length}, parks=${parks.length}, buildings=${buildings.length}, roads=${roads.length}, trees=${trees.length}, cranes=${cranes.length}, pois=${pois.length}`,
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
