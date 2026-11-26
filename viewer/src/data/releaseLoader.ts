import {
  SURFACE_KIND,
  decodeFeatureIdFromRgba,
  type CameraManifest,
  type GroundControlPoint,
  type Landmark,
  type PoiRecord,
  type QaReport,
  type ReleaseManifest,
  type ReleasePointer,
  type SceneFeatureRecord,
} from "@small-yokohama/core";

const HAS_JA = /[\u3040-\u30ff\u3400-\u9fff\uff65-\uff9f]/;

export type CompactBuildingTuple = [
  osmId: number,
  height10: number,
  levels: number,
  typeIdx: number,
  lonE6: number,
  latE6: number,
  areaM2: number,
  nameJa?: string,
  nameEn?: string,
  address?: string,
  yearBuilt?: string,
  category?: string,
  landmarkId?: string,
  poiId?: string,
];

export interface CompactBuildingsBundle {
  schemaVersion: string;
  idOffset: number;
  origin: [number, number];
  count: number;
  types: string[];
  records: CompactBuildingTuple[];
}

export interface NamedBuildingSearchItem {
  featureId: number;
  nameJa: string;
  nameEn: string;
  buildingType: string;
  address: string;
  lon: number;
  lat: number;
  heightM: number;
}

export interface LoadedTilePixels {
  col: number;
  row: number;
  width: number;
  height: number;
  bitmap: ImageBitmap | null;
  rgba: Uint8Array;
}

export interface LoadedReleaseBundle {
  baseReleaseUrl: string;
  release: ReleaseManifest;
  camera: CameraManifest;
  features: SceneFeatureRecord[];
  featureById: Map<number, SceneFeatureRecord>;
  landmarks: Landmark[];
  pois: PoiRecord[];
  buildings: CompactBuildingsBundle | null;
  namedBuildings: NamedBuildingSearchItem[];
  gcps: GroundControlPoint[];
  deckTestPoint: { lon: number; lat: number; elevationM: number; deckId: string };
  qaReport: QaReport;
  depthTiles: LoadedTilePixels[];
  surfaceIdTiles: LoadedTilePixels[];
}

const landmarkLookupCache = new WeakMap<
  readonly Landmark[],
  { byId: Map<string, Landmark>; byFid: Map<number, Landmark> }
>();
const poiLookupCache = new WeakMap<readonly PoiRecord[], Map<string, PoiRecord>>();

function getLandmarkLookups(landmarks: readonly Landmark[]) {
  let cached = landmarkLookupCache.get(landmarks);
  if (!cached) {
    const byId = new Map<string, Landmark>();
    const byFid = new Map<number, Landmark>();
    for (const lm of landmarks) {
      byId.set(lm.id, lm);
      if (lm.featureId >= 7 && !byFid.has(lm.featureId)) {
        byFid.set(lm.featureId, lm);
      }
    }
    cached = { byId, byFid };
    landmarkLookupCache.set(landmarks, cached);
  }
  return cached;
}

function getPoiLookup(pois: readonly PoiRecord[]): Map<string, PoiRecord> {
  let cached = poiLookupCache.get(pois);
  if (!cached) {
    cached = new Map<string, PoiRecord>();
    for (const poi of pois) {
      cached.set(poi.id, poi);
    }
    poiLookupCache.set(pois, cached);
  }
  return cached;
}

export function buildNamedBuildingsIndex(
  buildings: CompactBuildingsBundle | null,
): NamedBuildingSearchItem[] {
  if (!buildings) return [];
  const [lon0, lat0] = buildings.origin;
  const out: NamedBuildingSearchItem[] = [];
  for (let i = 0; i < buildings.records.length; i++) {
    const rec = buildings.records[i];
    if (!rec) continue;
    const nameJa = (rec[7] ?? "").trim();
    const rawEn = (rec[8] ?? "").trim();
    const nameEn = rawEn && !HAS_JA.test(rawEn) ? rawEn : "";
    if (!nameJa && !nameEn) continue;
    out.push({
      featureId: buildings.idOffset + i,
      nameJa,
      nameEn,
      buildingType: buildings.types[rec[3]] || "yes",
      address: (rec[9] ?? "").trim(),
      lon: lon0 + rec[4] / 1e6,
      lat: lat0 + rec[5] / 1e6,
      heightM: rec[1] / 10,
    });
  }
  return out;
}

export function resolveLandmarkForFeatureId(
  bundle: Pick<LoadedReleaseBundle, "landmarks" | "buildings">,
  fid: number,
): Landmark | null {
  const { byId, byFid } = getLandmarkLookups(bundle.landmarks);
  if (fid >= 7 && (!bundle.buildings || fid < bundle.buildings.idOffset)) {
    return byFid.get(fid) ?? null;
  }
  if (bundle.buildings && fid >= bundle.buildings.idOffset) {
    const rec = bundle.buildings.records[fid - bundle.buildings.idOffset];
    const lmId = rec?.[12];
    if (lmId) {
      return byId.get(lmId) ?? null;
    }
  }
  return null;
}

export function resolveFeatureById(
  bundle: Pick<LoadedReleaseBundle, "featureById" | "buildings" | "pois">,
  fid: number,
): SceneFeatureRecord | null {
  const staticFeat = bundle.featureById.get(fid);
  if (staticFeat) return staticFeat;

  const buildings = bundle.buildings;
  if (!buildings || fid < buildings.idOffset) return null;

  const rec = buildings.records[fid - buildings.idOffset];
  if (!rec) return null;

  const [lon0, lat0] = buildings.origin;
  const lon = lon0 + rec[4] / 1e6;
  const lat = lat0 + rec[5] / 1e6;
  const heightM = rec[1] / 10;
  const levels = rec[2] > 0 ? rec[2] : undefined;
  const buildingType = buildings.types[rec[3]] || "yes";
  const areaM2 = rec[6] > 0 ? rec[6] : undefined;
  const poiId = rec[13] || undefined;
  const poi = poiId ? getPoiLookup(bundle.pois).get(poiId) : undefined;

  const nameJa = (rec[7] || poi?.nameJa || "").trim();
  const rawEn = (rec[8] || poi?.nameEn || "").trim();
  const nameEn = rawEn && !HAS_JA.test(rawEn) ? rawEn : "";
  const address = (rec[9] || poi?.address || "").trim() || undefined;
  const yearBuilt = (rec[10] || "").trim() || undefined;
  const category = (rec[11] || poi?.category || "").trim() || undefined;
  const landmarkId = (rec[12] || "").trim() || undefined;

  return {
    featureId: fid,
    slug: `osm-building-${rec[0]}`,
    nameJa,
    nameEn,
    surfaceKind: SURFACE_KIND.BUILDING,
    heightM,
    levels,
    buildingType,
    areaM2,
    yearBuilt,
    category,
    address,
    descriptionJa: poi?.descriptionJa,
    descriptionEn: poi?.descriptionEn,
    googleMapsUrl: poi?.googleMapsUrl,
    landmarkId,
    poiId,
    osmId: rec[0],
    lon,
    lat,
    source: "osm-odbl",
    notes: "",
  };
}

async function fetchJson<T>(url: string): Promise<T> {
  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) {
    throw new Error(`Failed to fetch ${url}: HTTP ${res.status}`);
  }
  return (await res.json()) as T;
}

async function loadLosslessPngTile(
  url: string,
  col: number,
  row: number,
  needRgba = true,
): Promise<LoadedTilePixels> {
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`Failed to fetch data tile ${url}: HTTP ${res.status}`);
  }
  const blob = await res.blob();
  const bitmap = await createImageBitmap(blob, {
    premultiplyAlpha: "none",
    colorSpaceConversion: "none",
  });

  if (!needRgba) {
    return {
      col,
      row,
      width: bitmap.width,
      height: bitmap.height,
      bitmap,
      rgba: new Uint8Array(0),
    };
  }

  // Extract raw RGBA bytes once for fast CPU feature picking and diagnostics
  const canvas = document.createElement("canvas");
  canvas.width = bitmap.width;
  canvas.height = bitmap.height;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) {
    throw new Error("2D canvas context unavailable for lossless data tile readback");
  }
  ctx.drawImage(bitmap, 0, 0);
  const imgData = ctx.getImageData(0, 0, bitmap.width, bitmap.height);
  bitmap.close();
  return {
    col,
    row,
    width: imgData.width,
    height: imgData.height,
    bitmap: null,
    rgba: new Uint8Array(imgData.data.buffer),
  };
}

export async function loadCurrentRelease(): Promise<LoadedReleaseBundle> {
  const pointer = await fetchJson<ReleasePointer>("./releases/current.json");
  const baseReleaseUrl = `./releases/${pointer.releaseId}`;
  const release = await fetchJson<ReleaseManifest>(`${baseReleaseUrl}/release.json`);

  const buildingsPromise = release.buildingsPath
    ? fetch(`${baseReleaseUrl}/${release.buildingsPath}`, { cache: "no-store" })
        .then((r) => (r.ok ? (r.json() as Promise<CompactBuildingsBundle>) : null))
        .catch(() => null)
    : Promise.resolve(null);

  const [camera, features, landmarksPayload, qaReport, buildings] = await Promise.all([
    fetchJson<CameraManifest>(`${baseReleaseUrl}/${release.cameraPath}`),
    fetchJson<SceneFeatureRecord[]>(`${baseReleaseUrl}/${release.featuresPath}`),
    fetchJson<{
      landmarks: Landmark[];
      pois?: PoiRecord[];
      gcps: GroundControlPoint[];
      deckTestPoint: { lon: number; lat: number; elevationM: number; deckId: string };
    }>(`${baseReleaseUrl}/${release.landmarksPath}`),
    fetchJson<QaReport>(`${baseReleaseUrl}/${release.qaReportPath}`),
    buildingsPromise,
  ]);

  const { cols, rows } = camera.dataTileGrid;
  const depthPromises: Array<Promise<LoadedTilePixels>> = [];
  const idPromises: Array<Promise<LoadedTilePixels>> = [];

  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      const depthPath = release.layers.depth.tilePattern
        .replace("{col}", String(col))
        .replace("{row}", String(row));
      const idPath = release.layers.surfaceId.tilePattern
        .replace("{col}", String(col))
        .replace("{row}", String(row));
      depthPromises.push(loadLosslessPngTile(`${baseReleaseUrl}/${depthPath}`, col, row, false));
      idPromises.push(loadLosslessPngTile(`${baseReleaseUrl}/${idPath}`, col, row, true));
    }
  }

  const [depthTiles, surfaceIdTiles] = await Promise.all([
    Promise.all(depthPromises),
    Promise.all(idPromises),
  ]);

  const featureById = new Map<number, SceneFeatureRecord>();
  for (const f of features) {
    featureById.set(f.featureId, f);
  }

  const namedBuildings = buildNamedBuildingsIndex(buildings);

  return {
    baseReleaseUrl,
    release,
    camera,
    features,
    featureById,
    landmarks: landmarksPayload.landmarks,
    pois: landmarksPayload.pois ?? [],
    buildings,
    namedBuildings,
    gcps: landmarksPayload.gcps,
    deckTestPoint: landmarksPayload.deckTestPoint,
    qaReport,
    depthTiles,
    surfaceIdTiles,
  };
}

export function pickFeatureIdAtImagePx(
  bundle: LoadedReleaseBundle,
  imgX: number,
  imgY: number,
): number | null {
  const { camera, surfaceIdTiles } = bundle;
  const scale = camera.dataTileGrid.scale ?? 1;
  const dataW = Math.floor(camera.imageWidthPx * scale);
  const dataH = Math.floor(camera.imageHeightPx * scale);
  const px = Math.floor(imgX * scale);
  const py = Math.floor(imgY * scale);
  if (px < 0 || py < 0 || px >= dataW || py >= dataH) {
    return null;
  }

  const tilePx = camera.dataTileGrid.tileSizePx;
  const col = Math.floor(px / tilePx);
  const row = Math.floor(py / tilePx);
  const tile = surfaceIdTiles.find((t) => t.col === col && t.row === row);
  if (!tile) return null;

  const lx = px - col * tilePx;
  const ly = py - row * tilePx;
  if (lx < 0 || ly < 0 || lx >= tile.width || ly >= tile.height) {
    return null;
  }
  const o = (ly * tile.width + lx) * 4;
  return decodeFeatureIdFromRgba(
    tile.rgba[o]!,
    tile.rgba[o + 1]!,
    tile.rgba[o + 2]!,
  );
}
