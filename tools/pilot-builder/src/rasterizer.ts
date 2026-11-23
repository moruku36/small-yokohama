import {
  SURFACE_KIND,
  encodeDepthRgba,
  encodeElevationRgba,
  encodeFeatureIdRgba,
  localToImage,
  type CameraManifest,
  type SceneTriangle,
  type SurfaceKind,
} from "@small-yokohama/core";

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
}

const LIGHT_DIR = (() => {
  const x = -0.55;
  const y = -0.35;
  const z = 0.76;
  const len = Math.hypot(x, y, z);
  return [x / len, y / len, z / len] as const;
})();

function shadeRgb(
  base: readonly [number, number, number],
  normal: readonly [number, number, number],
  ambient: number,
  diffuseScale: number,
): [number, number, number] {
  const nDotL = Math.max(0, normal[0] * LIGHT_DIR[0] + normal[1] * LIGHT_DIR[1] + normal[2] * LIGHT_DIR[2]);
  const intensity = ambient + diffuseScale * nDotL;
  return [
    Math.min(255, Math.max(0, Math.round(base[0] * intensity))),
    Math.min(255, Math.max(0, Math.round(base[1] * intensity))),
    Math.min(255, Math.max(0, Math.round(base[2] * intensity))),
  ];
}

function edgeFn(ax: number, ay: number, bx: number, by: number, cx: number, cy: number): number {
  return (cx - ax) * (by - ay) - (cy - ay) * (bx - ax);
}

/**
 * Software orthographic Z-buffer rasterizer for a single working tile window.
 * Produces pixel-locked plain color, illustrated color, 16-bit camera depth,
 * 24-bit feature IDs, and ground-road elevation (isolated from overhead decks).
 */
export function renderWorkingTile(
  camera: CameraManifest,
  triangles: readonly SceneTriangle[],
  col: number,
  row: number,
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
  const materialTags = new Uint8Array(nPixels); // 0=other,1=water,2=brick,3=asphalt,4=park

  const tagCode = (tag?: SceneTriangle["materialTag"]): number => {
    if (tag === "water") return 1;
    if (tag === "brick") return 2;
    if (tag === "asphalt") return 3;
    if (tag === "park") return 4;
    return 0;
  };

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

    const pShade = shadeRgb(tri.plainRgb, tri.normal, 0.56, 0.44);
    const iShade = shadeRgb(tri.illustratedRgb, tri.normal, 0.62, 0.40);
    const fEnc = encodeFeatureIdRgba(tri.featureId);
    const mCode = tagCode(tri.materialTag);

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

          const o = idx * 4;
          plainRgba[o] = pShade[0];
          plainRgba[o + 1] = pShade[1];
          plainRgba[o + 2] = pShade[2];

          illusBaseRgba[o] = iShade[0];
          illusBaseRgba[o + 1] = iShade[1];
          illusBaseRgba[o + 2] = iShade[2];

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

  // Pass 2: Road/ground elevation map excluding overhead bridges & buildings
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

  // Pass 3: Architectural illustration finish (procedural water ripples, brick courses, crisp ink outlines)
  // Computed strictly in full-image global pixel coordinates so overlapping tiles stay seamless!
  const illustratedRgba = new Uint8Array(illusBaseRgba);
  for (let py = 0; py < height; py++) {
    const gy = originPxY + py;
    for (let px = 0; px < width; px++) {
      const gx = originPxX + px;
      const idx = py * width + px;
      const o = idx * 4;
      const tag = materialTags[idx]!;
      const kind = surfaceKinds[idx] as SurfaceKind;

      if (tag === 1) {
        // Water shimmer ripples
        const wave = Math.sin(gx * 0.09 + gy * 0.19) * Math.cos(gx * 0.04 - gy * 0.07);
        const shift = Math.round(wave * 7);
        illustratedRgba[o] = Math.min(255, Math.max(0, illustratedRgba[o]! + shift));
        illustratedRgba[o + 1] = Math.min(255, Math.max(0, illustratedRgba[o + 1]! + shift + 2));
        illustratedRgba[o + 2] = Math.min(255, Math.max(0, illustratedRgba[o + 2]! + shift + 4));
      } else if (tag === 2) {
        // Subtle red-brick horizontal course modulation
        const course = ((gy + Math.floor(gx * 0.15)) % 6) === 0 ? -12 : 4;
        illustratedRgba[o] = Math.min(255, Math.max(0, illustratedRgba[o]! + course));
        illustratedRgba[o + 1] = Math.min(255, Math.max(0, illustratedRgba[o + 1]! + Math.round(course * 0.6)));
        illustratedRgba[o + 2] = Math.min(255, Math.max(0, illustratedRgba[o + 2]! + Math.round(course * 0.5)));
      } else if (tag === 4) {
        // Soft painterly lawn stipple
        const stipple = ((gx * 7 + gy * 13) % 11) - 5;
        illustratedRgba[o] = Math.min(255, Math.max(0, illustratedRgba[o]! + stipple));
        illustratedRgba[o + 1] = Math.min(255, Math.max(0, illustratedRgba[o + 1]! + stipple));
      }

      // Edge-preserving geometric ink line on depth discontinuities or feature boundaries
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
        const isEdge =
          dDiff > 2.2 ||
          (fDiff && (kind === SURFACE_KIND.BUILDING || kind === SURFACE_KIND.BRIDGE_DECK || kind === SURFACE_KIND.QUAY || kind === SURFACE_KIND.ROAD));
        if (isEdge) {
          const alpha = dDiff > 3.5 ? 0.52 : 0.34;
          const inv = 1 - alpha;
          illustratedRgba[o] = Math.round(illustratedRgba[o]! * inv + 42 * alpha);
          illustratedRgba[o + 1] = Math.round(illustratedRgba[o + 1]! * inv + 38 * alpha);
          illustratedRgba[o + 2] = Math.round(illustratedRgba[o + 2]! * inv + 46 * alpha);
        }
      }
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
  };
}
