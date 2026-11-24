import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { FEATURE_IDS, SURFACE_KIND } from "@small-yokohama/core";
import { decodePngRgba, encodePngRgba, resizeRgbaBilinear } from "./png.js";
import type { RenderedTileBuffers } from "./rasterizer.js";

export interface DrawnTileApplyResult {
  applied: boolean;
  bestDx?: number;
  bestDy?: number;
  edgeCorr?: number;
  srcWidth?: number;
  srcHeight?: number;
}

/**
 * Save the 3D orthographic architectural base tile as PNG for image-to-image tile redrawing.
 */
export function exportBaseTilePng(baseDir: string, tile: RenderedTileBuffers): string {
  mkdirSync(baseDir, { recursive: true });
  const outPath = join(baseDir, `tile_${tile.col}_${tile.row}_base.png`);
  writeFileSync(outPath, encodePngRgba(tile.width, tile.height, tile.illustratedRgba));
  return outPath;
}

function lumaAt(rgba: Uint8Array, idx: number): number {
  const o = idx * 4;
  return rgba[o]! * 0.299 + rgba[o + 1]! * 0.587 + rgba[o + 2]! * 0.114;
}

function computeDownsampledSobel(
  rgba: Uint8Array,
  w: number,
  h: number,
  dsSize: number,
  surfaceKinds?: Uint8Array,
): { edge: Float32Array; valid: Uint8Array } {
  const luma = new Float32Array(dsSize * dsSize);
  const valid = new Uint8Array(dsSize * dsSize);
  const stepX = w / dsSize;
  const stepY = h / dsSize;

  for (let y = 0; y < dsSize; y++) {
    const sy = Math.min(h - 1, Math.floor((y + 0.5) * stepY));
    for (let x = 0; x < dsSize; x++) {
      const sx = Math.min(w - 1, Math.floor((x + 0.5) * stepX));
      const idx = sy * w + sx;
      luma[y * dsSize + x] = lumaAt(rgba, idx);
      if (!surfaceKinds || surfaceKinds[idx] !== SURFACE_KIND.WATER) {
        valid[y * dsSize + x] = 1;
      }
    }
  }

  const edge = new Float32Array(dsSize * dsSize);
  for (let y = 1; y < dsSize - 1; y++) {
    for (let x = 1; x < dsSize - 1; x++) {
      const i = y * dsSize + x;
      const gx =
        -luma[i - dsSize - 1]! +
        luma[i - dsSize + 1]! -
        2 * luma[i - 1]! +
        2 * luma[i + 1]! -
        luma[i + dsSize - 1]! +
        luma[i + dsSize + 1]!;
      const gy =
        -luma[i - dsSize - 1]! -
        2 * luma[i - dsSize]! -
        luma[i - dsSize + 1]! +
        luma[i + dsSize - 1]! +
        2 * luma[i + dsSize]! +
        luma[i + dsSize + 1]!;
      edge[i] = Math.hypot(gx, gy);
    }
  }

  return { edge, valid };
}

function edgeCrossCorrelation(
  baseEdge: Float32Array,
  baseValid: Uint8Array,
  drawnRgba: Uint8Array,
  w: number,
  h: number,
  shiftX: number,
  shiftY: number,
  dsSize = 256,
): number {
  const stepX = w / dsSize;
  const stepY = h / dsSize;
  const luma = new Float32Array(dsSize * dsSize);

  for (let y = 0; y < dsSize; y++) {
    const sy = Math.min(h - 1, Math.max(0, Math.round((y + 0.5) * stepY + shiftY)));
    for (let x = 0; x < dsSize; x++) {
      const sx = Math.min(w - 1, Math.max(0, Math.round((x + 0.5) * stepX + shiftX)));
      luma[y * dsSize + x] = lumaAt(drawnRgba, sy * w + sx);
    }
  }

  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let y = 2; y < dsSize - 2; y++) {
    for (let x = 2; x < dsSize - 2; x++) {
      const i = y * dsSize + x;
      if (!baseValid[i]) continue;
      const gx =
        -luma[i - dsSize - 1]! +
        luma[i - dsSize + 1]! -
        2 * luma[i - 1]! +
        2 * luma[i + 1]! -
        luma[i + dsSize - 1]! +
        luma[i + dsSize + 1]!;
      const gy =
        -luma[i - dsSize - 1]! -
        2 * luma[i - dsSize]! -
        luma[i - dsSize + 1]! +
        luma[i + dsSize - 1]! +
        2 * luma[i + dsSize]! +
        luma[i + dsSize + 1]!;
      const db = Math.hypot(gx, gy);
      const da = baseEdge[i]!;
      dot += da * db;
      normA += da * da;
      normB += db * db;
    }
  }

  if (normA <= 1e-6 || normB <= 1e-6) return 0;
  return dot / Math.sqrt(normA * normB);
}

function shiftRgbaClamped(
  src: Uint8Array,
  w: number,
  h: number,
  shiftX: number,
  shiftY: number,
): Uint8Array {
  if (shiftX === 0 && shiftY === 0) return src;
  const out = new Uint8Array(w * h * 4);
  for (let y = 0; y < h; y++) {
    const sy = Math.min(h - 1, Math.max(0, y + shiftY));
    for (let x = 0; x < w; x++) {
      const sx = Math.min(w - 1, Math.max(0, x + shiftX));
      const s = (sy * w + sx) * 4;
      const d = (y * w + x) * 4;
      out[d] = src[s]!;
      out[d + 1] = src[s + 1]!;
      out[d + 2] = src[s + 2]!;
      out[d + 3] = 255;
    }
  }
  return out;
}

function downsampleRgbaToTarget(
  src: Uint8Array,
  w: number,
  h: number,
  targetSize: number,
): Uint8Array {
  return resizeRgbaBilinear(src, w, h, targetSize, targetSize);
}

/**
 * If a hand/AI-redrawn PNG exists in `data/drawn-tiles/tile_{col}_{row}.png`,
 * verify/align edges against the 3D architectural base, composite the exact 3D open-bay
 * water mask (`SURFACE_KIND.WATER`) so no hallucinated islands appear in the bay,
 * and write visual inspection outputs.
 */
export function applyDrawnTileOverride(
  drawnDir: string,
  tile: RenderedTileBuffers,
): DrawnTileApplyResult {
  const tilePath = join(drawnDir, `tile_${tile.col}_${tile.row}.png`);
  if (!existsSync(tilePath)) {
    return { applied: false };
  }

  const decoded = decodePngRgba(readFileSync(tilePath));
  const scaled = resizeRgbaBilinear(
    decoded.data,
    decoded.width,
    decoded.height,
    tile.width,
    tile.height,
  );

  // Sobel edge alignment search across [-10..10] full-res px
  const dsSize = 256;
  const { edge: baseEdge, valid: baseValid } = computeDownsampledSobel(
    tile.illustratedRgba,
    tile.width,
    tile.height,
    dsSize,
    tile.surfaceKinds,
  );

  const zeroCorr = edgeCrossCorrelation(baseEdge, baseValid, scaled, tile.width, tile.height, 0, 0, dsSize);
  let bestDx = 0;
  let bestDy = 0;
  let bestCorr = zeroCorr;

  for (let dy = -10; dy <= 10; dy += 2) {
    for (let dx = -10; dx <= 10; dx += 2) {
      const c = edgeCrossCorrelation(baseEdge, baseValid, scaled, tile.width, tile.height, dx, dy, dsSize);
      if (c > bestCorr) {
        bestCorr = c;
        bestDx = dx;
        bestDy = dy;
      }
    }
  }
  const coarseDx = bestDx;
  const coarseDy = bestDy;
  for (let dy = coarseDy - 2; dy <= coarseDy + 2; dy++) {
    for (let dx = coarseDx - 2; dx <= coarseDx + 2; dx++) {
      if (Math.abs(dx) > 10 || Math.abs(dy) > 10) continue;
      const c = edgeCrossCorrelation(baseEdge, baseValid, scaled, tile.width, tile.height, dx, dy, dsSize);
      if (c > bestCorr) {
        bestCorr = c;
        bestDx = dx;
        bestDy = dy;
      }
    }
  }

  const applyShift =
    Math.abs(bestDx) <= 8 && Math.abs(bestDy) <= 8 && bestCorr - zeroCorr >= 0.02;
  const finalDx = applyShift ? bestDx : 0;
  const finalDy = applyShift ? bestDy : 0;
  const alignedDrawn = shiftRgbaClamped(scaled, tile.width, tile.height, finalDx, finalDy);

  // Build 2-pass Chamfer shoreline distance (0 = pure water, 1..3 = land edge buffer)
  // Plus a 20px protective halo around berthed ships (Asuka II, Coast Guard vessels)
  // so stylized AI ship hulls, bows & wakes are never sliced by the tight 3D water mask.
  const w = tile.width;
  const h = tile.height;
  const nPixels = w * h;
  const landDist = new Uint8Array(nPixels);
  const shipDist = new Uint8Array(nPixels);
  const shipMaxDist = 24;
  for (let i = 0; i < nPixels; i++) {
    landDist[i] = tile.surfaceKinds[i] === SURFACE_KIND.WATER ? 0 : 12;
    const fid = tile.featureIds[i]!;
    shipDist[i] =
      fid === FEATURE_IDS.CRUISE_SHIP_ASUKA || fid === FEATURE_IDS.COAST_GUARD_VESSEL
        ? 0
        : shipMaxDist;
  }
  for (let y = 1; y < h; y++) {
    const rowOff = y * w;
    for (let x = 1; x < w - 1; x++) {
      const i = rowOff + x;
      if (landDist[i] !== 0) {
        landDist[i] = Math.min(
          landDist[i]!,
          landDist[i - 1]! + 1,
          landDist[i - w]! + 1,
          landDist[i - w - 1]! + 2,
          landDist[i - w + 1]! + 2,
        );
      }
      if (shipDist[i] !== 0) {
        shipDist[i] = Math.min(
          shipDist[i]!,
          shipDist[i - 1]! + 1,
          shipDist[i - w]! + 1,
          shipDist[i - w - 1]! + 2,
          shipDist[i - w + 1]! + 2,
        );
      }
    }
  }
  for (let y = h - 2; y >= 0; y--) {
    const rowOff = y * w;
    for (let x = w - 2; x >= 1; x--) {
      const i = rowOff + x;
      if (landDist[i] !== 0) {
        landDist[i] = Math.min(
          landDist[i]!,
          landDist[i + 1]! + 1,
          landDist[i + w]! + 1,
          landDist[i + w - 1]! + 2,
          landDist[i + w + 1]! + 2,
        );
      }
      if (shipDist[i] !== 0) {
        shipDist[i] = Math.min(
          shipDist[i]!,
          shipDist[i + 1]! + 1,
          shipDist[i + w]! + 1,
          shipDist[i + w - 1]! + 2,
          shipDist[i + w + 1]! + 2,
        );
      }
    }
  }

  const composited = new Uint8Array(nPixels * 4);
  const overlayCheck = new Uint8Array(nPixels * 4);
  for (let i = 0; i < nPixels; i++) {
    const o = i * 4;
    const d = landDist[i]!;
    const sd = shipDist[i]!;
    // Water pixels strictly take the clean 3D painted Yokohama Bay water EXCEPT within the ship halo,
    // which smoothly feathers over 12..22px to preserve the entire drawn vessel hull & wake.
    let waterAlpha = d === 0 ? 1.0 : d === 1 ? 0.65 : d === 2 ? 0.25 : 0.0;
    if (sd < shipMaxDist) {
      const shipProtect = sd <= 12 ? 0.0 : Math.min(1.0, (sd - 12) / 10);
      waterAlpha = Math.min(waterAlpha, shipProtect);
    }
    const drawnAlpha = 1.0 - waterAlpha;

    const baseR = tile.illustratedRgba[o]!;
    const baseG = tile.illustratedRgba[o + 1]!;
    const baseB = tile.illustratedRgba[o + 2]!;
    const drwR = alignedDrawn[o]!;
    const drwG = alignedDrawn[o + 1]!;
    const drwB = alignedDrawn[o + 2]!;

    composited[o] = Math.round(baseR * waterAlpha + drwR * drawnAlpha);
    composited[o + 1] = Math.round(baseG * waterAlpha + drwG * drawnAlpha);
    composited[o + 2] = Math.round(baseB * waterAlpha + drwB * drawnAlpha);
    composited[o + 3] = 255;

    overlayCheck[o] = Math.round((baseR + drwR) * 0.5);
    overlayCheck[o + 1] = Math.round((baseG + drwG) * 0.5);
    overlayCheck[o + 2] = Math.round((baseB + drwB) * 0.5);
    overlayCheck[o + 3] = 255;
  }

  tile.illustratedRgba.set(composited);
  tile.hasDrawnOverride = true;

  mkdirSync(drawnDir, { recursive: true });
  const compPreview = downsampleRgbaToTarget(composited, w, h, 1024);
  writeFileSync(
    join(drawnDir, `tile_${tile.col}_${tile.row}_composited.png`),
    encodePngRgba(1024, 1024, compPreview),
  );
  const ovPreview = downsampleRgbaToTarget(overlayCheck, w, h, 1024);
  writeFileSync(
    join(drawnDir, `tile_${tile.col}_${tile.row}_overlay_check.png`),
    encodePngRgba(1024, 1024, ovPreview),
  );

  console.log(
    `[drawn-tile] Applied tile_${tile.col}_${tile.row}.png | src=${decoded.width}x${decoded.height} | shift=(${finalDx},${finalDy}) px | edgeCorr=${(applyShift ? bestCorr : zeroCorr).toFixed(3)}`,
  );

  return {
    applied: true,
    bestDx: finalDx,
    bestDy: finalDy,
    edgeCorr: Number((applyShift ? bestCorr : zeroCorr).toFixed(4)),
    srcWidth: decoded.width,
    srcHeight: decoded.height,
  };
}
