import {
  add3,
  createOrthographicCamera,
  cross3,
  localToWgs84,
  normalize3,
  scale3,
  sub3,
  wgs84ToLocal,
} from "./camera.js";
import { SURFACE_KIND } from "./depth.js";
import { wgs84ToEpsg6677 } from "./epsg6677.js";
import type {
  CameraManifest,
  GroundControlPoint,
  Landmark,
  PoiRecord,
  PortCallRecord,
  Rgb,
  SceneFeatureRecord,
  SceneTriangle,
  SurfaceKind,
  Vec3,
  VehicleKeyframe,
} from "./types.js";

/**
 * Documented Shinko pilot proxy scene (Red Brick Warehouse + Shinko Circle Walk).
 * Built strictly in local EPSG:6677 metric coordinates so the camera,
 * background DZI, depth tiles, road-elevation tiles, and WebGL2 vehicles share
 * one exact transform until FY2024 PLATEAU CityGML meshes are plugged in.
 */

export const SHINKO_ORIGIN_WGS84 = {
  lon: 139.6420,
  lat: 35.4521,
} as const;

export function createShinkoPilotCamera(): CameraManifest {
  const originRaw = wgs84ToEpsg6677(SHINKO_ORIGIN_WGS84.lon, SHINKO_ORIGIN_WGS84.lat);
  return createOrthographicCamera({
    originEpsg6677: {
      easting: Math.round(originRaw.easting),
      northing: Math.round(originRaw.northing),
    },
    centerLocalM: [0, 0, 0],
    azimuthDeg: 225,
    depressionDeg: 45,
    refDistanceM: 1000,
    metersPerPixel: 0.34,
    nearM: 0,
    farM: 2500,
    workingGrid: {
      cols: 2,
      rows: 2,
      tileSizePx: 2048,
      overlapPx: 128,
    },
    dzi: {
      tileSize: 256,
      overlap: 1,
      format: "png",
    },
  });
}

export function createFullYokohamaCamera(): CameraManifest {
  const pilot = createShinkoPilotCamera();
  return {
    ...pilot,
    imageWidthPx: 15488,
    imageHeightPx: 5888,
    imageOriginPx: {
      x: pilot.imageOriginPx.x + 2 * 1920,
      y: pilot.imageOriginPx.y + 1 * 1920,
    },
    workingGrid: {
      cols: 8,
      rows: 3,
      tileSizePx: 2048,
      overlapPx: 128,
      colOffset: -2,
      rowOffset: -1,
    },
    dzi: {
      tileSize: 512,
      overlap: 1,
      format: "png",
    },
    dataTileGrid: {
      tileSizePx: 1024,
      cols: 8,
      rows: 3,
      scale: 0.5,
    },
  };
}

export const FEATURE_IDS = {
  HARBOR_WATER: 1,
  SHINKO_ISLAND: 2,
  MINATO_MIRAI_EDGE: 3,
  KOKUSAI_ODORI: 4,
  SHINKO_CHUO_DORI: 5,
  AKARENGA_DORI: 6,
  CIRCLE_WALK: 7,
  RED_BRICK_2: 8,
  RED_BRICK_1: 9,
  WORLD_PORTERS: 10,
  MARINE_AND_WALK: 11,
  HAMMERHEAD: 12,
  NAVIOS_YOKOHAMA: 13,
  COAST_GUARD_HALL: 14,
  AKARENGA_PARK: 15,
  KISHAMICHI: 16,
  OSANBASHI_APPROACH: 17,
  CUPNOODLES_MUSEUM: 18,
  JICA_YOKOHAMA: 19,
  SHINKO_CENTRAL_SQUARE: 20,
  BANKOKU_BRIDGE: 21,
  CRUISE_SHIP_ASUKA: 22,
  COAST_GUARD_VESSEL: 23,
  ZOU_NO_HANA_TERRACE: 24,
} as const;

export const SHINKO_FEATURES: SceneFeatureRecord[] = [
  {
    featureId: FEATURE_IDS.HARBOR_WATER,
    slug: "yokohama-harbor-water",
    nameJa: "横浜港水面",
    nameEn: "Yokohama Harbor Water",
    surfaceKind: SURFACE_KIND.WATER,
    heightM: 0,
    source: "OSM coastline / documented-proxy",
    notes: "Open harbor water surrounding Shinko Pier and Unga Canal.",
  },
  {
    featureId: FEATURE_IDS.SHINKO_ISLAND,
    slug: "shinko-island-quay",
    nameJa: "新港ふ頭・岸壁",
    nameEn: "Shinko Pier & Quay",
    surfaceKind: SURFACE_KIND.GROUND,
    deckId: "ground-road",
    heightM: 2.0,
    source: "documented-proxy",
    notes: "Island land plateau at +2.0m above harbor datum with vertical quay walls.",
  },
  {
    featureId: FEATURE_IDS.MINATO_MIRAI_EDGE,
    slug: "minato-mirai-canal-edge",
    nameJa: "みなとみらい運河岸壁",
    nameEn: "Minato Mirai Canal Edge",
    surfaceKind: SURFACE_KIND.GROUND,
    deckId: "ground-road",
    heightM: 2.0,
    source: "documented-proxy",
    notes: "Southwestern canal shoreline opposite Shinko Island.",
  },
  {
    featureId: FEATURE_IDS.KOKUSAI_ODORI,
    slug: "kokusai-odori",
    nameJa: "国際大通り",
    nameEn: "Kokusai-Odori Avenue",
    surfaceKind: SURFACE_KIND.ROAD,
    deckId: "ground-road",
    heightM: 2.2,
    source: "documented-proxy",
    notes: "Primary bus corridor passing underneath Shinko Circle Walk.",
  },
  {
    featureId: FEATURE_IDS.SHINKO_CHUO_DORI,
    slug: "shinko-chuo-dori",
    nameJa: "新港中央通り",
    nameEn: "Shinko-Chuo Street",
    surfaceKind: SURFACE_KIND.ROAD,
    deckId: "ground-road",
    heightM: 2.2,
    source: "documented-proxy",
    notes: "Connector between Kokusai-Odori and the Red Brick Warehouse street.",
  },
  {
    featureId: FEATURE_IDS.AKARENGA_DORI,
    slug: "akarenga-dori",
    nameJa: "赤レンガ倉庫通り",
    nameEn: "Red Brick Warehouse Street",
    surfaceKind: SURFACE_KIND.ROAD,
    deckId: "ground-road",
    heightM: 2.2,
    source: "documented-proxy",
    notes: "Street along the inland (SW) side of Red Brick Warehouse No. 2 and No. 1.",
  },
  {
    featureId: FEATURE_IDS.CIRCLE_WALK,
    slug: "shinko-circle-walk",
    nameJa: "新港サークルウォーク",
    nameEn: "Shinko Circle Walk",
    surfaceKind: SURFACE_KIND.BRIDGE_DECK,
    deckId: "circle-walk-deck",
    heightM: 8.0,
    source: "documented-proxy",
    notes: "Elevated annular pedestrian bridge (soffit +5.8m, deck +6.9m, rail +8.0m).",
  },
  {
    featureId: FEATURE_IDS.RED_BRICK_2,
    slug: "red-brick-warehouse-2",
    nameJa: "横浜赤レンガ倉庫 2号館",
    nameEn: "Yokohama Red Brick Warehouse No. 2",
    surfaceKind: SURFACE_KIND.BUILDING,
    heightM: 16.8,
    source: "documented-proxy",
    notes: "Historic brick warehouse crossing the pilot 2x2 vertical tile seam.",
  },
  {
    featureId: FEATURE_IDS.RED_BRICK_1,
    slug: "red-brick-warehouse-1",
    nameJa: "横浜赤レンガ倉庫 1号館",
    nameEn: "Yokohama Red Brick Warehouse No. 1",
    surfaceKind: SURFACE_KIND.BUILDING,
    heightM: 16.8,
    source: "documented-proxy",
    notes: "Historic brick cultural hall on the southeastern plaza.",
  },
  {
    featureId: FEATURE_IDS.WORLD_PORTERS,
    slug: "yokohama-world-porters",
    nameJa: "横浜ワールドポーターズ",
    nameEn: "Yokohama World Porters",
    surfaceKind: SURFACE_KIND.BUILDING,
    heightM: 28.0,
    source: "documented-proxy",
    notes: "Commercial complex north-west of Shinko Circle Walk.",
  },
  {
    featureId: FEATURE_IDS.MARINE_AND_WALK,
    slug: "marine-and-walk-yokohama",
    nameJa: "MARINE & WALK YOKOHAMA",
    nameEn: "MARINE & WALK YOKOHAMA",
    surfaceKind: SURFACE_KIND.BUILDING,
    heightM: 12.0,
    source: "documented-proxy",
    notes: "Open-air waterfront mall facing Shinko Pier.",
  },
  {
    featureId: FEATURE_IDS.HAMMERHEAD,
    slug: "yokohama-hammerhead",
    nameJa: "横浜ハンマーヘッド（新港ふ頭客船ターミナル）",
    nameEn: "Yokohama Hammerhead (Shinko Pier Cruise Terminal)",
    surfaceKind: SURFACE_KIND.BUILDING,
    heightM: 20.0,
    source: "documented-proxy",
    notes: "Cruise terminal and historic 1914 Hammerhead Crane on Berth 9.",
  },
  {
    featureId: FEATURE_IDS.NAVIOS_YOKOHAMA,
    slug: "navios-yokohama",
    nameJa: "ナビオス横浜",
    nameEn: "Navios Yokohama",
    surfaceKind: SURFACE_KIND.BUILDING,
    heightM: 36.0,
    source: "documented-proxy",
    notes: "Iconic gate-shaped waterfront hotel next to Kishamichi.",
  },
  {
    featureId: FEATURE_IDS.COAST_GUARD_HALL,
    slug: "coast-guard-museum",
    nameJa: "海上保安資料館横浜館",
    nameEn: "Japan Coast Guard Museum Yokohama",
    surfaceKind: SURFACE_KIND.BUILDING,
    heightM: 15.0,
    source: "documented-proxy",
    notes: "Maritime museum at the eastern pier edge.",
  },
  {
    featureId: FEATURE_IDS.AKARENGA_PARK,
    slug: "akarenga-park-greenery",
    nameJa: "赤レンガパーク・新港中央広場",
    nameEn: "Red Brick Park & Shinko Central Square",
    surfaceKind: SURFACE_KIND.VEGETATION,
    heightM: 5.5,
    source: "documented-proxy",
    notes: "Waterfront lawns and promenade trees.",
  },
  {
    featureId: FEATURE_IDS.KISHAMICHI,
    slug: "kishamichi-promenade",
    nameJa: "汽車道",
    nameEn: "Kishamichi Promenade",
    surfaceKind: SURFACE_KIND.BRIDGE_DECK,
    deckId: "pedestrian-promenade",
    heightM: 3.4,
    source: "documented-proxy",
    notes: "Historic harbor rail promenade spanning Unga Canal.",
  },
  {
    featureId: FEATURE_IDS.OSANBASHI_APPROACH,
    slug: "zou-no-hana-breakwater",
    nameJa: "象の鼻防波堤・臨港縁",
    nameEn: "Zou-no-hana Breakwater Edge",
    surfaceKind: SURFACE_KIND.QUAY,
    heightM: 2.2,
    source: "documented-proxy",
    notes: "Curved harbor breakwater south-east of Red Brick Park.",
  },
  {
    featureId: FEATURE_IDS.CUPNOODLES_MUSEUM,
    slug: "cupnoodles-museum-yokohama",
    nameJa: "カップヌードルミュージアム 横浜",
    nameEn: "Cup Noodles Museum Yokohama",
    surfaceKind: SURFACE_KIND.BUILDING,
    heightM: 24.0,
    source: "documented-proxy",
    notes: "Stepped waterfront museum northwest of World Porters.",
  },
  {
    featureId: FEATURE_IDS.JICA_YOKOHAMA,
    slug: "jica-yokohama",
    nameJa: "JICA 横浜",
    nameEn: "JICA Yokohama",
    surfaceKind: SURFACE_KIND.BUILDING,
    heightM: 22.0,
    source: "documented-proxy",
    notes: "International cooperation center southeast of Circle Walk.",
  },
  {
    featureId: FEATURE_IDS.SHINKO_CENTRAL_SQUARE,
    slug: "shinko-central-square",
    nameJa: "新港中央広場",
    nameEn: "Shinko Central Square",
    surfaceKind: SURFACE_KIND.VEGETATION,
    heightM: 2.3,
    source: "documented-proxy",
    notes: "Landscaped lawns, walkways and flowerbeds linking Circle Walk and Red Brick.",
  },
  {
    featureId: FEATURE_IDS.BANKOKU_BRIDGE,
    slug: "bankoku-bridge",
    nameJa: "万国橋",
    nameEn: "Bankoku Bridge",
    surfaceKind: SURFACE_KIND.BRIDGE_DECK,
    deckId: "ground-road",
    heightM: 3.0,
    source: "documented-proxy",
    notes: "Concrete arch road bridge carrying Kokusai-Odori across the canal.",
  },
  {
    featureId: FEATURE_IDS.CRUISE_SHIP_ASUKA,
    slug: "cruise-ship-berth9",
    nameJa: "新港ふ頭9号岸壁 着岸客船",
    nameEn: "Docked Cruise Ship (Berth 9)",
    surfaceKind: SURFACE_KIND.QUAY,
    heightM: 24.0,
    source: "documented-proxy",
    notes: "Miniature passenger vessel docked at Hammerhead Berth 9.",
  },
  {
    featureId: FEATURE_IDS.COAST_GUARD_VESSEL,
    slug: "coast-guard-patrol-vessel",
    nameJa: "海上保安庁 巡視船",
    nameEn: "Japan Coast Guard Patrol Vessel",
    surfaceKind: SURFACE_KIND.QUAY,
    heightM: 12.0,
    source: "documented-proxy",
    notes: "Patrol ship moored beside the Coast Guard maritime base.",
  },
  {
    featureId: FEATURE_IDS.ZOU_NO_HANA_TERRACE,
    slug: "zou-no-hana-terrace",
    nameJa: "象の鼻テラス・パーク",
    nameEn: "Zou-no-hana Terrace & Park",
    surfaceKind: SURFACE_KIND.QUAY,
    heightM: 6.5,
    source: "documented-proxy",
    notes: "Waterfront glass pavilion and timber boardwalk at the southern pier.",
  },
];

// Shinko Island main polygon in WGS84 (closed counterclockwise, lon/lat)
export const SHINKO_ISLAND_RING_WGS84: ReadonlyArray<readonly [number, number]> = [
  [139.6383, 35.4513],
  [139.6401, 35.4508],
  [139.6421, 35.4504],
  [139.6442, 35.4509],
  [139.6449, 35.4518],
  [139.6448, 35.4539],
  [139.6438, 35.4557],
  [139.6422, 35.4559],
  [139.6404, 35.4549],
  [139.6393, 35.4556],
  [139.6378, 35.4548],
  [139.6373, 35.4526],
];

// Southwestern Minato Mirai / Bankoku canal corner
export const MINATO_MIRAI_CORNER_RING_WGS84: ReadonlyArray<readonly [number, number]> = [
  [139.6352, 35.4494],
  [139.6385, 35.4493],
  [139.6389, 35.4502],
  [139.6368, 35.4517],
  [139.6350, 35.4514],
];

function computeNormal(v0: Vec3, v1: Vec3, v2: Vec3): Vec3 {
  const n = cross3(sub3(v1, v0), sub3(v2, v0));
  const len = Math.hypot(n[0], n[1], n[2]);
  if (len < 1e-8) {
    return [0, 0, 1];
  }
  return [n[0] / len, n[1] / len, n[2] / len];
}

export function pushTri(
  out: SceneTriangle[],
  v0: Vec3,
  v1: Vec3,
  v2: Vec3,
  featureId: number,
  surfaceKind: SurfaceKind,
  plainRgb: Rgb,
  illustratedRgb: Rgb,
  deckId?: string,
  materialTag?: SceneTriangle["materialTag"],
): void {
  out.push({
    v0,
    v1,
    v2,
    normal: computeNormal(v0, v1, v2),
    featureId,
    surfaceKind,
    plainRgb,
    illustratedRgb,
    deckId,
    materialTag,
  });
}

export function pushQuad(
  out: SceneTriangle[],
  a: Vec3,
  b: Vec3,
  c: Vec3,
  d: Vec3,
  featureId: number,
  surfaceKind: SurfaceKind,
  plainRgb: Rgb,
  illustratedRgb: Rgb,
  deckId?: string,
  materialTag?: SceneTriangle["materialTag"],
): void {
  pushTri(out, a, b, c, featureId, surfaceKind, plainRgb, illustratedRgb, deckId, materialTag);
  pushTri(out, a, c, d, featureId, surfaceKind, plainRgb, illustratedRgb, deckId, materialTag);
}

export function earClipOrFanPolygon(
  out: SceneTriangle[],
  ringXY: ReadonlyArray<readonly [number, number]>,
  z: number,
  featureId: number,
  surfaceKind: SurfaceKind,
  plainRgb: Rgb,
  illustratedRgb: Rgb,
  deckId?: string,
  materialTag?: SceneTriangle["materialTag"],
): void {
  // Ear-clipping triangulation for arbitrary simple concave/convex polygons (dedupe consecutive pts first)
  const pts: Array<{ x: number; y: number }> = [];
  for (const p of ringXY) {
    const prev = pts[pts.length - 1];
    if (!prev || Math.hypot(p[0] - prev.x, p[1] - prev.y) > 1e-4) {
      pts.push({ x: p[0], y: p[1] });
    }
  }
  if (pts.length >= 2 && Math.hypot(pts[0]!.x - pts[pts.length - 1]!.x, pts[0]!.y - pts[pts.length - 1]!.y) <= 1e-4) {
    pts.pop();
  }
  if (pts.length < 3) return;

  // Ensure CCW winding
  let area2 = 0;
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i]!;
    const q = pts[(i + 1) % pts.length]!;
    area2 += p.x * q.y - q.x * p.y;
  }
  if (area2 < 0) pts.reverse();

  const indices = pts.map((_, idx) => idx);
  const cross2 = (ax: number, ay: number, bx: number, by: number, cx: number, cy: number) =>
    (bx - ax) * (cy - ay) - (by - ay) * (cx - ax);
  const pointInTri = (
    px: number,
    py: number,
    ax: number,
    ay: number,
    bx: number,
    by: number,
    cx: number,
    cy: number,
  ) => {
    const c1 = cross2(ax, ay, bx, by, px, py);
    const c2 = cross2(bx, by, cx, cy, px, py);
    const c3 = cross2(cx, cy, ax, ay, px, py);
    return c1 >= -1e-6 && c2 >= -1e-6 && c3 >= -1e-6;
  };

  let guard = 0;
  while (indices.length > 3 && guard < 10000) {
    guard++;
    let clipped = false;
    for (let i = 0; i < indices.length; i++) {
      const iPrev = indices[(i + indices.length - 1) % indices.length]!;
      const iCurr = indices[i]!;
      const iNext = indices[(i + 1) % indices.length]!;
      const a = pts[iPrev]!;
      const b = pts[iCurr]!;
      const c = pts[iNext]!;
      if (cross2(a.x, a.y, b.x, b.y, c.x, c.y) <= 1e-6) continue;

      let containsOther = false;
      for (let j = 0; j < indices.length; j++) {
        const idx = indices[j]!;
        if (idx === iPrev || idx === iCurr || idx === iNext) continue;
        const p = pts[idx]!;
        if (pointInTri(p.x, p.y, a.x, a.y, b.x, b.y, c.x, c.y)) {
          containsOther = true;
          break;
        }
      }
      if (!containsOther) {
        pushTri(
          out,
          [a.x, a.y, z],
          [b.x, b.y, z],
          [c.x, c.y, z],
          featureId,
          surfaceKind,
          plainRgb,
          illustratedRgb,
          deckId,
          materialTag,
        );
        indices.splice(i, 1);
        clipped = true;
        break;
      }
    }
    if (!clipped) break;
  }

  if (indices.length === 3) {
    const a = pts[indices[0]!]!;
    const b = pts[indices[1]!]!;
    const c = pts[indices[2]!]!;
    pushTri(
      out,
      [a.x, a.y, z],
      [b.x, b.y, z],
      [c.x, c.y, z],
      featureId,
      surfaceKind,
      plainRgb,
      illustratedRgb,
      deckId,
      materialTag,
    );
  }
}

export function addExtrudedPrism(
  out: SceneTriangle[],
  ringXY: ReadonlyArray<readonly [number, number]>,
  zBottom: number,
  zTop: number,
  featureId: number,
  topKind: SurfaceKind,
  sideKind: SurfaceKind,
  topPlain: Rgb,
  topIllus: Rgb,
  sidePlain: Rgb,
  sideIllus: Rgb,
  deckId?: string,
  topTag?: SceneTriangle["materialTag"],
  sideTag?: SceneTriangle["materialTag"],
): void {
  earClipOrFanPolygon(out, ringXY, zTop, featureId, topKind, topPlain, topIllus, deckId, topTag);
  for (let i = 0; i < ringXY.length; i++) {
    const p0 = ringXY[i]!;
    const p1 = ringXY[(i + 1) % ringXY.length]!;
    pushQuad(
      out,
      [p0[0], p0[1], zBottom],
      [p1[0], p1[1], zBottom],
      [p1[0], p1[1], zTop],
      [p0[0], p0[1], zTop],
      featureId,
      sideKind,
      sidePlain,
      sideIllus,
      deckId,
      sideTag,
    );
  }
}

export function orientedRectXY(
  cx: number,
  cy: number,
  lengthM: number,
  widthM: number,
  angleRad: number,
): Array<[number, number]> {
  const cos = Math.cos(angleRad);
  const sin = Math.sin(angleRad);
  const hl = lengthM * 0.5;
  const hw = widthM * 0.5;
  const local: Array<[number, number]> = [
    [-hl, -hw],
    [hl, -hw],
    [hl, hw],
    [-hl, hw],
  ];
  return local.map(([lx, ly]) => [cx + lx * cos - ly * sin, cy + lx * sin + ly * cos]);
}

export function addGabledBuilding(
  out: SceneTriangle[],
  cx: number,
  cy: number,
  lengthM: number,
  widthM: number,
  angleRad: number,
  zBase: number,
  zEave: number,
  zRidge: number,
  featureId: number,
  wallPlain: Rgb,
  wallIllus: Rgb,
  roofPlain: Rgb,
  roofIllus: Rgb,
  wallTag: SceneTriangle["materialTag"] = "brick",
  roofTag: SceneTriangle["materialTag"] = "roof",
): void {
  const cos = Math.cos(angleRad);
  const sin = Math.sin(angleRad);
  const toWorld = (lx: number, ly: number, z: number): Vec3 => [
    cx + lx * cos - ly * sin,
    cy + lx * sin + ly * cos,
    z,
  ];
  const hl = lengthM * 0.5;
  const hw = widthM * 0.5;

  // Base corners
  const b0 = toWorld(-hl, -hw, zBase);
  const b1 = toWorld(hl, -hw, zBase);
  const b2 = toWorld(hl, hw, zBase);
  const b3 = toWorld(-hl, hw, zBase);

  const e0 = toWorld(-hl, -hw, zEave);
  const e1 = toWorld(hl, -hw, zEave);
  const e2 = toWorld(hl, hw, zEave);
  const e3 = toWorld(-hl, hw, zEave);

  const r0 = toWorld(-hl, 0, zRidge);
  const r1 = toWorld(hl, 0, zRidge);

  // 4 walls
  pushQuad(out, b0, b1, e1, e0, featureId, SURFACE_KIND.BUILDING, wallPlain, wallIllus, undefined, wallTag);
  pushQuad(out, b1, b2, e2, e1, featureId, SURFACE_KIND.BUILDING, wallPlain, wallIllus, undefined, wallTag);
  pushQuad(out, b2, b3, e3, e2, featureId, SURFACE_KIND.BUILDING, wallPlain, wallIllus, undefined, wallTag);
  pushQuad(out, b3, b0, e0, e3, featureId, SURFACE_KIND.BUILDING, wallPlain, wallIllus, undefined, wallTag);

  // Gable triangles
  pushTri(out, e0, e3, r0, featureId, SURFACE_KIND.BUILDING, wallPlain, wallIllus, undefined, wallTag);
  pushTri(out, e1, r1, e2, featureId, SURFACE_KIND.BUILDING, wallPlain, wallIllus, undefined, wallTag);

  // Two roof slopes
  pushQuad(out, e0, e1, r1, r0, featureId, SURFACE_KIND.BUILDING, roofPlain, roofIllus, undefined, roofTag);
  pushQuad(out, e3, r0, r1, e2, featureId, SURFACE_KIND.BUILDING, roofPlain, roofIllus, undefined, roofTag);
}

export function addRoadStrip(
  out: SceneTriangle[],
  p0: readonly [number, number],
  p1: readonly [number, number],
  widthM: number,
  z: number,
  featureId: number,
  plainRgb: Rgb,
  illusRgb: Rgb,
): void {
  const dx = p1[0] - p0[0];
  const dy = p1[1] - p0[1];
  const len = Math.hypot(dx, dy);
  if (len < 1e-3) return;
  const nx = (-dy / len) * (widthM * 0.5);
  const ny = (dx / len) * (widthM * 0.5);
  pushQuad(
    out,
    [p0[0] + nx, p0[1] + ny, z],
    [p0[0] - nx, p0[1] - ny, z],
    [p1[0] - nx, p1[1] - ny, z],
    [p1[0] + nx, p1[1] + ny, z],
    featureId,
    SURFACE_KIND.ROAD,
    plainRgb,
    illusRgb,
    "ground-road",
    "asphalt",
  );
}

function addAnnularBridge(
  out: SceneTriangle[],
  cx: number,
  cy: number,
  innerR: number,
  outerR: number,
  zSoffit: number,
  zDeck: number,
  zRail: number,
  segments: number,
  featureId: number,
): void {
  const deckPlain: Rgb = [194, 198, 204];
  const deckIllus: Rgb = [228, 214, 194];
  const sidePlain: Rgb = [164, 168, 176];
  const sideIllus: Rgb = [192, 178, 160];
  const railPlain: Rgb = [132, 138, 148];
  const railIllus: Rgb = [96, 114, 130];

  for (let i = 0; i < segments; i++) {
    const a0 = (i / segments) * Math.PI * 2;
    const a1 = ((i + 1) / segments) * Math.PI * 2;
    const c0 = Math.cos(a0);
    const s0 = Math.sin(a0);
    const c1 = Math.cos(a1);
    const s1 = Math.sin(a1);

    const i0: Vec3 = [cx + innerR * c0, cy + innerR * s0, zDeck];
    const o0: Vec3 = [cx + outerR * c0, cy + outerR * s0, zDeck];
    const o1: Vec3 = [cx + outerR * c1, cy + outerR * s1, zDeck];
    const i1: Vec3 = [cx + innerR * c1, cy + innerR * s1, zDeck];

    // Deck top
    pushQuad(out, i0, o0, o1, i1, featureId, SURFACE_KIND.BRIDGE_DECK, deckPlain, deckIllus, "circle-walk-deck", "deck");

    // Bottom soffit (still part of bridge deck volume)
    const bi0: Vec3 = [i0[0], i0[1], zSoffit];
    const bo0: Vec3 = [o0[0], o0[1], zSoffit];
    const bo1: Vec3 = [o1[0], o1[1], zSoffit];
    const bi1: Vec3 = [i1[0], i1[1], zSoffit];
    pushQuad(out, bo0, bi0, bi1, bo1, featureId, SURFACE_KIND.BRIDGE_DECK, sidePlain, sideIllus, "circle-walk-deck", "deck");

    // Outer fascia + handrail
    pushQuad(out, bo0, bo1, o1, o0, featureId, SURFACE_KIND.BRIDGE_DECK, sidePlain, sideIllus, "circle-walk-deck", "deck");
    pushQuad(
      out,
      o0,
      o1,
      [o1[0], o1[1], zRail],
      [o0[0], o0[1], zRail],
      featureId,
      SURFACE_KIND.BRIDGE_DECK,
      railPlain,
      railIllus,
      "circle-walk-deck",
      "deck",
    );

    // Inner fascia + handrail
    pushQuad(out, bi1, bi0, i0, i1, featureId, SURFACE_KIND.BRIDGE_DECK, sidePlain, sideIllus, "circle-walk-deck", "deck");
    pushQuad(
      out,
      i1,
      i0,
      [i0[0], i0[1], zRail],
      [i1[0], i1[1], zRail],
      featureId,
      SURFACE_KIND.BRIDGE_DECK,
      railPlain,
      railIllus,
      "circle-walk-deck",
      "deck",
    );
  }

  // Four support piers tucked strictly outside the road carriageways (at 0, 90, 180, 270 deg)
  for (const angleDeg of [0, 90, 180, 270]) {
    const rad = (angleDeg * Math.PI) / 180;
    const px = cx + (outerR - 1.2) * Math.cos(rad);
    const py = cy + (outerR - 1.2) * Math.sin(rad);
    const pier = orientedRectXY(px, py, 2.2, 2.2, rad);
    addExtrudedPrism(
      out,
      pier,
      2.0,
      zSoffit,
      featureId,
      SURFACE_KIND.BRIDGE_SUPPORT,
      SURFACE_KIND.BRIDGE_SUPPORT,
      [152, 156, 162],
      [166, 158, 146],
      [142, 146, 152],
      [156, 148, 138],
      undefined,
      "concrete",
      "concrete",
    );
  }
}

export function addTree(
  out: SceneTriangle[],
  cx: number,
  cy: number,
  scale: number,
  featureId: number,
  toneShift = 0,
): void {
  const trunk = orientedRectXY(cx, cy, 0.9 * scale, 0.9 * scale, 0.4);
  addExtrudedPrism(
    out,
    trunk,
    2.0,
    2.0 + 2.4 * scale,
    featureId,
    SURFACE_KIND.VEGETATION,
    SURFACE_KIND.VEGETATION,
    [104, 82, 62],
    [114, 84, 58],
    [94, 72, 54],
    [104, 76, 52],
    undefined,
    "wood",
    "wood",
  );

  const ring = (r: number, n: number, rot: number) =>
    Array.from({ length: n }, (_, i) => {
      const a = rot + (i / n) * Math.PI * 2;
      return [cx + r * Math.cos(a), cy + r * Math.sin(a)] as [number, number];
    });

  const c1Plain: Rgb = [86 + toneShift, 134 + toneShift, 82];
  const c1Illus: Rgb = [78 + toneShift, 142 + toneShift, 86];
  const c2Plain: Rgb = [104 + toneShift, 154 + toneShift, 94];
  const c2Illus: Rgb = [102 + toneShift, 164 + toneShift, 96];

  addExtrudedPrism(
    out,
    ring(3.6 * scale, 8, 0.2),
    2.0 + 2.1 * scale,
    2.0 + 4.8 * scale,
    featureId,
    SURFACE_KIND.VEGETATION,
    SURFACE_KIND.VEGETATION,
    c1Plain,
    c1Illus,
    [68 + toneShift, 114 + toneShift, 68],
    [64 + toneShift, 122 + toneShift, 72],
    undefined,
    "park",
    "park",
  );
  addExtrudedPrism(
    out,
    ring(2.3 * scale, 8, 0.6),
    2.0 + 4.8 * scale,
    2.0 + 6.4 * scale,
    featureId,
    SURFACE_KIND.VEGETATION,
    SURFACE_KIND.VEGETATION,
    c2Plain,
    c2Illus,
    c1Plain,
    c1Illus,
    undefined,
    "park",
    "park",
  );
}

export function addRoadMarkings(
  out: SceneTriangle[],
  p0: readonly [number, number],
  p1: readonly [number, number],
  widthM: number,
  z: number,
  featureId: number,
): void {
  const dx = p1[0] - p0[0];
  const dy = p1[1] - p0[1];
  const len = Math.hypot(dx, dy);
  if (len < 12) return;
  const angle = Math.atan2(dy, dx);
  const ux = dx / len;
  const uy = dy / len;

  // Center dashed line
  for (let s = 10; s < len - 10; s += 11) {
    const dashLen = Math.min(4.5, len - 10 - s);
    if (dashLen <= 1) break;
    const mx = p0[0] + ux * (s + dashLen * 0.5);
    const my = p0[1] + uy * (s + dashLen * 0.5);
    earClipOrFanPolygon(
      out,
      orientedRectXY(mx, my, dashLen, 0.36, angle),
      z,
      featureId,
      SURFACE_KIND.ROAD,
      [226, 228, 232],
      [242, 240, 232],
      "ground-road",
      "marking",
    );
  }

  // Zebra crosswalks near both ends
  for (const endS of [6, len - 6]) {
    const cx = p0[0] + ux * endS;
    const cy = p0[1] + uy * endS;
    const nx = -uy;
    const ny = ux;
    const halfW = widthM * 0.42;
    for (let t = -halfW; t <= halfW; t += 1.6) {
      earClipOrFanPolygon(
        out,
        orientedRectXY(cx + nx * t, cy + ny * t, 3.2, 0.68, angle),
        z,
        featureId,
        SURFACE_KIND.ROAD,
        [232, 234, 238],
        [244, 242, 236],
        "ground-road",
        "marking",
      );
    }
  }
}

export function addShip(
  out: SceneTriangle[],
  cx: number,
  cy: number,
  lengthM: number,
  widthM: number,
  angleRad: number,
  featureId: number,
  isCruise: boolean,
): void {
  const cos = Math.cos(angleRad);
  const sin = Math.sin(angleRad);
  const rotPt = (lx: number, ly: number): [number, number] => [
    cx + lx * cos - ly * sin,
    cy + lx * sin + ly * cos,
  ];
  const hl = lengthM * 0.5;
  const hw = widthM * 0.5;

  // Pointed bow + transom stern hull
  const hullRing: Array<[number, number]> = [
    rotPt(-hl * 0.92, -hw * 0.72),
    rotPt(hl * 0.58, -hw),
    rotPt(hl * 1.04, 0),
    rotPt(hl * 0.58, hw),
    rotPt(-hl * 0.92, hw * 0.72),
  ];

  const hullPlain: Rgb = isCruise ? [36, 56, 86] : [214, 222, 230];
  const hullIllus: Rgb = isCruise ? [34, 58, 96] : [228, 234, 240];
  addExtrudedPrism(
    out,
    hullRing,
    0.0,
    isCruise ? 6.2 : 3.4,
    featureId,
    SURFACE_KIND.QUAY,
    SURFACE_KIND.QUAY,
    [224, 212, 194],
    [232, 218, 196],
    hullPlain,
    hullIllus,
    undefined,
    "ship",
    "ship",
  );

  // White passenger superstructure tiers
  const tiers = isCruise
    ? [
        { len: lengthM * 0.72, wid: widthM * 0.82, z0: 6.2, z1: 12.2, shiftX: -hl * 0.04 },
        { len: lengthM * 0.56, wid: widthM * 0.68, z0: 12.2, z1: 17.6, shiftX: -hl * 0.02 },
        { len: lengthM * 0.34, wid: widthM * 0.52, z0: 17.6, z1: 21.4, shiftX: hl * 0.06 },
      ]
    : [
        { len: lengthM * 0.52, wid: widthM * 0.72, z0: 3.4, z1: 7.4, shiftX: hl * 0.05 },
        { len: lengthM * 0.24, wid: widthM * 0.84, z0: 7.4, z1: 9.8, shiftX: hl * 0.14 },
      ];

  for (const t of tiers) {
    const [tx, ty] = rotPt(t.shiftX, 0);
    addExtrudedPrism(
      out,
      orientedRectXY(tx, ty, t.len, t.wid, angleRad),
      t.z0,
      t.z1,
      featureId,
      SURFACE_KIND.QUAY,
      SURFACE_KIND.QUAY,
      [238, 240, 244],
      [248, 246, 240],
      [212, 218, 226],
      [226, 230, 236],
      undefined,
      "ship",
      "ship",
    );
  }

  // Funnel
  const [fx, fy] = rotPt(-hl * 0.18, 0);
  const fTopZ = isCruise ? 24.8 : 11.8;
  const fBotZ = isCruise ? 21.0 : 9.0;
  addExtrudedPrism(
    out,
    orientedRectXY(fx, fy, widthM * 0.34, widthM * 0.26, angleRad),
    fBotZ,
    fTopZ,
    featureId,
    SURFACE_KIND.QUAY,
    SURFACE_KIND.QUAY,
    [48, 52, 60],
    [54, 56, 64],
    isCruise ? [184, 54, 48] : [36, 98, 168],
    isCruise ? [202, 58, 52] : [42, 114, 186],
    undefined,
    "ship",
    "ship",
  );
}

export function addSailboat(
  out: SceneTriangle[],
  cx: number,
  cy: number,
  angleRad: number,
  featureId: number,
): void {
  const cos = Math.cos(angleRad);
  const sin = Math.sin(angleRad);
  const rotPt = (lx: number, ly: number): [number, number] => [
    cx + lx * cos - ly * sin,
    cy + lx * sin + ly * cos,
  ];
  const hull: Array<[number, number]> = [
    rotPt(-5.5, -1.6),
    rotPt(2.5, -1.9),
    rotPt(6.5, 0),
    rotPt(2.5, 1.9),
    rotPt(-5.5, 1.6),
  ];
  addExtrudedPrism(
    out,
    hull,
    0.0,
    1.5,
    featureId,
    SURFACE_KIND.QUAY,
    SURFACE_KIND.QUAY,
    [244, 244, 240],
    [250, 248, 242],
    [216, 222, 228],
    [226, 230, 236],
    undefined,
    "ship",
    "ship",
  );
  // White triangular sail
  const sBase0 = rotPt(-1.5, 0);
  const sBase1 = rotPt(3.8, 0);
  const sPeak = rotPt(-0.8, 0.2);
  pushTri(
    out,
    [sBase0[0], sBase0[1], 1.8],
    [sBase1[0], sBase1[1], 1.8],
    [sPeak[0], sPeak[1], 11.5],
    featureId,
    SURFACE_KIND.QUAY,
    [248, 248, 250],
    [252, 250, 246],
    undefined,
    "ship",
  );
}

export interface ShinkoSceneBundle {
  camera: CameraManifest;
  triangles: SceneTriangle[];
  landmarks: Landmark[];
  gcps: GroundControlPoint[];
  syntheticKeyframes: VehicleKeyframe[];
  syntheticLoopDurationSec: number;
  deckTestPoint: {
    lon: number;
    lat: number;
    elevationM: number;
    deckId: string;
  };
  portCalls: PortCallRecord[];
  landPolygonsLocal: Array<Array<[number, number]>>;
  features?: SceneFeatureRecord[];
  pois?: PoiRecord[];
  osmAttribution?: string;
}

export function buildShinkoPilotScene(): ShinkoSceneBundle {
  const camera = createShinkoPilotCamera();
  const triangles: SceneTriangle[] = [];
  const toXY = (lon: number, lat: number): [number, number] => {
    const v = wgs84ToLocal(camera, lon, lat, 0);
    return [v[0], v[1]];
  };

  // 1. Harbor Water Plane spanning entire 3968x3968 orthographic projection (+/- 1800m)
  const wSize = 1800;
  pushQuad(
    triangles,
    [-wSize, -wSize, 0],
    [wSize, -wSize, 0],
    [wSize, wSize, 0],
    [-wSize, wSize, 0],
    FEATURE_IDS.HARBOR_WATER,
    SURFACE_KIND.WATER,
    [68, 122, 160],
    [54, 118, 164],
    undefined,
    "water",
  );

  // 2. Shinko Island & Minato Mirai Land Plateaus (+2.0m) with vertical quay walls (0 -> +2.0m)
  const shinkoXY = SHINKO_ISLAND_RING_WGS84.map(([lon, lat]) => toXY(lon, lat));
  const mmXY = MINATO_MIRAI_CORNER_RING_WGS84.map(([lon, lat]) => toXY(lon, lat));

  addExtrudedPrism(
    triangles,
    shinkoXY,
    0,
    2.0,
    FEATURE_IDS.SHINKO_ISLAND,
    SURFACE_KIND.GROUND,
    SURFACE_KIND.QUAY,
    [214, 208, 194],
    [232, 224, 208],
    [136, 132, 126],
    [122, 118, 110],
    "ground-road",
    "concrete",
    "quay",
  );

  addExtrudedPrism(
    triangles,
    mmXY,
    0,
    2.0,
    FEATURE_IDS.MINATO_MIRAI_EDGE,
    SURFACE_KIND.GROUND,
    SURFACE_KIND.QUAY,
    [206, 202, 190],
    [224, 218, 204],
    [136, 132, 126],
    [122, 118, 110],
    "ground-road",
    "concrete",
    "quay",
  );

  // 3. Key geographic nodes in local metres
  const cwCenter = toXY(139.6394, 35.4531); // Shinko Circle Walk
  const wpCenter = toXY(139.6388, 35.4543); // World Porters
  const naviosCenter = toXY(139.6379, 35.4519); // Navios Yokohama
  const mwCenter = toXY(139.6416, 35.4544); // Marine & Walk
  const hhCenter = toXY(139.6428, 35.4552); // Hammerhead
  const cgCenter = toXY(139.6442, 35.4535); // Coast Guard Hall

  // Red Brick Warehouse No. 2 oriented along NW-SE (~-42 deg), crossing the 2x2 vertical tile seam
  const rb2Nw = toXY(139.6419, 35.4536);
  const rb2Se = toXY(139.6430, 35.4526);
  const rb2Center: [number, number] = [
    (rb2Nw[0] + rb2Se[0]) * 0.5,
    (rb2Nw[1] + rb2Se[1]) * 0.5,
  ];
  const rb2Angle = Math.atan2(rb2Se[1] - rb2Nw[1], rb2Se[0] - rb2Nw[0]);
  const rb2Len = Math.hypot(rb2Se[0] - rb2Nw[0], rb2Se[1] - rb2Nw[1]) + 18;

  // Red Brick Warehouse No. 1 SE of No. 2
  const rb1Center = toXY(139.6437, 35.4518);

  // Road corridor axes derived strictly from Circle Walk and Red Brick Warehouse No. 2 geometry
  const d1Unit = normalize3([Math.cos(rb2Angle), Math.sin(rb2Angle), 0]); // NW -> SE
  const d1Perp: [number, number] = [-d1Unit[1], d1Unit[0]]; // +NE perpendicular

  const kokusaiStart: [number, number] = [
    cwCenter[0] - d1Unit[0] * 145,
    cwCenter[1] - d1Unit[1] * 145,
  ];
  const kokusaiTurn: [number, number] = [
    cwCenter[0] + d1Unit[0] * 105,
    cwCenter[1] + d1Unit[1] * 105,
  ];
  const kokusaiEnd: [number, number] = [
    cwCenter[0] + d1Unit[0] * 260,
    cwCenter[1] + d1Unit[1] * 260,
  ];

  // Street along inland (SW) side of Red Brick Warehouse No. 2 (17m SW of building centerline; 6m clear of wall)
  const rbStreetMid: [number, number] = [
    rb2Center[0] - d1Perp[0] * 17,
    rb2Center[1] - d1Perp[1] * 17,
  ];
  const rbStreetNw: [number, number] = [
    rbStreetMid[0] - d1Unit[0] * 92,
    rbStreetMid[1] - d1Unit[1] * 92,
  ];
  const rbStreetSe: [number, number] = [
    rbStreetMid[0] + d1Unit[0] * 168,
    rbStreetMid[1] + d1Unit[1] * 168,
  ];

  // 4. Sidewalks (+2.08m), Road Network (+2.15m), & Road Markings (+2.18m, deckId: "ground-road")
  const sidePlain: Rgb = [194, 190, 182];
  const sideIllus: Rgb = [214, 206, 192];
  const roadPlain: Rgb = [88, 94, 102];
  const roadIllus: Rgb = [84, 92, 104];

  // Sidewalk curbstones underneath roads
  addRoadStrip(triangles, kokusaiStart, kokusaiEnd, 20, 2.08, FEATURE_IDS.SHINKO_ISLAND, sidePlain, sideIllus);
  addRoadStrip(triangles, kokusaiTurn, rbStreetNw, 18, 2.08, FEATURE_IDS.SHINKO_ISLAND, sidePlain, sideIllus);
  addRoadStrip(triangles, rbStreetNw, rbStreetSe, 18, 2.08, FEATURE_IDS.SHINKO_ISLAND, sidePlain, sideIllus);
  addRoadStrip(
    triangles,
    [cwCenter[0], cwCenter[1]],
    [cwCenter[0] + d1Perp[0] * 210, cwCenter[1] + d1Perp[1] * 210],
    17,
    2.08,
    FEATURE_IDS.SHINKO_ISLAND,
    sidePlain,
    sideIllus,
  );

  // Road carriageways
  addRoadStrip(triangles, kokusaiStart, kokusaiEnd, 14, 2.15, FEATURE_IDS.KOKUSAI_ODORI, roadPlain, roadIllus);
  addRoadStrip(triangles, kokusaiTurn, rbStreetNw, 12, 2.15, FEATURE_IDS.SHINKO_CHUO_DORI, roadPlain, roadIllus);
  addRoadStrip(triangles, rbStreetNw, rbStreetSe, 12, 2.15, FEATURE_IDS.AKARENGA_DORI, roadPlain, roadIllus);
  addRoadStrip(
    triangles,
    [cwCenter[0], cwCenter[1]],
    [cwCenter[0] + d1Perp[0] * 210, cwCenter[1] + d1Perp[1] * 210],
    11,
    2.14,
    FEATURE_IDS.SHINKO_CHUO_DORI,
    roadPlain,
    roadIllus,
  );

  // Lane markings & crosswalks
  addRoadMarkings(triangles, kokusaiStart, kokusaiEnd, 14, 2.18, FEATURE_IDS.KOKUSAI_ODORI);
  addRoadMarkings(triangles, kokusaiTurn, rbStreetNw, 12, 2.18, FEATURE_IDS.SHINKO_CHUO_DORI);
  addRoadMarkings(triangles, rbStreetNw, rbStreetSe, 12, 2.18, FEATURE_IDS.AKARENGA_DORI);
  addRoadMarkings(
    triangles,
    [cwCenter[0], cwCenter[1]],
    [cwCenter[0] + d1Perp[0] * 210, cwCenter[1] + d1Perp[1] * 210],
    11,
    2.17,
    FEATURE_IDS.SHINKO_CHUO_DORI,
  );

  // Red Brick bus stop shelter bay along inland side of Akarenga-dori (strictly clear of lane)
  addExtrudedPrism(
    triangles,
    orientedRectXY(rb2Center[0] - d1Perp[0] * 25.5 + d1Unit[0] * 44, rb2Center[1] - d1Perp[1] * 25.5 + d1Unit[1] * 44, 11, 2.8, rb2Angle),
    2.1,
    4.6,
    FEATURE_IDS.AKARENGA_DORI,
    SURFACE_KIND.BRIDGE_DECK,
    SURFACE_KIND.BRIDGE_SUPPORT,
    [32, 112, 168],
    [28, 122, 182],
    [164, 178, 192],
    [182, 196, 210],
    undefined,
    "glass",
    "glass",
  );

  // 4b. Bankoku Bridge spanning Unga Canal at the SW end of Kokusai-Odori
  const bankokuA = toXY(139.6377, 35.4508);
  const bankokuB = toXY(139.6386, 35.4517);
  const bankokuAngle = Math.atan2(bankokuB[1] - bankokuA[1], bankokuB[0] - bankokuA[0]);
  const bankokuLen = Math.hypot(bankokuB[0] - bankokuA[0], bankokuB[1] - bankokuA[1]) + 10;
  addExtrudedPrism(
    triangles,
    orientedRectXY((bankokuA[0] + bankokuB[0]) * 0.5, (bankokuA[1] + bankokuB[1]) * 0.5, bankokuLen, 16, bankokuAngle),
    0.8,
    2.5,
    FEATURE_IDS.BANKOKU_BRIDGE,
    SURFACE_KIND.ROAD,
    SURFACE_KIND.QUAY,
    [136, 134, 132],
    [152, 146, 138],
    [164, 158, 148],
    [176, 168, 154],
    "ground-road",
    "sidewalk",
    "concrete",
  );
  addRoadStrip(triangles, bankokuA, bankokuB, 11, 2.6, FEATURE_IDS.BANKOKU_BRIDGE, roadPlain, roadIllus);

  // 5. Kishamichi Pedestrian Promenade across Unga Canal + twin steel trusses
  const kishaA = toXY(139.6373, 35.4510);
  const kishaB = toXY(139.6386, 35.4525);
  const kishaDx = kishaB[0] - kishaA[0];
  const kishaDy = kishaB[1] - kishaA[1];
  const kishaAngle = Math.atan2(kishaDy, kishaDx);
  const kishaLen = Math.hypot(kishaDx, kishaDy);
  const kishaPoly = orientedRectXY(
    (kishaA[0] + kishaB[0]) * 0.5,
    (kishaA[1] + kishaB[1]) * 0.5,
    kishaLen,
    9.0,
    kishaAngle,
  );
  addExtrudedPrism(
    triangles,
    kishaPoly,
    2.2,
    3.4,
    FEATURE_IDS.KISHAMICHI,
    SURFACE_KIND.BRIDGE_DECK,
    SURFACE_KIND.BRIDGE_SUPPORT,
    [164, 134, 104],
    [176, 136, 98],
    [122, 114, 104],
    [118, 108, 96],
    "pedestrian-promenade",
    "wood",
    "concrete",
  );
  // Historic steel Warren truss bridge ribs along Kishamichi
  for (const frac of [0.32, 0.68]) {
    const bx = kishaA[0] + kishaDx * frac;
    const by = kishaA[1] + kishaDy * frac;
    const kPerpX = -Math.sin(kishaAngle);
    const kPerpY = Math.cos(kishaAngle);
    for (const side of [-4.2, 4.2]) {
      addExtrudedPrism(
        triangles,
        orientedRectXY(bx + kPerpX * side, by + kPerpY * side, 28, 0.7, kishaAngle),
        3.4,
        7.8,
        FEATURE_IDS.KISHAMICHI,
        SURFACE_KIND.BRIDGE_DECK,
        SURFACE_KIND.BRIDGE_DECK,
        [114, 120, 128],
        [98, 108, 118],
        [96, 104, 112],
        [86, 94, 106],
        "pedestrian-promenade",
        "concrete",
        "concrete",
      );
    }
    addExtrudedPrism(
      triangles,
      orientedRectXY(bx, by, 26, 9.0, kishaAngle),
      7.4,
      7.9,
      FEATURE_IDS.KISHAMICHI,
      SURFACE_KIND.BRIDGE_DECK,
      SURFACE_KIND.BRIDGE_DECK,
      [114, 120, 128],
      [104, 114, 124],
      [96, 104, 112],
      [86, 94, 106],
      "pedestrian-promenade",
      "concrete",
      "concrete",
    );
  }

  // 6. Shinko Central Square & Red Brick Park landscaping + sculpted trees
  const centralSqCenter: [number, number] = [
    rb2Center[0] - d1Perp[0] * 62 - d1Unit[0] * 24,
    rb2Center[1] - d1Perp[1] * 62 - d1Unit[1] * 24,
  ];
  addExtrudedPrism(
    triangles,
    orientedRectXY(centralSqCenter[0], centralSqCenter[1], 110, 44, rb2Angle),
    2.0,
    2.22,
    FEATURE_IDS.SHINKO_CENTRAL_SQUARE,
    SURFACE_KIND.VEGETATION,
    SURFACE_KIND.VEGETATION,
    [118, 160, 106],
    [114, 168, 104],
    [104, 142, 94],
    [98, 148, 92],
    undefined,
    "park",
    "park",
  );
  // Central promenade stone walkway & flowerbed strip
  addExtrudedPrism(
    triangles,
    orientedRectXY(centralSqCenter[0], centralSqCenter[1], 106, 8, rb2Angle),
    2.22,
    2.30,
    FEATURE_IDS.SHINKO_CENTRAL_SQUARE,
    SURFACE_KIND.GROUND,
    SURFACE_KIND.GROUND,
    [214, 206, 194],
    [228, 218, 202],
    [194, 186, 174],
    [206, 196, 182],
    undefined,
    "sidewalk",
    "sidewalk",
  );

  // Red Brick Park greenery
  const parkPoly = orientedRectXY(
    rb2Center[0] + d1Perp[0] * 62 + d1Unit[0] * 40,
    rb2Center[1] + d1Perp[1] * 62 + d1Unit[1] * 40,
    196,
    50,
    rb2Angle,
  );
  addExtrudedPrism(
    triangles,
    parkPoly,
    2.0,
    2.25,
    FEATURE_IDS.AKARENGA_PARK,
    SURFACE_KIND.VEGETATION,
    SURFACE_KIND.VEGETATION,
    [124, 162, 112],
    [116, 168, 108],
    [110, 146, 98],
    [104, 152, 96],
    undefined,
    "park",
    "park",
  );

  // Event plaza paving & white market canopies between Red Brick #2 and #1
  const eventPlazaCenter: [number, number] = [
    rb2Center[0] + d1Unit[0] * 116 + d1Perp[0] * 4,
    rb2Center[1] + d1Unit[1] * 116 + d1Perp[1] * 4,
  ];
  addExtrudedPrism(
    triangles,
    orientedRectXY(eventPlazaCenter[0], eventPlazaCenter[1], 46, 32, rb2Angle),
    2.0,
    2.18,
    FEATURE_IDS.AKARENGA_PARK,
    SURFACE_KIND.GROUND,
    SURFACE_KIND.GROUND,
    [204, 194, 182],
    [220, 208, 192],
    [186, 176, 166],
    [198, 186, 174],
    undefined,
    "sidewalk",
    "sidewalk",
  );
  for (const rowOff of [-8, 8]) {
    for (const colOff of [-10, 0, 10]) {
      const tx = eventPlazaCenter[0] + d1Unit[0] * colOff + d1Perp[0] * rowOff;
      const ty = eventPlazaCenter[1] + d1Unit[1] * colOff + d1Perp[1] * rowOff;
      addGabledBuilding(
        triangles,
        tx,
        ty,
        5.5,
        5.5,
        rb2Angle,
        2.18,
        4.4,
        5.6,
        FEATURE_IDS.AKARENGA_PARK,
        [236, 236, 234],
        [246, 244, 238],
        [244, 244, 240],
        [252, 248, 242],
        "concrete",
        "concrete",
      );
    }
  }

  // Sculpted trees across Red Brick Park, Shinko Central Square, Kokusai-Odori avenue & canal edge
  for (const sOffset of [-75, -45, -15, 15, 45, 75, 105, 130]) {
    addTree(
      triangles,
      rb2Center[0] + d1Perp[0] * 35 + d1Unit[0] * sOffset,
      rb2Center[1] + d1Perp[1] * 35 + d1Unit[1] * sOffset,
      1.05,
      FEATURE_IDS.AKARENGA_PARK,
      (Math.abs(sOffset) % 10) - 4,
    );
    addTree(
      triangles,
      rb2Center[0] + d1Perp[0] * 86 + d1Unit[0] * sOffset,
      rb2Center[1] + d1Perp[1] * 86 + d1Unit[1] * sOffset,
      0.95,
      FEATURE_IDS.AKARENGA_PARK,
      (Math.abs(sOffset) % 8) - 2,
    );
  }
  for (const sOffset of [-42, -18, 6, 30]) {
    addTree(
      triangles,
      centralSqCenter[0] + d1Unit[0] * sOffset + d1Perp[0] * 16,
      centralSqCenter[1] + d1Unit[1] * sOffset + d1Perp[1] * 16,
      1.0,
      FEATURE_IDS.SHINKO_CENTRAL_SQUARE,
      2,
    );
    addTree(
      triangles,
      centralSqCenter[0] + d1Unit[0] * sOffset - d1Perp[0] * 16,
      centralSqCenter[1] + d1Unit[1] * sOffset - d1Perp[1] * 16,
      0.95,
      FEATURE_IDS.SHINKO_CENTRAL_SQUARE,
      -4,
    );
  }
  for (const sOffset of [-115, -75, -42, 42, 80, 145]) {
    addTree(
      triangles,
      cwCenter[0] + d1Unit[0] * sOffset + d1Perp[0] * 13.5,
      cwCenter[1] + d1Unit[1] * sOffset + d1Perp[1] * 13.5,
      0.9,
      FEATURE_IDS.SHINKO_ISLAND,
      0,
    );
    addTree(
      triangles,
      cwCenter[0] + d1Unit[0] * sOffset - d1Perp[0] * 13.5,
      cwCenter[1] + d1Unit[1] * sOffset - d1Perp[1] * 13.5,
      0.9,
      FEATURE_IDS.SHINKO_ISLAND,
      3,
    );
  }

  // 7. Landmark Buildings with Architectural Detail
  // Red Brick Warehouse No. 2 (spanning the 2x2 vertical seam!) + cornice + 1F canopies + roof dormers
  addGabledBuilding(
    triangles,
    rb2Center[0],
    rb2Center[1],
    rb2Len,
    22,
    rb2Angle,
    2.0,
    13.0,
    16.8,
    FEATURE_IDS.RED_BRICK_2,
    [164, 78, 58],
    [186, 84, 58],
    [98, 92, 90],
    [116, 92, 86],
    "brick",
    "roof",
  );
  addExtrudedPrism(
    triangles,
    orientedRectXY(rb2Center[0], rb2Center[1], rb2Len + 0.8, 22.8, rb2Angle),
    12.3,
    13.1,
    FEATURE_IDS.RED_BRICK_2,
    SURFACE_KIND.BUILDING,
    SURFACE_KIND.BUILDING,
    [224, 218, 206],
    [238, 232, 220],
    [214, 208, 196],
    [228, 222, 208],
    undefined,
    "concrete",
    "concrete",
  );
  addExtrudedPrism(
    triangles,
    orientedRectXY(rb2Center[0], rb2Center[1], rb2Len - 4, 26.5, rb2Angle),
    4.6,
    5.1,
    FEATURE_IDS.RED_BRICK_2,
    SURFACE_KIND.BUILDING,
    SURFACE_KIND.BUILDING,
    [104, 108, 114],
    [96, 104, 114],
    [88, 92, 98],
    [82, 88, 98],
    undefined,
    "roof",
    "roof",
  );
  for (const dOff of [-42, -14, 14, 42]) {
    addExtrudedPrism(
      triangles,
      orientedRectXY(rb2Center[0] + d1Unit[0] * dOff, rb2Center[1] + d1Unit[1] * dOff, 8, 12, rb2Angle),
      13.1,
      15.8,
      FEATURE_IDS.RED_BRICK_2,
      SURFACE_KIND.BUILDING,
      SURFACE_KIND.BUILDING,
      [112, 98, 94],
      [130, 102, 94],
      [164, 78, 58],
      [186, 84, 58],
      undefined,
      "roof",
      "brick",
    );
  }

  // Red Brick Warehouse No. 1 + cornice + canopies + roof dormers
  addGabledBuilding(
    triangles,
    rb1Center[0],
    rb1Center[1],
    78,
    22,
    rb2Angle,
    2.0,
    13.0,
    16.8,
    FEATURE_IDS.RED_BRICK_1,
    [166, 80, 60],
    [188, 86, 60],
    [100, 94, 92],
    [118, 94, 88],
    "brick",
    "roof",
  );
  addExtrudedPrism(
    triangles,
    orientedRectXY(rb1Center[0], rb1Center[1], 78.8, 22.8, rb2Angle),
    12.3,
    13.1,
    FEATURE_IDS.RED_BRICK_1,
    SURFACE_KIND.BUILDING,
    SURFACE_KIND.BUILDING,
    [224, 218, 206],
    [238, 232, 220],
    [214, 208, 196],
    [228, 222, 208],
    undefined,
    "concrete",
    "concrete",
  );
  addExtrudedPrism(
    triangles,
    orientedRectXY(rb1Center[0], rb1Center[1], 74, 26.5, rb2Angle),
    4.6,
    5.1,
    FEATURE_IDS.RED_BRICK_1,
    SURFACE_KIND.BUILDING,
    SURFACE_KIND.BUILDING,
    [104, 108, 114],
    [96, 104, 114],
    [88, 92, 98],
    [82, 88, 98],
    undefined,
    "roof",
    "roof",
  );

  // World Porters + glass curtain walls + roof penthouse & skylights
  addExtrudedPrism(
    triangles,
    orientedRectXY(wpCenter[0], wpCenter[1], 112, 58, rb2Angle),
    2.0,
    28.0,
    FEATURE_IDS.WORLD_PORTERS,
    SURFACE_KIND.BUILDING,
    SURFACE_KIND.BUILDING,
    [188, 192, 198],
    [224, 218, 208],
    [168, 174, 184],
    [194, 190, 184],
    undefined,
    "concrete",
    "glass",
  );
  addExtrudedPrism(
    triangles,
    orientedRectXY(wpCenter[0] + d1Perp[0] * 12, wpCenter[1] + d1Perp[1] * 12, 52, 18, rb2Angle),
    28.0,
    31.5,
    FEATURE_IDS.WORLD_PORTERS,
    SURFACE_KIND.BUILDING,
    SURFACE_KIND.BUILDING,
    [146, 178, 204],
    [136, 182, 214],
    [162, 174, 188],
    [176, 190, 206],
    undefined,
    "glass",
    "glass",
  );

  // Cup Noodles Museum Yokohama (NW of World Porters)
  const cnCenter = toXY(139.6387, 35.4550);
  addExtrudedPrism(
    triangles,
    orientedRectXY(cnCenter[0], cnCenter[1], 68, 42, rb2Angle),
    2.0,
    22.0,
    FEATURE_IDS.CUPNOODLES_MUSEUM,
    SURFACE_KIND.BUILDING,
    SURFACE_KIND.BUILDING,
    [214, 208, 198],
    [234, 224, 208],
    [188, 178, 168],
    [206, 188, 170],
    undefined,
    "concrete",
    "brick",
  );
  addExtrudedPrism(
    triangles,
    orientedRectXY(cnCenter[0] + d1Perp[0] * 8, cnCenter[1] + d1Perp[1] * 8, 44, 16, rb2Angle),
    22.0,
    25.2,
    FEATURE_IDS.CUPNOODLES_MUSEUM,
    SURFACE_KIND.BUILDING,
    SURFACE_KIND.BUILDING,
    [146, 178, 204],
    [142, 186, 216],
    [138, 168, 196],
    [136, 174, 204],
    undefined,
    "glass",
    "glass",
  );

  // JICA Yokohama (SE of Circle Walk)
  const jicaCenter = toXY(139.6406, 35.4517);
  addExtrudedPrism(
    triangles,
    orientedRectXY(jicaCenter[0], jicaCenter[1], 46, 34, rb2Angle),
    2.0,
    20.0,
    FEATURE_IDS.JICA_YOKOHAMA,
    SURFACE_KIND.BUILDING,
    SURFACE_KIND.BUILDING,
    [194, 198, 202],
    [218, 216, 208],
    [164, 172, 182],
    [182, 190, 200],
    undefined,
    "concrete",
    "glass",
  );

  // Marine & Walk Yokohama (twin coastal pavilions + timber courtyard terrace)
  addExtrudedPrism(
    triangles,
    orientedRectXY(mwCenter[0], mwCenter[1], 112, 32, rb2Angle),
    2.0,
    2.3,
    FEATURE_IDS.MARINE_AND_WALK,
    SURFACE_KIND.GROUND,
    SURFACE_KIND.GROUND,
    [176, 146, 114],
    [194, 156, 118],
    [152, 126, 98],
    [168, 134, 102],
    undefined,
    "wood",
    "wood",
  );
  for (const offset of [-32, 32]) {
    const mx = mwCenter[0] + d1Unit[0] * offset;
    const my = mwCenter[1] + d1Unit[1] * offset;
    addExtrudedPrism(
      triangles,
      orientedRectXY(mx, my, 48, 22, rb2Angle),
      2.3,
      12.0,
      FEATURE_IDS.MARINE_AND_WALK,
      SURFACE_KIND.BUILDING,
      SURFACE_KIND.BUILDING,
      [176, 168, 158],
      [212, 196, 176],
      [148, 134, 122],
      [172, 148, 128],
      undefined,
      "roof",
      "brick",
    );
  }

  // Yokohama Hammerhead Cruise Terminal + detailed Hammerhead Crane
  addExtrudedPrism(
    triangles,
    orientedRectXY(hhCenter[0], hhCenter[1], 92, 34, rb2Angle + 0.15),
    2.0,
    20.0,
    FEATURE_IDS.HAMMERHEAD,
    SURFACE_KIND.BUILDING,
    SURFACE_KIND.BUILDING,
    [184, 190, 196],
    [214, 216, 220],
    [154, 162, 172],
    [174, 184, 196],
    undefined,
    "concrete",
    "glass",
  );
  addExtrudedPrism(
    triangles,
    orientedRectXY(hhCenter[0], hhCenter[1], 80, 26, rb2Angle + 0.15),
    20.0,
    21.8,
    FEATURE_IDS.HAMMERHEAD,
    SURFACE_KIND.BUILDING,
    SURFACE_KIND.BUILDING,
    [194, 168, 138],
    [212, 180, 142],
    [172, 148, 122],
    [188, 160, 128],
    undefined,
    "wood",
    "wood",
  );
  // Hammerhead Crane portal legs, turntable & cantilevered orange jib
  for (const legOff of [-5, 5]) {
    addExtrudedPrism(
      triangles,
      orientedRectXY(hhCenter[0] + 48 + legOff, hhCenter[1] + 22, 3.2, 11, rb2Angle),
      2.0,
      24.0,
      FEATURE_IDS.HAMMERHEAD,
      SURFACE_KIND.BUILDING,
      SURFACE_KIND.BUILDING,
      [194, 122, 68],
      [218, 126, 60],
      [172, 104, 56],
      [194, 112, 52],
      undefined,
      "crane",
      "crane",
    );
  }
  addExtrudedPrism(
    triangles,
    orientedRectXY(hhCenter[0] + 48, hhCenter[1] + 22, 13, 13, rb2Angle),
    23.5,
    27.0,
    FEATURE_IDS.HAMMERHEAD,
    SURFACE_KIND.BUILDING,
    SURFACE_KIND.BUILDING,
    [194, 122, 68],
    [218, 126, 60],
    [172, 104, 56],
    [194, 112, 52],
    undefined,
    "crane",
    "crane",
  );
  addExtrudedPrism(
    triangles,
    orientedRectXY(hhCenter[0] + 54, hhCenter[1] + 28, 38, 6.5, rb2Angle + 0.6),
    26.5,
    30.2,
    FEATURE_IDS.HAMMERHEAD,
    SURFACE_KIND.BUILDING,
    SURFACE_KIND.BUILDING,
    [202, 130, 74],
    [224, 134, 66],
    [176, 108, 58],
    [198, 116, 54],
    undefined,
    "crane",
    "crane",
  );

  // Navios Yokohama (two towers + sky bridge)
  for (const offset of [-24, 24]) {
    addExtrudedPrism(
      triangles,
      orientedRectXY(
        naviosCenter[0] + d1Unit[0] * offset,
        naviosCenter[1] + d1Unit[1] * offset,
        24,
        24,
        rb2Angle,
      ),
      2.0,
      36.0,
      FEATURE_IDS.NAVIOS_YOKOHAMA,
      SURFACE_KIND.BUILDING,
      SURFACE_KIND.BUILDING,
      [196, 192, 186],
      [226, 218, 206],
      [172, 168, 162],
      [192, 190, 184],
      undefined,
      "concrete",
      "glass",
    );
  }
  addExtrudedPrism(
    triangles,
    orientedRectXY(naviosCenter[0], naviosCenter[1], 72, 24, rb2Angle),
    22.0,
    36.0,
    FEATURE_IDS.NAVIOS_YOKOHAMA,
    SURFACE_KIND.BUILDING,
    SURFACE_KIND.BUILDING,
    [196, 192, 186],
    [226, 218, 206],
    [172, 168, 162],
    [192, 190, 184],
    undefined,
    "concrete",
    "glass",
  );

  // Coast Guard Hall
  addExtrudedPrism(
    triangles,
    orientedRectXY(cgCenter[0], cgCenter[1], 44, 28, rb2Angle),
    2.0,
    15.0,
    FEATURE_IDS.COAST_GUARD_HALL,
    SURFACE_KIND.BUILDING,
    SURFACE_KIND.BUILDING,
    [176, 180, 186],
    [208, 208, 212],
    [152, 156, 164],
    [176, 182, 190],
    undefined,
    "concrete",
    "glass",
  );

  // Zou-no-hana Terrace & Southern Timber Boardwalk
  const zonoCenter = toXY(139.6430, 35.4506);
  addExtrudedPrism(
    triangles,
    orientedRectXY(zonoCenter[0], zonoCenter[1], 36, 18, rb2Angle + 0.3),
    2.0,
    6.4,
    FEATURE_IDS.ZOU_NO_HANA_TERRACE,
    SURFACE_KIND.QUAY,
    SURFACE_KIND.QUAY,
    [212, 218, 224],
    [228, 224, 214],
    [144, 172, 196],
    [142, 178, 206],
    undefined,
    "concrete",
    "glass",
  );

  // Docked Cruise Ship at Hammerhead Berth 9 & Coast Guard Patrol Vessel + harbor sailboats
  const shipPos = toXY(139.6442, 35.4556);
  addShip(triangles, shipPos[0], shipPos[1], 108, 18, rb2Angle + 0.15, FEATURE_IDS.CRUISE_SHIP_ASUKA, true);

  const patrolPos = toXY(139.6454, 35.4534);
  addShip(triangles, patrolPos[0], patrolPos[1], 56, 10, rb2Angle - 0.12, FEATURE_IDS.COAST_GUARD_VESSEL, false);

  const sail1 = toXY(139.6456, 35.4514);
  const sail2 = toXY(139.6435, 35.4498);
  addSailboat(triangles, sail1[0], sail1[1], 0.6, FEATURE_IDS.HARBOR_WATER);
  addSailboat(triangles, sail2[0], sail2[1], 2.1, FEATURE_IDS.HARBOR_WATER);

  // 8. Shinko Circle Walk (elevated circular pedestrian bridge, outerR 26m, innerR 19.5m)
  addAnnularBridge(
    triangles,
    cwCenter[0],
    cwCenter[1],
    19.5,
    26.0,
    5.8,
    6.9,
    8.0,
    36,
    FEATURE_IDS.CIRCLE_WALK,
  );
  // Radial access wings strictly perpendicular to Kokusai-Odori (never blocking bus trajectory)
  for (const wingSign of [-1, 1]) {
    const wx = cwCenter[0] + d1Perp[0] * wingSign * 31;
    const wy = cwCenter[1] + d1Perp[1] * wingSign * 31;
    addExtrudedPrism(
      triangles,
      orientedRectXY(wx, wy, 5.2, 12, rb2Angle),
      5.8,
      6.9,
      FEATURE_IDS.CIRCLE_WALK,
      SURFACE_KIND.BRIDGE_DECK,
      SURFACE_KIND.BRIDGE_DECK,
      [194, 198, 204],
      [228, 214, 194],
      [164, 168, 176],
      [192, 178, 160],
      "circle-walk-deck",
      "deck",
      "deck",
    );
  }

  // 9. Synthetic Bayside Blue trajectory (ground-road elevation +2.2m)
  const bearingFromVec = (dx: number, dy: number) =>
    ((Math.atan2(dx, dy) * 180) / Math.PI + 360) % 360;

  const b1 = bearingFromVec(d1Unit[0], d1Unit[1]);
  const b2 = bearingFromVec(rbStreetNw[0] - kokusaiTurn[0], rbStreetNw[1] - kokusaiTurn[1]);
  const b3 = b1;

  const toWgsPt = (x: number, y: number, z: number) =>
    localToWgs84(camera, [x, y, z]);

  const rawWaypoints: Array<{
    timeSec: number;
    x: number;
    y: number;
    bearingDeg: number;
    noteJa: string;
    noteEn: string;
  }> = [
    {
      timeSec: 0,
      x: cwCenter[0] - d1Unit[0] * 60,
      y: cwCenter[1] - d1Unit[1] * 60,
      bearingDeg: b1,
      noteJa: "国際大通りを北西から接近中（可視）",
      noteEn: "Approaching Circle Walk from NW (visible)",
    },
    {
      timeSec: 6,
      x: cwCenter[0] - d1Unit[0] * 22.8,
      y: cwCenter[1] - d1Unit[1] * 22.8,
      bearingDeg: b1,
      noteJa: "新港サークルウォーク北西デッキ直下（遮蔽）",
      noteEn: "Passing underneath Circle Walk NW deck (occluded)",
    },
    {
      timeSec: 10,
      x: cwCenter[0],
      y: cwCenter[1],
      bearingDeg: b1,
      noteJa: "新港サークルウォーク中央吹き抜け（可視）",
      noteEn: "Inside Circle Walk open courtyard (visible)",
    },
    {
      timeSec: 14,
      x: cwCenter[0] + d1Unit[0] * 22.8,
      y: cwCenter[1] + d1Unit[1] * 22.8,
      bearingDeg: b1,
      noteJa: "新港サークルウォーク南東デッキ直下（遮蔽）",
      noteEn: "Passing underneath Circle Walk SE deck (occluded)",
    },
    {
      timeSec: 20,
      x: cwCenter[0] + d1Unit[0] * 56,
      y: cwCenter[1] + d1Unit[1] * 56,
      bearingDeg: b1,
      noteJa: "新港サークルウォーク通過後（可視）",
      noteEn: "Exited Circle Walk toward SE (visible)",
    },
    {
      timeSec: 28,
      x: kokusaiTurn[0],
      y: kokusaiTurn[1],
      bearingDeg: b2,
      noteJa: "新港中央通りへ左折",
      noteEn: "Turning onto Shinko-Chuo Street",
    },
    {
      timeSec: 36,
      x: rbStreetNw[0],
      y: rbStreetNw[1],
      bearingDeg: b3,
      noteJa: "赤レンガ倉庫通りへ進入",
      noteEn: "Entering Red Brick Warehouse Street",
    },
    {
      timeSec: 46,
      x: rb2Center[0] - d1Perp[0] * 17,
      y: rb2Center[1] - d1Perp[1] * 17,
      bearingDeg: b3,
      noteJa: "赤レンガ倉庫2号館の角の裏を通過中（建物により遮蔽）",
      noteEn: "Turning behind Red Brick Warehouse No. 2 corner (occluded)",
    },
    {
      timeSec: 56,
      x: rbStreetMid[0] + d1Unit[0] * 114,
      y: rbStreetMid[1] + d1Unit[1] * 114,
      bearingDeg: b3,
      noteJa: "赤レンガ倉庫2号館と1号館の間の広場で再び可視",
      noteEn: "Emerging into the open plaza between Red Brick No. 2 and No. 1 (visible)",
    },
  ];

  const syntheticKeyframes: VehicleKeyframe[] = rawWaypoints.map((w) => {
    const pt = toWgsPt(w.x, w.y, 2.2);
    return {
      timeSec: w.timeSec,
      lon: pt.lon,
      lat: pt.lat,
      bearingDeg: w.bearingDeg,
      roadElevationM: 2.2,
      deckId: "ground-road",
      noteJa: w.noteJa,
      noteEn: w.noteEn,
    };
  });

  // 10. Separate Deck Verification Point on Circle Walk deck top (+6.9m)
  const deckPtLocal: Vec3 = [cwCenter[0], cwCenter[1] + 22.8, 6.9];
  const deckPtWgs = localToWgs84(camera, deckPtLocal);

  // 11. Independent Ground Control Points (>= 6, spread across all 4 quadrants & tile boundaries)
  const gcpRaw: Array<{
    id: string;
    featureId: number;
    labelJa: string;
    labelEn: string;
    local: Vec3;
    kind: string;
  }> = [
    {
      id: "gcp-cw-north",
      featureId: FEATURE_IDS.CIRCLE_WALK,
      labelJa: "サークルウォーク北側デッキ上端",
      labelEn: "Circle Walk North Deck Rim",
      local: [cwCenter[0], cwCenter[1] + 22.75, 6.9],
      kind: "bridge-deck",
    },
    {
      id: "gcp-cw-south",
      featureId: FEATURE_IDS.CIRCLE_WALK,
      labelJa: "サークルウォーク南側デッキ上端",
      labelEn: "Circle Walk South Deck Rim",
      local: [cwCenter[0], cwCenter[1] - 22.75, 6.9],
      kind: "bridge-deck",
    },
    {
      id: "gcp-rb2-nw",
      featureId: FEATURE_IDS.RED_BRICK_2,
      labelJa: "赤レンガ倉庫2号館 北西棟頂",
      labelEn: "Red Brick Warehouse No. 2 NW Ridge",
      local: [rb2Center[0] - d1Unit[0] * 55, rb2Center[1] - d1Unit[1] * 55, 16.8],
      kind: "building-ridge",
    },
    {
      id: "gcp-rb2-se",
      featureId: FEATURE_IDS.RED_BRICK_2,
      labelJa: "赤レンガ倉庫2号館 南東棟頂",
      labelEn: "Red Brick Warehouse No. 2 SE Ridge",
      local: [rb2Center[0] + d1Unit[0] * 55, rb2Center[1] + d1Unit[1] * 55, 16.8],
      kind: "building-ridge",
    },
    {
      id: "gcp-rb1-center",
      featureId: FEATURE_IDS.RED_BRICK_1,
      labelJa: "赤レンガ倉庫1号館 棟頂中央",
      labelEn: "Red Brick Warehouse No. 1 Ridge Center",
      local: [rb1Center[0], rb1Center[1], 16.8],
      kind: "building-ridge",
    },
    {
      id: "gcp-world-porters",
      featureId: FEATURE_IDS.WORLD_PORTERS,
      labelJa: "ワールドポーターズ屋上中央",
      labelEn: "World Porters Roof Center",
      local: [wpCenter[0], wpCenter[1], 28.0],
      kind: "building-roof",
    },
    {
      id: "gcp-navios",
      featureId: FEATURE_IDS.NAVIOS_YOKOHAMA,
      labelJa: "ナビオス横浜 ゲート屋上中央",
      labelEn: "Navios Yokohama Gate Roof",
      local: [naviosCenter[0], naviosCenter[1], 36.0],
      kind: "building-roof",
    },
    {
      id: "gcp-hammerhead",
      featureId: FEATURE_IDS.HAMMERHEAD,
      labelJa: "ハンマーヘッド屋上中央",
      labelEn: "Hammerhead Terminal Roof",
      local: [hhCenter[0], hhCenter[1], 20.0],
      kind: "building-roof",
    },
  ];

  const gcps: GroundControlPoint[] = gcpRaw.map((g) => {
    const wgs = localToWgs84(camera, g.local);
    return {
      id: g.id,
      featureId: g.featureId,
      labelJa: g.labelJa,
      labelEn: g.labelEn,
      lon: wgs.lon,
      lat: wgs.lat,
      elevationM: g.local[2],
      kind: g.kind,
    };
  });

  // 12. Bilingual Landmarks for sidebar & map picking
  const landmarks: Landmark[] = [
    {
      id: "circle-walk",
      featureId: FEATURE_IDS.CIRCLE_WALK,
      nameJa: "新港サークルウォーク",
      nameEn: "Shinko Circle Walk",
      category: "bridge",
      lon: 139.6394,
      lat: 35.4531,
      elevationM: 6.9,
      descriptionJa: "国際大通りと新港地区を結ぶ円環状の歩道橋。ベイサイドブルーが真下を通過します。",
      descriptionEn: "Elevated annular pedestrian bridge over Kokusai-Odori; buses pass directly underneath.",
      sourceKind: "documented-proxy",
    },
    {
      id: "red-brick-2",
      featureId: FEATURE_IDS.RED_BRICK_2,
      nameJa: "横浜赤レンガ倉庫 2号館",
      nameEn: "Red Brick Warehouse No. 2",
      category: "landmark",
      ...localToWgs84(camera, [rb2Center[0], rb2Center[1], 16.8]),
      descriptionJa: "明治期の保税倉庫。海側のパイロット2×2タイル境界を屋根がまたぐ重要検証地点。",
      descriptionEn: "Historic brick warehouse spanning the vertical 2x2 tile seam in the Shinko pilot.",
      sourceKind: "documented-proxy",
    },
    {
      id: "red-brick-1",
      featureId: FEATURE_IDS.RED_BRICK_1,
      nameJa: "横浜赤レンガ倉庫 1号館",
      nameEn: "Red Brick Warehouse No. 1",
      category: "landmark",
      ...localToWgs84(camera, [rb1Center[0], rb1Center[1], 16.8]),
      descriptionJa: "赤レンガパーク南東側に建つ歴史的レンガ建築・文化施設。",
      descriptionEn: "Historic cultural hall beside Red Brick Park on the southeastern quay.",
      sourceKind: "documented-proxy",
    },
    {
      id: "world-porters",
      featureId: FEATURE_IDS.WORLD_PORTERS,
      nameJa: "横浜ワールドポーターズ",
      nameEn: "Yokohama World Porters",
      category: "landmark",
      ...localToWgs84(camera, [wpCenter[0], wpCenter[1], 28.0]),
      descriptionJa: "新港サークルウォーク北西側に位置する大型商業施設。",
      descriptionEn: "Large waterfront shopping complex immediately northwest of Circle Walk.",
      sourceKind: "documented-proxy",
    },
    {
      id: "hammerhead",
      featureId: FEATURE_IDS.HAMMERHEAD,
      nameJa: "横浜ハンマーヘッド",
      nameEn: "Yokohama Hammerhead",
      category: "pier",
      ...localToWgs84(camera, [hhCenter[0], hhCenter[1], 20.0]),
      descriptionJa: "新港ふ頭9号岸壁の客船ターミナルと歴史的ハンマーヘッドクレーン。",
      descriptionEn: "Shinko Pier Berth 9 cruise terminal and 1914 hammerhead crane.",
      sourceKind: "documented-proxy",
    },
    {
      id: "navios",
      featureId: FEATURE_IDS.NAVIOS_YOKOHAMA,
      nameJa: "ナビオス横浜",
      nameEn: "Navios Yokohama",
      category: "landmark",
      ...localToWgs84(camera, [naviosCenter[0], naviosCenter[1], 36.0]),
      descriptionJa: "汽車道に面した門型シルエットが特徴のホテル。",
      descriptionEn: "Gate-shaped waterfront hotel framing the Kishamichi promenade.",
      sourceKind: "documented-proxy",
    },
    {
      id: "akarenga-park",
      featureId: FEATURE_IDS.AKARENGA_PARK,
      nameJa: "赤レンガパーク",
      nameEn: "Red Brick Park",
      category: "park",
      ...localToWgs84(camera, [
        rb2Center[0] + d1Perp[0] * 62,
        rb2Center[1] + d1Perp[1] * 62,
        2.3,
      ]),
      descriptionJa: "倉庫群と横浜港の岸壁に挟まれた海辺の芝生広場。",
      descriptionEn: "Waterfront promenade and lawn separating the brick warehouses from Yokohama Harbor.",
      sourceKind: "documented-proxy",
    },
    {
      id: "kishamichi",
      featureId: FEATURE_IDS.KISHAMICHI,
      nameJa: "汽車道",
      nameEn: "Kishamichi Promenade",
      category: "bridge",
      ...localToWgs84(camera, [
        (kishaA[0] + kishaB[0]) * 0.5,
        (kishaA[1] + kishaB[1]) * 0.5,
        3.4,
      ]),
      descriptionJa: "旧臨港線の鉄道橋梁を活かした運河横断プロムナード。",
      descriptionEn: "Former port rail trestle converted into a canal boardwalk.",
      sourceKind: "documented-proxy",
    },
    {
      id: "cupnoodles-museum",
      featureId: FEATURE_IDS.CUPNOODLES_MUSEUM,
      nameJa: "カップヌードルミュージアム 横浜",
      nameEn: "Cup Noodles Museum Yokohama",
      category: "landmark",
      ...localToWgs84(camera, [cnCenter[0], cnCenter[1], 24.0]),
      descriptionJa: "ワールドポーターズ北西に並ぶ体験型ミュージアム。",
      descriptionEn: "Interactive food museum overlooking the northern Shinko waterfront.",
      sourceKind: "documented-proxy",
    },
    {
      id: "jica-yokohama",
      featureId: FEATURE_IDS.JICA_YOKOHAMA,
      nameJa: "JICA 横浜",
      nameEn: "JICA Yokohama",
      category: "landmark",
      ...localToWgs84(camera, [jicaCenter[0], jicaCenter[1], 20.0]),
      descriptionJa: "新港中央広場南西側に建つ国際協力機構の拠点施設。",
      descriptionEn: "International cooperation center framing Shinko Central Square.",
      sourceKind: "documented-proxy",
    },
    {
      id: "shinko-central-square",
      featureId: FEATURE_IDS.SHINKO_CENTRAL_SQUARE,
      nameJa: "新港中央広場",
      nameEn: "Shinko Central Square",
      category: "park",
      ...localToWgs84(camera, [centralSqCenter[0], centralSqCenter[1], 2.3]),
      descriptionJa: "サークルウォークと赤レンガ倉庫を結ぶ芝生と花壇の広場。",
      descriptionEn: "Landscaped promenade connecting Circle Walk and the Red Brick plaza.",
      sourceKind: "documented-proxy",
    },
    {
      id: "bankoku-bridge",
      featureId: FEATURE_IDS.BANKOKU_BRIDGE,
      nameJa: "万国橋",
      nameEn: "Bankoku Bridge",
      category: "bridge",
      ...localToWgs84(camera, [(bankokuA[0] + bankokuB[0]) * 0.5, (bankokuA[1] + bankokuB[1]) * 0.5, 2.6]),
      descriptionJa: "国際大通りが運河を渡る歴史的なコンクリートアーチ橋。",
      descriptionEn: "Historic concrete arch bridge carrying Kokusai-Odori into Shinko.",
      sourceKind: "documented-proxy",
    },
    {
      id: "zou-no-hana-terrace",
      featureId: FEATURE_IDS.ZOU_NO_HANA_TERRACE,
      nameJa: "象の鼻テラス",
      nameEn: "Zou-no-hana Terrace",
      category: "pier",
      ...localToWgs84(camera, [zonoCenter[0], zonoCenter[1], 6.4]),
      descriptionJa: "赤レンガパーク南東の海辺に面した開港記念アートスペース。",
      descriptionEn: "Waterfront glass pavilion and boardwalk facing Osanbashi.",
      sourceKind: "documented-proxy",
    },
  ];

  // 13. Scheduled Port Call Cards (explicitly scheduled mode, never live AIS)
  const portCalls: PortCallRecord[] = [
    {
      id: "portcall-shinko-berth9",
      vesselNameJa: "飛鳥Ⅱ（入港予定）",
      vesselNameEn: "Asuka II (Scheduled Call)",
      berthJa: "新港ふ頭9号岸壁（ハンマーヘッド）",
      berthEn: "Shinko Pier Berth 9 (Hammerhead)",
      lon: 139.6442,
      lat: 35.4556,
      arrivalTime: "2026-11-24T09:00:00+09:00",
      departureTime: "2026-11-24T17:00:00+09:00",
      mode: "scheduled",
      source: "Yokohama Port Scheduled Calls (Fixture)",
    },
  ];

  return {
    camera,
    triangles,
    landmarks,
    gcps,
    syntheticKeyframes,
    syntheticLoopDurationSec: 58,
    deckTestPoint: {
      lon: deckPtWgs.lon,
      lat: deckPtWgs.lat,
      elevationM: 6.9,
      deckId: "circle-walk-deck",
    },
    portCalls,
    landPolygonsLocal: [shinkoXY, mmXY],
  };
}
