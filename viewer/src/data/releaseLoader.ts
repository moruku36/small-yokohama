import {
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
  gcps: GroundControlPoint[];
  deckTestPoint: { lon: number; lat: number; elevationM: number; deckId: string };
  qaReport: QaReport;
  depthTiles: LoadedTilePixels[];
  surfaceIdTiles: LoadedTilePixels[];
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

  const [camera, features, landmarksPayload, qaReport] = await Promise.all([
    fetchJson<CameraManifest>(`${baseReleaseUrl}/${release.cameraPath}`),
    fetchJson<SceneFeatureRecord[]>(`${baseReleaseUrl}/${release.featuresPath}`),
    fetchJson<{
      landmarks: Landmark[];
      pois?: PoiRecord[];
      gcps: GroundControlPoint[];
      deckTestPoint: { lon: number; lat: number; elevationM: number; deckId: string };
    }>(`${baseReleaseUrl}/${release.landmarksPath}`),
    fetchJson<QaReport>(`${baseReleaseUrl}/${release.qaReportPath}`),
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

  return {
    baseReleaseUrl,
    release,
    camera,
    features,
    featureById,
    landmarks: landmarksPayload.landmarks,
    pois: landmarksPayload.pois ?? [],
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
