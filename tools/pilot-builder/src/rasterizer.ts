import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import {
  FEATURE_IDS,
  SURFACE_KIND,
  encodeDepthRgba,
  encodeElevationRgba,
  encodeFeatureIdRgba,
  localToImage,
  localToWgs84,
  type CameraManifest,
  type SceneTriangle,
  type SurfaceKind,
} from "@small-yokohama/core";
import { decodePngRgba } from "./png.js";

export interface GsiAerialMosaic {
  width: number;
  height: number;
  rgba: Uint8Array;
  zoom: number;
  minTx: number;
  minTy: number;
  tileSize: number;
}

export function loadGsiAerialMosaic(
  aerialDir: string,
  basename = "shinko-z18",
): GsiAerialMosaic | null {
  const metaPath = join(aerialDir, `${basename}.json`);
  const pngPath = join(aerialDir, `${basename}.png`);
  if (!existsSync(metaPath) || !existsSync(pngPath)) {
    return null;
  }
  const meta = JSON.parse(readFileSync(metaPath, "utf8")) as {
    zoom: number;
    minTx: number;
    minTy: number;
    tileSize: number;
  };
  const decoded = decodePngRgba(readFileSync(pngPath));
  return {
    width: decoded.width,
    height: decoded.height,
    rgba: decoded.data,
    zoom: meta.zoom,
    minTx: meta.minTx,
    minTy: meta.minTy,
    tileSize: meta.tileSize,
  };
}

export function lonLatToAerialPx(
  aerial: GsiAerialMosaic,
  lon: number,
  lat: number,
): [number, number] {
  const n = 2 ** aerial.zoom;
  const u = (((lon + 180) / 360) * n - aerial.minTx) * aerial.tileSize;
  const latRad = (lat * Math.PI) / 180;
  const v =
    (((1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2) * n -
      aerial.minTy) *
    aerial.tileSize;
  return [u, v];
}

function buildAerialProjector(
  camera: CameraManifest,
  aerial: GsiAerialMosaic,
): (wx: number, wy: number) => [number, number] {
  const w0 = localToWgs84(camera, [0, 0, 0]);
  const wX = localToWgs84(camera, [400, 0, 0]);
  const wY = localToWgs84(camera, [0, 400, 0]);
  const [u0, v0] = lonLatToAerialPx(aerial, w0.lon, w0.lat);
  const [ux, vx] = lonLatToAerialPx(aerial, wX.lon, wX.lat);
  const [uy, vy] = lonLatToAerialPx(aerial, wY.lon, wY.lat);
  const duDx = (ux - u0) / 400;
  const duDy = (uy - u0) / 400;
  const dvDx = (vx - v0) / 400;
  const dvDy = (vy - v0) / 400;

  return (wx: number, wy: number): [number, number] => [
    u0 + wx * duDx + wy * duDy,
    v0 + wx * dvDx + wy * dvDy,
  ];
}

export function sampleAerialRgb(
  aerial: GsiAerialMosaic,
  u: number,
  v: number,
): [number, number, number] {
  const x = Math.min(aerial.width - 1, Math.max(0, u));
  const y = Math.min(aerial.height - 1, Math.max(0, v));
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const x1 = Math.min(aerial.width - 1, x0 + 1);
  const y1 = Math.min(aerial.height - 1, y0 + 1);
  const fx = x - x0;
  const fy = y - y0;
  const invFx = 1 - fx;
  const invFy = 1 - fy;

  const i00 = (y0 * aerial.width + x0) * 4;
  const i10 = (y0 * aerial.width + x1) * 4;
  const i01 = (y1 * aerial.width + x0) * 4;
  const i11 = (y1 * aerial.width + x1) * 4;

  const w00 = invFx * invFy;
  const w10 = fx * invFy;
  const w01 = invFx * fy;
  const w11 = fx * fy;

  return [
    aerial.rgba[i00]! * w00 +
      aerial.rgba[i10]! * w10 +
      aerial.rgba[i01]! * w01 +
      aerial.rgba[i11]! * w11,
    aerial.rgba[i00 + 1]! * w00 +
      aerial.rgba[i10 + 1]! * w10 +
      aerial.rgba[i01 + 1]! * w01 +
      aerial.rgba[i11 + 1]! * w11,
    aerial.rgba[i00 + 2]! * w00 +
      aerial.rgba[i10 + 2]! * w10 +
      aerial.rgba[i01 + 2]! * w01 +
      aerial.rgba[i11 + 2]! * w11,
  ];
}

export interface RenderedTileBuffers {
  col: number;
  row: number;
  originPxX: number;
  originPxY: number;
  width: number;
  height: number;
  plainRgba: Uint8Array;
  illustratedRgba: Uint8Array;
  depthRgba: Uint8Array;
  surfaceIdRgba: Uint8Array;
  roadElevRgba: Uint8Array;
  depthMeters: Float32Array;
  featureIds: Uint32Array;
  surfaceKinds: Uint8Array;
  hasDrawnOverride?: boolean;
}

export interface GlobalShadowMap {
  size: number;
  halfExtentM: number;
  depths: Float32Array;
  right: readonly [number, number, number];
  up: readonly [number, number, number];
  forward: readonly [number, number, number];
  sunDir: readonly [number, number, number];
}

// East-Southeast afternoon/late-morning Yokohama sun (~47 deg elevation)
// Illuminates both harbor-facing NE facades and SE gables while casting WNW shadows across streets & plazas.
const SUN_DIR = (() => {
  const x = 0.62;
  const y = -0.22;
  const z = 0.75;
  const len = Math.hypot(x, y, z);
  return [x / len, y / len, z / len] as const;
})();

function normalize3(x: number, y: number, z: number): [number, number, number] {
  const len = Math.hypot(x, y, z) || 1;
  return [x / len, y / len, z / len];
}

function cross3(
  ax: number,
  ay: number,
  az: number,
  bx: number,
  by: number,
  bz: number,
): [number, number, number] {
  return [ay * bz - az * by, az * bx - ax * bz, ax * by - ay * bx];
}

function edgeFn(ax: number, ay: number, bx: number, by: number, cx: number, cy: number): number {
  return (cx - ax) * (by - ay) - (cy - ay) * (bx - ax);
}

/**
 * Build a global 2048x2048 orthographic sun shadow depth map shared across all 2x2 tiles
 * so cast shadows stay 100% consistent across 128px overlap seams.
 */
export function buildShadowMap(
  triangles: readonly SceneTriangle[],
  size = 2048,
  halfExtentM = 1100,
): GlobalShadowMap {
  const forward = [-SUN_DIR[0], -SUN_DIR[1], -SUN_DIR[2]] as const;
  const rRaw = cross3(forward[0], forward[1], forward[2], 0, 0, 1);
  const right = normalize3(rRaw[0], rRaw[1], rRaw[2]);
  const uRaw = cross3(right[0], right[1], right[2], forward[0], forward[1], forward[2]);
  const up = normalize3(uRaw[0], uRaw[1], uRaw[2]);

  const depths = new Float32Array(size * size);
  depths.fill(Number.POSITIVE_INFINITY);

  const scale = size / (2 * halfExtentM);
  const half = size * 0.5;
  const proj = (v: readonly [number, number, number]): [number, number, number] => {
    const sx = (v[0] * right[0] + v[1] * right[1] + v[2] * right[2]) * scale + half;
    const sy = half - (v[0] * up[0] + v[1] * up[1] + v[2] * up[2]) * scale;
    const sd = v[0] * forward[0] + v[1] * forward[1] + v[2] * forward[2];
    return [sx, sy, sd];
  };

  for (const tri of triangles) {
    if (tri.surfaceKind === SURFACE_KIND.WATER) continue;
    const [x0, y0, z0] = proj(tri.v0);
    const [x1, y1, z1] = proj(tri.v1);
    const [x2, y2, z2] = proj(tri.v2);

    const minX = Math.max(0, Math.floor(Math.min(x0, x1, x2)));
    const maxX = Math.min(size - 1, Math.ceil(Math.max(x0, x1, x2)));
    const minY = Math.max(0, Math.floor(Math.min(y0, y1, y2)));
    const maxY = Math.min(size - 1, Math.ceil(Math.max(y0, y1, y2)));
    if (minX > maxX || minY > maxY) continue;

    let area = edgeFn(x0, y0, x1, y1, x2, y2);
    if (Math.abs(area) < 1e-6) continue;
    const sign = area > 0 ? 1 : -1;
    area = Math.abs(area);
    const invArea = 1 / area;

    for (let py = minY; py <= maxY; py++) {
      const sy = py + 0.5;
      for (let px = minX; px <= maxX; px++) {
        const sx = px + 0.5;
        const w0 = sign * edgeFn(x1, y1, x2, y2, sx, sy);
        if (w0 < -1e-4) continue;
        const w1 = sign * edgeFn(x2, y2, x0, y0, sx, sy);
        if (w1 < -1e-4) continue;
        const w2 = sign * edgeFn(x0, y0, x1, y1, sx, sy);
        if (w2 < -1e-4) continue;
        const d = (w0 * z0 + w1 * z1 + w2 * z2) * invArea;
        const idx = py * size + px;
        if (d < depths[idx]!) {
          depths[idx] = d;
        }
      }
    }
  }

  return { size, halfExtentM, depths, right, up, forward, sunDir: SUN_DIR };
}

function sampleShadowFactor(shadow: GlobalShadowMap, wx: number, wy: number, wz: number): number {
  const scale = shadow.size / (2 * shadow.halfExtentM);
  const half = shadow.size * 0.5;
  const sx = (wx * shadow.right[0] + wy * shadow.right[1] + wz * shadow.right[2]) * scale + half;
  const sy = half - (wx * shadow.up[0] + wy * shadow.up[1] + wz * shadow.up[2]) * scale;
  const sd = wx * shadow.forward[0] + wy * shadow.forward[1] + wz * shadow.forward[2];

  const ix = Math.round(sx);
  const iy = Math.round(sy);
  if (ix < 1 || iy < 1 || ix >= shadow.size - 1 || iy >= shadow.size - 1) {
    return 1.0;
  }

  const bias = 1.05;
  let lit = 0;
  // 5-tap rotated PCF filter for smooth architectural shadow edges
  const offsets: ReadonlyArray<readonly [number, number]> = [
    [0, 0],
    [-1, 0],
    [1, 0],
    [0, -1],
    [0, 1],
  ];
  for (const [ox, oy] of offsets) {
    const d = shadow.depths[(iy + oy) * shadow.size + (ix + ox)]!;
    if (sd - bias <= d) {
      lit++;
    }
  }
  return lit / 5;
}

const TAG_TO_CODE: Record<NonNullable<SceneTriangle["materialTag"]>, number> = {
  water: 1,
  brick: 2,
  asphalt: 3,
  park: 4,
  sidewalk: 5,
  glass: 6,
  roof: 7,
  wood: 8,
  marking: 9,
  ship: 10,
  crane: 11,
  deck: 12,
  quay: 13,
  concrete: 14,
};

function clampByte(v: number): number {
  return v < 0 ? 0 : v > 255 ? 255 : Math.round(v);
}

/**
 * Software orthographic Z-buffer rasterizer for a single working tile window.
 * Produces pixel-locked plain color, illustrated color (with cast shadows, contact AO,
 * world-space material detail, coastal gradient, and ink linework), 16-bit depth,
 * 24-bit feature IDs, and ground-road elevation.
 */
export function renderWorkingTile(
  camera: CameraManifest,
  triangles: readonly SceneTriangle[],
  col: number,
  row: number,
  shadowMap?: GlobalShadowMap,
  aerial?: GsiAerialMosaic | null,
): RenderedTileBuffers {
  const { tileSizePx, overlapPx } = camera.workingGrid;
  const stridePx = tileSizePx - overlapPx;
  const originPxX = col * stridePx;
  const originPxY = row * stridePx;
  const width = tileSizePx;
  const height = tileSizePx;
  const nPixels = width * height;

  const depthMeters = new Float32Array(nPixels);
  depthMeters.fill(Number.POSITIVE_INFINITY);

  const plainRgba = new Uint8Array(nPixels * 4);
  const illusBaseRgba = new Uint8Array(nPixels * 4);
  const depthRgba = new Uint8Array(nPixels * 4);
  const surfaceIdRgba = new Uint8Array(nPixels * 4);
  const featureIds = new Uint32Array(nPixels);
  const surfaceKinds = new Uint8Array(nPixels);
  const materialTags = new Uint8Array(nPixels);

  // Per-pixel world coordinates & sun dot for shadow + seamless world-space illustration textures
  const worldX = new Float32Array(nPixels);
  const worldY = new Float32Array(nPixels);
  const worldZ = new Float32Array(nPixels);
  const sunDotArr = new Float32Array(nPixels);

  for (let i = 0; i < nPixels; i++) {
    const o = i * 4;
    plainRgba[o + 3] = 255;
    illusBaseRgba[o + 3] = 255;
    depthRgba[o + 3] = 255;
    surfaceIdRgba[o + 3] = 255;
  }

  for (const tri of triangles) {
    const p0 = localToImage(camera, tri.v0);
    const p1 = localToImage(camera, tri.v1);
    const p2 = localToImage(camera, tri.v2);

    const x0 = p0.px - originPxX;
    const y0 = p0.py - originPxY;
    const x1 = p1.px - originPxX;
    const y1 = p1.py - originPxY;
    const x2 = p2.px - originPxX;
    const y2 = p2.py - originPxY;

    const minX = Math.max(0, Math.floor(Math.min(x0, x1, x2)));
    const maxX = Math.min(width - 1, Math.ceil(Math.max(x0, x1, x2)));
    const minY = Math.max(0, Math.floor(Math.min(y0, y1, y2)));
    const maxY = Math.min(height - 1, Math.ceil(Math.max(y0, y1, y2)));
    if (minX > maxX || minY > maxY) continue;

    let area = edgeFn(x0, y0, x1, y1, x2, y2);
    if (Math.abs(area) < 1e-6) continue;
    const sign = area > 0 ? 1 : -1;
    area = Math.abs(area);
    const invArea = 1 / area;

    const nDotL = Math.max(
      0,
      tri.normal[0] * SUN_DIR[0] + tri.normal[1] * SUN_DIR[1] + tri.normal[2] * SUN_DIR[2],
    );
    const pIntensity = 0.56 + 0.44 * nDotL;
    const pR = clampByte(tri.plainRgb[0] * pIntensity);
    const pG = clampByte(tri.plainRgb[1] * pIntensity);
    const pB = clampByte(tri.plainRgb[2] * pIntensity);

    const fEnc = encodeFeatureIdRgba(tri.featureId);
    const mCode = tri.materialTag ? TAG_TO_CODE[tri.materialTag] : 0;

    for (let py = minY; py <= maxY; py++) {
      const sampleY = py + 0.5;
      for (let px = minX; px <= maxX; px++) {
        const sampleX = px + 0.5;
        const w0 = sign * edgeFn(x1, y1, x2, y2, sampleX, sampleY);
        if (w0 < -1e-4) continue;
        const w1 = sign * edgeFn(x2, y2, x0, y0, sampleX, sampleY);
        if (w1 < -1e-4) continue;
        const w2 = sign * edgeFn(x0, y0, x1, y1, sampleX, sampleY);
        if (w2 < -1e-4) continue;

        const b0 = w0 * invArea;
        const b1 = w1 * invArea;
        const b2 = w2 * invArea;
        const depthM = b0 * p0.depthM + b1 * p1.depthM + b2 * p2.depthM;

        const idx = py * width + px;
        if (depthM < depthMeters[idx]!) {
          depthMeters[idx] = depthM;
          featureIds[idx] = tri.featureId;
          surfaceKinds[idx] = tri.surfaceKind;
          materialTags[idx] = mCode;
          worldX[idx] = b0 * tri.v0[0] + b1 * tri.v1[0] + b2 * tri.v2[0];
          worldY[idx] = b0 * tri.v0[1] + b1 * tri.v1[1] + b2 * tri.v2[1];
          worldZ[idx] = b0 * tri.v0[2] + b1 * tri.v1[2] + b2 * tri.v2[2];
          sunDotArr[idx] = nDotL;

          const o = idx * 4;
          plainRgba[o] = pR;
          plainRgba[o + 1] = pG;
          plainRgba[o + 2] = pB;

          illusBaseRgba[o] = tri.illustratedRgb[0];
          illusBaseRgba[o + 1] = tri.illustratedRgb[1];
          illusBaseRgba[o + 2] = tri.illustratedRgb[2];

          const dEnc = encodeDepthRgba(depthM, camera.nearM, camera.farM, tri.surfaceKind);
          depthRgba[o] = dEnc[0];
          depthRgba[o + 1] = dEnc[1];
          depthRgba[o + 2] = dEnc[2];

          surfaceIdRgba[o] = fEnc[0];
          surfaceIdRgba[o + 1] = fEnc[1];
          surfaceIdRgba[o + 2] = fEnc[2];
        }
      }
    }
  }

  // Pass 2: Ground road/surface elevation map strictly excluding overhead bridges & buildings
  const roadElevRgba = new Uint8Array(nPixels * 4);
  const roadDepth = new Float32Array(nPixels);
  roadDepth.fill(Number.POSITIVE_INFINITY);
  for (let i = 0; i < nPixels; i++) {
    roadElevRgba[i * 4 + 3] = 255;
  }

  for (const tri of triangles) {
    if (tri.deckId !== "ground-road") continue;
    const p0 = localToImage(camera, tri.v0);
    const p1 = localToImage(camera, tri.v1);
    const p2 = localToImage(camera, tri.v2);

    const x0 = p0.px - originPxX;
    const y0 = p0.py - originPxY;
    const x1 = p1.px - originPxX;
    const y1 = p1.py - originPxY;
    const x2 = p2.px - originPxX;
    const y2 = p2.py - originPxY;

    const minX = Math.max(0, Math.floor(Math.min(x0, x1, x2)));
    const maxX = Math.min(width - 1, Math.ceil(Math.max(x0, x1, x2)));
    const minY = Math.max(0, Math.floor(Math.min(y0, y1, y2)));
    const maxY = Math.min(height - 1, Math.ceil(Math.max(y0, y1, y2)));
    if (minX > maxX || minY > maxY) continue;

    let area = edgeFn(x0, y0, x1, y1, x2, y2);
    if (Math.abs(area) < 1e-6) continue;
    const sign = area > 0 ? 1 : -1;
    area = Math.abs(area);
    const invArea = 1 / area;

    for (let py = minY; py <= maxY; py++) {
      const sampleY = py + 0.5;
      for (let px = minX; px <= maxX; px++) {
        const sampleX = px + 0.5;
        const w0 = sign * edgeFn(x1, y1, x2, y2, sampleX, sampleY);
        if (w0 < -1e-4) continue;
        const w1 = sign * edgeFn(x2, y2, x0, y0, sampleX, sampleY);
        if (w1 < -1e-4) continue;
        const w2 = sign * edgeFn(x0, y0, x1, y1, sampleX, sampleY);
        if (w2 < -1e-4) continue;

        const b0 = w0 * invArea;
        const b1 = w1 * invArea;
        const b2 = w2 * invArea;
        const depthM = b0 * p0.depthM + b1 * p1.depthM + b2 * p2.depthM;
        const idx = py * width + px;
        if (depthM < roadDepth[idx]!) {
          roadDepth[idx] = depthM;
          const elevM = b0 * tri.v0[2] + b1 * tri.v1[2] + b2 * tri.v2[2];
          const enc = encodeElevationRgba(elevM, 0, 100, true);
          const o = idx * 4;
          roadElevRgba[o] = enc[0];
          roadElevRgba[o + 1] = enc[1];
          roadElevRgba[o + 2] = enc[2];
        }
      }
    }
  }

  // Pass 2b: Fast 2-pass Chamfer shoreline distance transform for coastal water gradient & foam
  const maxWaterDist = 28;
  const waterDist = new Uint8Array(nPixels);
  for (let i = 0; i < nPixels; i++) {
    waterDist[i] = materialTags[i] === 1 ? maxWaterDist : 0;
  }
  for (let y = 1; y < height; y++) {
    const rowOff = y * width;
    for (let x = 1; x < width - 1; x++) {
      const idx = rowOff + x;
      if (waterDist[idx] === 0) continue;
      const d = Math.min(
        waterDist[idx]!,
        waterDist[idx - 1]! + 1,
        waterDist[idx - width]! + 1,
        waterDist[idx - width - 1]! + 2,
        waterDist[idx - width + 1]! + 2,
      );
      waterDist[idx] = d;
    }
  }
  for (let y = height - 2; y >= 0; y--) {
    const rowOff = y * width;
    for (let x = width - 2; x >= 1; x--) {
      const idx = rowOff + x;
      if (waterDist[idx] === 0) continue;
      const d = Math.min(
        waterDist[idx]!,
        waterDist[idx + 1]! + 1,
        waterDist[idx + width]! + 1,
        waterDist[idx + width - 1]! + 2,
        waterDist[idx + width + 1]! + 2,
      );
      waterDist[idx] = d;
    }
  }

  // Pass 3: Illustrated Architectural Shading, GSI Aerial Draping, Global Sun Shadows, Contact AO, Materials & Ink Lines
  const aerialProj = aerial ? buildAerialProjector(camera, aerial) : null;
  const illustratedRgba = new Uint8Array(nPixels * 4);
  for (let py = 0; py < height; py++) {
    for (let px = 0; px < width; px++) {
      const idx = py * width + px;
      const o = idx * 4;
      const tag = materialTags[idx]!;
      const kind = surfaceKinds[idx] as SurfaceKind;
      const fid = featureIds[idx]!;
      const wx = worldX[idx]!;
      const wy = worldY[idx]!;
      const wz = worldZ[idx]!;
      const nDotL = sunDotArr[idx]!;

      let r = illusBaseRgba[o]!;
      let g = illusBaseRgba[o + 1]!;
      let b = illusBaseRgba[o + 2]!;
      let hasAerialTint = false;

      // World-space procedural material modulation (100% seamless across overlapping tiles!)
      if (tag === 1) {
        // Small SF clean deep Yokohama Bay teal water + subtle 1-2px seawall waterline & ripples
        const dist = waterDist[idx]!;
        if (dist > 0 && dist <= 2) {
          r = r * 0.65 + 218 * 0.35;
          g = g * 0.65 + 236 * 0.35;
          b = b * 0.65 + 238 * 0.35;
        }
        const wave = Math.sin(wx * 0.22 + wy * 0.34) * Math.cos(wx * 0.08 - wy * 0.14);
        r += wave * 4.5;
        g += wave * 5.5;
        b += wave * 6.5;
      } else if (tag === 2) {
        // Brick courses & arched dark window rhythm along warehouse walls
        const course = Math.floor(wz * 2.4) % 2 === 0 ? 6 : -7;
        const along = wx * 0.7 - wy * 0.7;
        const winBay = Math.abs((along % 6.0 + 6.0) % 6.0 - 3.0) < 0.95;
        const winBand = (wz > 3.2 && wz < 6.4) || (wz > 7.8 && wz < 11.2);
        if (winBay && winBand && nDotL < 0.85) {
          r = 46;
          g = 52;
          b = 64;
        } else {
          const jitter = Math.sin(wx * 1.9 + wy * 2.3 + wz * 3.1) * 5;
          r += course + jitter;
          g += course * 0.55 + jitter * 0.5;
          b += course * 0.45 + jitter * 0.4;
        }
      } else if (tag === 6) {
        // Curtain-wall glass floor slabs, mullions & sky reflection
        const floorBand = (wz % 3.6 + 3.6) % 3.6;
        const bay = Math.abs(((wx - wy) * 0.7) % 3.2 + 3.2) % 3.2;
        if (nDotL < 0.85 && wz > 2.6 && floorBand > 0.85 && floorBand < 2.8 && bay > 0.45 && bay < 2.75) {
          r = r * 0.58 + 54 * 0.42;
          g = g * 0.58 + 76 * 0.42;
          b = b * 0.58 + 98 * 0.42;
        } else if (floorBand < 0.65 && wz > 2.4) {
          r *= 0.82;
          g *= 0.84;
          b *= 0.88;
        } else {
          const refl = Math.sin(wx * 0.15 - wy * 0.12 + wz * 0.4) * 9;
          r += refl * 0.6;
          g += refl * 0.8;
          b += refl * 1.05;
        }
      } else if (tag === 14) {
        // Architectural multi-story window bays on vertical concrete/stucco walls; clean slabs on roofs
        if (nDotL < 0.85 && wz > 3.2) {
          const floorBand = (wz % 3.4 + 3.4) % 3.4;
          const bay = Math.abs((((wx - wy) * 0.72) % 4.0 + 4.0) % 4.0);
          if (floorBand > 1.05 && floorBand < 2.35 && bay > 1.15 && bay < 2.65) {
            r = r * 0.36 + 56 * 0.64;
            g = g * 0.36 + 64 * 0.64;
            b = b * 0.36 + 78 * 0.64;
          }
        } else if (nDotL >= 0.85) {
          const slab = Math.sin(wx * 0.8 + wy * 0.8) * 2.5;
          r += slab;
          g += slab;
          b += slab;
        }
      } else if (tag === 7) {
        // Slate roof rib lines
        const rib = Math.sin((wx + wy) * 1.8) * 6;
        r += rib;
        g += rib;
        b += rib;
      } else if (tag === 5) {
        // Stone sidewalk paving grid
        const grid =
          Math.abs((wx * 0.5) % 1) < 0.12 || Math.abs((wy * 0.5) % 1) < 0.12 ? -8 : 3;
        r += grid;
        g += grid;
        b += grid;
      } else if (tag === 8) {
        // Timber boardwalk plank grain
        const plank = Math.sin((wx * 0.7 + wy * 0.7) * 3.5) * 7;
        r += plank;
        g += plank * 0.85;
        b += plank * 0.6;
      } else if (tag === 4) {
        // Soft painterly park lawn & foliage stipple
        const stipple = Math.sin(wx * 0.8 + wy * 1.1) * 7 + Math.cos(wx * 0.35 - wy * 0.45) * 5;
        r += stipple * 0.7;
        g += stipple;
        b += stipple * 0.5;
      } else if (tag === 3) {
        // Subtle sunlit asphalt grain and light traffic wear
        const grain = Math.sin(wx * 2.1 + wy * 1.7) * 3.2;
        const wear = Math.sin((wx - wy) * 0.35) * 2.4;
        r += grain + wear;
        g += grain + wear;
        b += grain + wear;
      }

      // Drape real GSI Seamless Photo over ground parcels, parking lots, helipad, piers & flat rooftops
      // Strictly skip open harbor water (tag===1) and berthed ships so ships/water stay crystal clean.
      if (aerial && aerialProj && tag !== 1) {
        const isVessel =
          fid === FEATURE_IDS.CRUISE_SHIP_ASUKA || fid === FEATURE_IDS.COAST_GUARD_VESSEL;
        const isAerialGround =
          !isVessel &&
          (kind === SURFACE_KIND.GROUND ||
            kind === SURFACE_KIND.QUAY ||
            (kind === SURFACE_KIND.ROAD && tag !== 9) ||
            (kind === SURFACE_KIND.VEGETATION && wz < 2.35));
        const isAerialRoof =
          kind === SURFACE_KIND.BUILDING &&
          nDotL >= 0.85 &&
          fid !== FEATURE_IDS.RED_BRICK_1 &&
          fid !== FEATURE_IDS.RED_BRICK_2 &&
          fid !== FEATURE_IDS.HAMMERHEAD;

        if (isAerialGround || isAerialRoof) {
          const [au, av] = aerialProj(wx, wy);
          if (au >= 0 && av >= 0 && au < aerial.width - 1 && av < aerial.height - 1) {
            const [ar, ag, ab] = sampleAerialRgb(aerial, au, av);
            // Gentle sunlit brightness lift on aerial photo so Ligne-Claire palette stays warm & readable
            const liftR = Math.min(255, ar * 1.14 + 12);
            const liftG = Math.min(255, ag * 1.12 + 10);
            const liftB = Math.min(255, ab * 1.08 + 6);
            let aerialBlend = 0.80;
            if (isAerialRoof) aerialBlend = 0.55;
            else if (kind === SURFACE_KIND.VEGETATION) aerialBlend = 0.62;
            else if (kind === SURFACE_KIND.ROAD) aerialBlend = 0.72;
            const baseBlend = 1 - aerialBlend;
            r = r * baseBlend + liftR * aerialBlend;
            g = g * baseBlend + liftG * aerialBlend;
            b = b * baseBlend + liftB * aerialBlend;
            hasAerialTint = true;
          }
        }
      }

      // Warm-light vs cool-slate shadow shading using global shadow map
      let shadowFactor = 1.0;
      if (shadowMap && tag !== 1) {
        shadowFactor = sampleShadowFactor(shadowMap, wx, wy, wz);
      } else if (shadowMap && tag === 1) {
        // Harbor water also receives soft shadows from piers, cranes & ships
        shadowFactor = sampleShadowFactor(shadowMap, wx, wy, 0.0);
      }

      const directLight = nDotL * shadowFactor;
      const warmSunR = 1.06;
      const warmSunG = 1.02;
      const warmSunB = 0.92;
      const coolAmbR = 0.58;
      const coolAmbG = 0.64;
      const coolAmbB = 0.78;
      const ambMixMin = hasAerialTint ? 0.66 : 0.22;
      const shadeT = ambMixMin + (1 - ambMixMin) * directLight;

      const litR = coolAmbR + (warmSunR - coolAmbR) * shadeT;
      const litG = coolAmbG + (warmSunG - coolAmbG) * shadeT;
      const litB = coolAmbB + (warmSunB - coolAmbB) * shadeT;

      r *= litR;
      g *= litG;
      b *= litB;

      // Contact Ambient Occlusion from depth neighbors (darkens building bases & under-bridge ground)
      let ao = 1.0;
      if (px >= 3 && py >= 3 && px + 3 < width && py + 3 < height) {
        const dSelf = depthMeters[idx]!;
        let occSum = 0;
        const samples = [
          depthMeters[idx - 2]!,
          depthMeters[idx + 2]!,
          depthMeters[idx - 2 * width]!,
          depthMeters[idx + 2 * width]!,
        ];
        for (const dn of samples) {
          const diff = dSelf - dn;
          if (diff > 0.8 && diff < 28) {
            occSum += Math.min(1, diff / 10);
          }
        }
        ao = 1.0 - occSum * 0.075;
      }
      r *= ao;
      g *= ao;
      b *= ao;

      // Crisp Ligne-Claire charcoal ink linework on depth jumps & structural edges
      if (px + 1 < width && py + 1 < height) {
        const rightIdx = idx + 1;
        const downIdx = idx + width;
        const dDiff = Math.max(
          Math.abs(depthMeters[idx]! - depthMeters[rightIdx]!),
          Math.abs(depthMeters[idx]! - depthMeters[downIdx]!),
        );
        const fDiff =
          featureIds[idx]! !== featureIds[rightIdx]! ||
          featureIds[idx]! !== featureIds[downIdx]!;
        const isStruct =
          kind === SURFACE_KIND.BUILDING ||
          kind === SURFACE_KIND.BRIDGE_DECK ||
          kind === SURFACE_KIND.QUAY ||
          kind === SURFACE_KIND.ROAD ||
          (kind === SURFACE_KIND.VEGETATION && wz > 2.3);
        const isEdge = dDiff > 1.8 || (fDiff && isStruct && tag !== 9);
        if (isEdge) {
          const alpha = dDiff > 3.2 ? 0.56 : 0.32;
          const inv = 1 - alpha;
          r = r * inv + 30 * alpha;
          g = g * inv + 35 * alpha;
          b = b * inv + 44 * alpha;
        }
      }

      // Apply subtle shadow tint on plain variant too for clear geometric readability
      if (shadowFactor < 0.99) {
        const plainShade = 0.72 + 0.28 * shadowFactor;
        plainRgba[o] = clampByte(plainRgba[o]! * plainShade);
        plainRgba[o + 1] = clampByte(plainRgba[o + 1]! * plainShade);
        plainRgba[o + 2] = clampByte(plainRgba[o + 2]! * plainShade);
      }

      illustratedRgba[o] = clampByte(r);
      illustratedRgba[o + 1] = clampByte(g);
      illustratedRgba[o + 2] = clampByte(b);
      illustratedRgba[o + 3] = 255;
    }
  }

  return {
    col,
    row,
    originPxX,
    originPxY,
    width,
    height,
    plainRgba,
    illustratedRgba,
    depthRgba,
    surfaceIdRgba,
    roadElevRgba,
    depthMeters,
    featureIds,
    surfaceKinds,
    hasDrawnOverride: false,
  };
}
