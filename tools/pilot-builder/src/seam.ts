import type { CameraManifest, SeamCheckResult } from "@small-yokohama/core";
import type { RenderedTileBuffers } from "./rasterizer.js";

export interface StitchedPilotBuffers {
  width: number;
  height: number;
  dataWidth?: number;
  dataHeight?: number;
  dataScale?: number;
  plainRgba: Uint8Array;
  illustratedRgba: Uint8Array;
  depthRgba: Uint8Array;
  surfaceIdRgba: Uint8Array;
  roadElevRgba: Uint8Array;
  seamChecks: SeamCheckResult[];
}

function l1ColorDiff(
  a: Uint8Array,
  idxA: number,
  b: Uint8Array,
  idxB: number,
): number {
  const oa = idxA * 4;
  const ob = idxB * 4;
  return (
    Math.abs(a[oa]! - b[ob]!) +
    Math.abs(a[oa + 1]! - b[ob + 1]!) +
    Math.abs(a[oa + 2]! - b[ob + 2]!)
  );
}

/**
 * Dynamic programming minimum-cost vertical seam across a horizontal overlap strip.
 */
function findMinVerticalSeam(
  leftRgb: Uint8Array,
  leftW: number,
  rightRgb: Uint8Array,
  rightW: number,
  height: number,
  overlapPx: number,
): { cuts: Int32Array; meanDiff: number; maxDiff: number } {
  const leftStartX = leftW - overlapPx;
  const dp = new Float64Array(height * overlapPx);
  const parent = new Int8Array(height * overlapPx);

  for (let ox = 0; ox < overlapPx; ox++) {
    dp[ox] = l1ColorDiff(leftRgb, leftStartX + ox, rightRgb, ox);
  }

  for (let y = 1; y < height; y++) {
    const prevRow = (y - 1) * overlapPx;
    const currRow = y * overlapPx;
    for (let ox = 0; ox < overlapPx; ox++) {
      let bestPrev = dp[prevRow + ox]!;
      let bestStep = 0;
      if (ox > 0 && dp[prevRow + ox - 1]! < bestPrev) {
        bestPrev = dp[prevRow + ox - 1]!;
        bestStep = -1;
      }
      if (ox + 1 < overlapPx && dp[prevRow + ox + 1]! < bestPrev) {
        bestPrev = dp[prevRow + ox + 1]!;
        bestStep = 1;
      }
      const diff = l1ColorDiff(
        leftRgb,
        y * leftW + leftStartX + ox,
        rightRgb,
        y * rightW + ox,
      );
      dp[currRow + ox] = bestPrev + diff;
      parent[currRow + ox] = bestStep;
    }
  }

  let bestOx = 0;
  let bestTotal = dp[(height - 1) * overlapPx]!;
  for (let ox = 1; ox < overlapPx; ox++) {
    const v = dp[(height - 1) * overlapPx + ox]!;
    if (v < bestTotal) {
      bestTotal = v;
      bestOx = ox;
    }
  }

  const cuts = new Int32Array(height);
  let cur = bestOx;
  let sumDiff = 0;
  let maxDiff = 0;
  for (let y = height - 1; y >= 0; y--) {
    cuts[y] = cur;
    const diff = l1ColorDiff(
      leftRgb,
      y * leftW + leftStartX + cur,
      rightRgb,
      y * rightW + cur,
    );
    sumDiff += diff;
    if (diff > maxDiff) maxDiff = diff;
    cur += parent[y * overlapPx + cur]!;
  }

  return { cuts, meanDiff: sumDiff / height, maxDiff };
}

/**
 * Dynamic programming minimum-cost horizontal seam across a vertical overlap strip.
 */
function findMinHorizontalSeam(
  topRgb: Uint8Array,
  topH: number,
  bottomRgb: Uint8Array,
  width: number,
  overlapPx: number,
): { cuts: Int32Array; meanDiff: number; maxDiff: number } {
  const topStartY = topH - overlapPx;
  const dp = new Float64Array(width * overlapPx);
  const parent = new Int8Array(width * overlapPx);

  for (let oy = 0; oy < overlapPx; oy++) {
    dp[oy] = l1ColorDiff(topRgb, (topStartY + oy) * width, bottomRgb, oy * width);
  }

  for (let x = 1; x < width; x++) {
    const prevCol = (x - 1) * overlapPx;
    const currCol = x * overlapPx;
    for (let oy = 0; oy < overlapPx; oy++) {
      let bestPrev = dp[prevCol + oy]!;
      let bestStep = 0;
      if (oy > 0 && dp[prevCol + oy - 1]! < bestPrev) {
        bestPrev = dp[prevCol + oy - 1]!;
        bestStep = -1;
      }
      if (oy + 1 < overlapPx && dp[prevCol + oy + 1]! < bestPrev) {
        bestPrev = dp[prevCol + oy + 1]!;
        bestStep = 1;
      }
      const diff = l1ColorDiff(
        topRgb,
        (topStartY + oy) * width + x,
        bottomRgb,
        oy * width + x,
      );
      dp[currCol + oy] = bestPrev + diff;
      parent[currCol + oy] = bestStep;
    }
  }

  let bestOy = 0;
  let bestTotal = dp[(width - 1) * overlapPx]!;
  for (let oy = 1; oy < overlapPx; oy++) {
    const v = dp[(width - 1) * overlapPx + oy]!;
    if (v < bestTotal) {
      bestTotal = v;
      bestOy = oy;
    }
  }

  const cuts = new Int32Array(width);
  let cur = bestOy;
  let sumDiff = 0;
  let maxDiff = 0;
  for (let x = width - 1; x >= 0; x--) {
    cuts[x] = cur;
    const diff = l1ColorDiff(
      topRgb,
      (topStartY + cur) * width + x,
      bottomRgb,
      cur * width + x,
    );
    sumDiff += diff;
    if (diff > maxDiff) maxDiff = diff;
    cur += parent[x * overlapPx + cur]!;
  }

  return { cuts, meanDiff: sumDiff / width, maxDiff };
}

function clampByte(v: number): number {
  return v < 0 ? 0 : v > 255 ? 255 : Math.round(v);
}

function smoothstep01(t: number): number {
  const c = t < 0 ? 0 : t > 1 ? 1 : t;
  return c * c * (3 - 2 * c);
}

function stitchRowHorizontal(
  left: Uint8Array,
  right: Uint8Array,
  tileW: number,
  tileH: number,
  overlapPx: number,
  cuts: Int32Array,
  featherRadiusPx = 0,
): Uint8Array {
  const outW = tileW * 2 - overlapPx;
  const out = new Uint8Array(outW * tileH * 4);
  const leftOverlapStart = tileW - overlapPx;

  for (let y = 0; y < tileH; y++) {
    const cutX = leftOverlapStart + cuts[y]!;
    const outRow = y * outW * 4;
    const leftRow = y * tileW * 4;
    const rightRow = y * tileW * 4;

    out.set(left.subarray(leftRow, leftRow + cutX * 4), outRow);

    const rightStartLocalX = cutX - leftOverlapStart;
    out.set(
      right.subarray(rightRow + rightStartLocalX * 4, rightRow + tileW * 4),
      outRow + cutX * 4,
    );

    if (featherRadiusPx > 0) {
      const fStart = Math.max(leftOverlapStart, cutX - featherRadiusPx);
      const fEnd = Math.min(tileW - 1, cutX + featherRadiusPx);
      const span = featherRadiusPx * 2;
      for (let x = fStart; x <= fEnd; x++) {
        const wRight = smoothstep01((x - (cutX - featherRadiusPx)) / span);
        const wLeft = 1 - wRight;
        const lo = leftRow + x * 4;
        const ro = rightRow + (x - leftOverlapStart) * 4;
        const dst = outRow + x * 4;
        out[dst] = clampByte(left[lo]! * wLeft + right[ro]! * wRight);
        out[dst + 1] = clampByte(left[lo + 1]! * wLeft + right[ro + 1]! * wRight);
        out[dst + 2] = clampByte(left[lo + 2]! * wLeft + right[ro + 2]! * wRight);
        out[dst + 3] = 255;
      }
    }
  }
  return out;
}

function stitchRowsVertical(
  top: Uint8Array,
  bottom: Uint8Array,
  width: number,
  tileH: number,
  overlapPx: number,
  cuts: Int32Array,
  featherRadiusPx = 0,
): Uint8Array {
  const outH = tileH * 2 - overlapPx;
  const out = new Uint8Array(width * outH * 4);
  const topOverlapStart = tileH - overlapPx;

  for (let y = 0; y < outH; y++) {
    const outRow = y * width * 4;
    if (y < topOverlapStart) {
      out.set(top.subarray(y * width * 4, (y + 1) * width * 4), outRow);
    } else if (y >= tileH) {
      const by = y - topOverlapStart;
      out.set(bottom.subarray(by * width * 4, (by + 1) * width * 4), outRow);
    } else {
      for (let x = 0; x < width; x++) {
        const cutY = topOverlapStart + cuts[x]!;
        const dst = outRow + x * 4;
        if (featherRadiusPx > 0 && Math.abs(y - cutY) <= featherRadiusPx) {
          const wBottom = smoothstep01((y - (cutY - featherRadiusPx)) / (featherRadiusPx * 2));
          const wTop = 1 - wBottom;
          const by = y - topOverlapStart;
          const srcT = (y * width + x) * 4;
          const srcB = (by * width + x) * 4;
          out[dst] = clampByte(top[srcT]! * wTop + bottom[srcB]! * wBottom);
          out[dst + 1] = clampByte(top[srcT + 1]! * wTop + bottom[srcB + 1]! * wBottom);
          out[dst + 2] = clampByte(top[srcT + 2]! * wTop + bottom[srcB + 2]! * wBottom);
          out[dst + 3] = 255;
        } else if (y < cutY) {
          const src = (y * width + x) * 4;
          out[dst] = top[src]!;
          out[dst + 1] = top[src + 1]!;
          out[dst + 2] = top[src + 2]!;
          out[dst + 3] = top[src + 3]!;
        } else {
          const by = y - topOverlapStart;
          const src = (by * width + x) * 4;
          out[dst] = bottom[src]!;
          out[dst + 1] = bottom[src + 1]!;
          out[dst + 2] = bottom[src + 2]!;
          out[dst + 3] = bottom[src + 3]!;
        }
      }
    }
  }

  return out;
}

function seamThreshold(aDrawn?: boolean, bDrawn?: boolean): number {
  if (aDrawn && bDrawn) return 48.0;
  if (aDrawn || bDrawn) return 110.0;
  return 8.0;
}

export function stitchWorkingTiles(
  camera: CameraManifest,
  tiles: readonly RenderedTileBuffers[],
): StitchedPilotBuffers {
  const findTile = (col: number, row: number) => {
    const t = tiles.find((tile) => tile.col === col && tile.row === row);
    if (!t) throw new Error(`Missing tile (${col}, ${row})`);
    return t;
  };

  const t00 = findTile(0, 0);
  const t10 = findTile(1, 0);
  const t01 = findTile(0, 1);
  const t11 = findTile(1, 1);

  const { tileSizePx, overlapPx } = camera.workingGrid;
  const fullW = camera.imageWidthPx;
  const fullH = camera.imageHeightPx;

  const seamTop = findMinVerticalSeam(
    t00.illustratedRgba,
    tileSizePx,
    t10.illustratedRgba,
    tileSizePx,
    tileSizePx,
    overlapPx,
  );
  const seamBottom = findMinVerticalSeam(
    t01.illustratedRgba,
    tileSizePx,
    t11.illustratedRgba,
    tileSizePx,
    tileSizePx,
    overlapPx,
  );

  const stitchBand = (
    key: "plainRgba" | "illustratedRgba" | "depthRgba" | "surfaceIdRgba" | "roadElevRgba",
    featherRadiusPx = 0,
  ) => ({
    top: stitchRowHorizontal(t00[key], t10[key], tileSizePx, tileSizePx, overlapPx, seamTop.cuts, featherRadiusPx),
    bottom: stitchRowHorizontal(t01[key], t11[key], tileSizePx, tileSizePx, overlapPx, seamBottom.cuts, featherRadiusPx),
  });

  // Only color illustrated layer gets Small SF 14px DP feathering; depth/ids stay hard-cut lossless.
  const illusBands = stitchBand("illustratedRgba", 14);
  const seamHoriz = findMinHorizontalSeam(
    illusBands.top,
    tileSizePx,
    illusBands.bottom,
    fullW,
    overlapPx,
  );

  const plainBands = stitchBand("plainRgba", 0);
  const depthBands = stitchBand("depthRgba", 0);
  const idBands = stitchBand("surfaceIdRgba", 0);
  const roadBands = stitchBand("roadElevRgba", 0);

  const topThresh = seamThreshold(t00.hasDrawnOverride, t10.hasDrawnOverride);
  const botThresh = seamThreshold(t01.hasDrawnOverride, t11.hasDrawnOverride);
  const horizThresh = Math.max(
    seamThreshold(t00.hasDrawnOverride, t01.hasDrawnOverride),
    seamThreshold(t10.hasDrawnOverride, t11.hasDrawnOverride),
  );

  const seamChecks: SeamCheckResult[] = [
    {
      seamId: "vertical-top-row-0",
      orientation: "vertical",
      lengthPx: tileSizePx,
      meanColorDiff: Number(seamTop.meanDiff.toFixed(4)),
      maxColorDiff: seamTop.maxDiff,
      passed: seamTop.meanDiff <= topThresh,
    },
    {
      seamId: "vertical-bottom-row-1",
      orientation: "vertical",
      lengthPx: tileSizePx,
      meanColorDiff: Number(seamBottom.meanDiff.toFixed(4)),
      maxColorDiff: seamBottom.maxDiff,
      passed: seamBottom.meanDiff <= botThresh,
    },
    {
      seamId: "horizontal-across-cols",
      orientation: "horizontal",
      lengthPx: fullW,
      meanColorDiff: Number(seamHoriz.meanDiff.toFixed(4)),
      maxColorDiff: seamHoriz.maxDiff,
      passed: seamHoriz.meanDiff <= horizThresh,
    },
  ];

  return {
    width: fullW,
    height: fullH,
    plainRgba: stitchRowsVertical(plainBands.top, plainBands.bottom, fullW, tileSizePx, overlapPx, seamHoriz.cuts, 0),
    illustratedRgba: stitchRowsVertical(illusBands.top, illusBands.bottom, fullW, tileSizePx, overlapPx, seamHoriz.cuts, 14),
    depthRgba: stitchRowsVertical(depthBands.top, depthBands.bottom, fullW, tileSizePx, overlapPx, seamHoriz.cuts, 0),
    surfaceIdRgba: stitchRowsVertical(idBands.top, idBands.bottom, fullW, tileSizePx, overlapPx, seamHoriz.cuts, 0),
    roadElevRgba: stitchRowsVertical(roadBands.top, roadBands.bottom, fullW, tileSizePx, overlapPx, seamHoriz.cuts, 0),
    seamChecks,
  };
}

export interface GridTileEntry {
  col: number;
  row: number;
  hasDrawnOverride: boolean;
  rgba: Uint8Array;
}

export interface GridSeamPlan {
  cols: number;
  rows: number;
  colOffset: number;
  rowOffset: number;
  tileSizePx: number;
  overlapPx: number;
  fullWidth: number;
  fullHeight: number;
  /** Row-major [rIdx * (cols - 1) + cIdx], each length tileSizePx */
  verticalCuts: Int32Array[];
  /** Horizontal joins [rIdx = 0 .. rows - 2], each length fullWidth */
  horizontalCuts: Int32Array[];
  seamChecks: SeamCheckResult[];
}

function stitchRowStripHorizontal(
  rowTiles: readonly GridTileEntry[],
  cols: number,
  tileSizePx: number,
  overlapPx: number,
  rowVerticalCuts: readonly Int32Array[],
  yStartInTile: number,
  stripHeight: number,
  featherRadiusPx: number,
  dst: Uint8Array,
  dstWidth: number,
  dstBaseY = 0,
): void {
  const stridePx = tileSizePx - overlapPx;

  for (let sy = 0; sy < stripHeight; sy++) {
    const ty = yStartInTile + sy;
    const dstRowOff = (dstBaseY + sy) * dstWidth * 4;
    const srcRowOff = ty * tileSizePx * 4;

    const first = rowTiles[0]!.rgba;
    dst.set(first.subarray(srcRowOff, srcRowOff + tileSizePx * 4), dstRowOff);

    for (let cIdx = 1; cIdx < cols; cIdx++) {
      const leftRgb = rowTiles[cIdx - 1]!.rgba;
      const rightRgb = rowTiles[cIdx]!.rgba;
      const cuts = rowVerticalCuts[cIdx - 1]!;
      const cutXLocal = cuts[ty]!;
      const dstX0 = cIdx * stridePx;

      for (let xLocal = 0; xLocal < overlapPx; xLocal++) {
        const dstIdx = dstRowOff + (dstX0 + xLocal) * 4;
        if (featherRadiusPx > 0 && Math.abs(xLocal - cutXLocal) <= featherRadiusPx) {
          const wRight = smoothstep01(
            (xLocal - (cutXLocal - featherRadiusPx)) / (featherRadiusPx * 2),
          );
          const wLeft = 1 - wRight;
          const lo = srcRowOff + (stridePx + xLocal) * 4;
          const ro = srcRowOff + xLocal * 4;
          dst[dstIdx] = clampByte(leftRgb[lo]! * wLeft + rightRgb[ro]! * wRight);
          dst[dstIdx + 1] = clampByte(leftRgb[lo + 1]! * wLeft + rightRgb[ro + 1]! * wRight);
          dst[dstIdx + 2] = clampByte(leftRgb[lo + 2]! * wLeft + rightRgb[ro + 2]! * wRight);
          dst[dstIdx + 3] = 255;
        } else if (xLocal >= cutXLocal) {
          const ro = srcRowOff + xLocal * 4;
          dst[dstIdx] = rightRgb[ro]!;
          dst[dstIdx + 1] = rightRgb[ro + 1]!;
          dst[dstIdx + 2] = rightRgb[ro + 2]!;
          dst[dstIdx + 3] = rightRgb[ro + 3]!;
        }
      }

      dst.set(
        rightRgb.subarray(srcRowOff + overlapPx * 4, srcRowOff + tileSizePx * 4),
        dstRowOff + (dstX0 + overlapPx) * 4,
      );
    }
  }
}

function tileKey(col: number, row: number): string {
  return `${col},${row}`;
}

/**
 * Compute all vertical and horizontal minimum-cost DP seam cuts across an arbitrary
 * N x M grid of working tiles using only 128 px overlap strips for horizontal DP,
 * keeping peak memory minimal on large stitches (e.g. 8 x 3 = 24 tiles).
 */
export function computeGridSeamPlan(
  camera: CameraManifest,
  tiles: readonly GridTileEntry[],
): GridSeamPlan {
  const { cols, rows, tileSizePx, overlapPx } = camera.workingGrid;
  const colOffset = camera.workingGrid.colOffset ?? 0;
  const rowOffset = camera.workingGrid.rowOffset ?? 0;
  const stridePx = tileSizePx - overlapPx;
  const fullWidth = cols * stridePx + overlapPx;
  const fullHeight = rows * stridePx + overlapPx;

  const byKey = new Map<string, GridTileEntry>();
  for (const t of tiles) {
    byKey.set(tileKey(t.col, t.row), t);
  }
  const getTile = (col: number, row: number): GridTileEntry => {
    const t = byKey.get(tileKey(col, row));
    if (!t) throw new Error(`Missing grid tile (${col}, ${row})`);
    return t;
  };

  const seamChecks: SeamCheckResult[] = [];
  const verticalCuts: Int32Array[] = [];
  const rowCutsByRow: Int32Array[][] = [];

  for (let rIdx = 0; rIdx < rows; rIdx++) {
    const row = rowOffset + rIdx;
    const rowCuts: Int32Array[] = [];
    for (let cIdx = 0; cIdx < cols - 1; cIdx++) {
      const colL = colOffset + cIdx;
      const colR = colL + 1;
      const tL = getTile(colL, row);
      const tR = getTile(colR, row);
      const seam = findMinVerticalSeam(
        tL.rgba,
        tileSizePx,
        tR.rgba,
        tileSizePx,
        tileSizePx,
        overlapPx,
      );
      const thresh = seamThreshold(tL.hasDrawnOverride, tR.hasDrawnOverride);
      verticalCuts.push(seam.cuts);
      rowCuts.push(seam.cuts);
      seamChecks.push({
        seamId: `v-r${row}-c${colL}_${colR}`,
        orientation: "vertical",
        lengthPx: tileSizePx,
        meanColorDiff: Number(seam.meanDiff.toFixed(4)),
        maxColorDiff: seam.maxDiff,
        passed: seam.meanDiff <= thresh,
      });
    }
    rowCutsByRow.push(rowCuts);
  }

  // Compute horizontal seams using thin (fullWidth x overlapPx) stitched strips per row join
  const horizontalCuts: Int32Array[] = [];
  const topStrip = new Uint8Array(fullWidth * overlapPx * 4);
  const botStrip = new Uint8Array(fullWidth * overlapPx * 4);

  for (let rIdx = 0; rIdx < rows - 1; rIdx++) {
    const rowTop = rowOffset + rIdx;
    const rowBot = rowTop + 1;
    const topTiles: GridTileEntry[] = [];
    const botTiles: GridTileEntry[] = [];
    for (let cIdx = 0; cIdx < cols; cIdx++) {
      topTiles.push(getTile(colOffset + cIdx, rowTop));
      botTiles.push(getTile(colOffset + cIdx, rowBot));
    }

    stitchRowStripHorizontal(
      topTiles,
      cols,
      tileSizePx,
      overlapPx,
      rowCutsByRow[rIdx]!,
      tileSizePx - overlapPx,
      overlapPx,
      14,
      topStrip,
      fullWidth,
      0,
    );
    stitchRowStripHorizontal(
      botTiles,
      cols,
      tileSizePx,
      overlapPx,
      rowCutsByRow[rIdx + 1]!,
      0,
      overlapPx,
      14,
      botStrip,
      fullWidth,
      0,
    );

    const seam = findMinHorizontalSeam(topStrip, overlapPx, botStrip, fullWidth, overlapPx);
    let worstThresh = 8.0;
    for (let cIdx = 0; cIdx < cols; cIdx++) {
      worstThresh = Math.max(
        worstThresh,
        seamThreshold(topTiles[cIdx]!.hasDrawnOverride, botTiles[cIdx]!.hasDrawnOverride),
      );
    }

    horizontalCuts.push(seam.cuts);
    seamChecks.push({
      seamId: `h-r${rowTop}_${rowBot}`,
      orientation: "horizontal",
      lengthPx: fullWidth,
      meanColorDiff: Number(seam.meanDiff.toFixed(4)),
      maxColorDiff: seam.maxDiff,
      passed: seam.meanDiff <= worstThresh,
    });
  }

  return {
    cols,
    rows,
    colOffset,
    rowOffset,
    tileSizePx,
    overlapPx,
    fullWidth,
    fullHeight,
    verticalCuts,
    horizontalCuts,
    seamChecks,
  };
}

/**
 * Stitch any per-tile RGBA layer across the full N x M grid using a precomputed GridSeamPlan.
 * Allocates only one output canvas plus one single-row scratch band.
 */
export function stitchGridRgbaLayer(
  plan: GridSeamPlan,
  tiles: readonly GridTileEntry[],
  featherRadiusPx = 0,
): Uint8Array {
  const { cols, rows, colOffset, rowOffset, tileSizePx, overlapPx, fullWidth, fullHeight } = plan;
  const stridePx = tileSizePx - overlapPx;

  const byKey = new Map<string, GridTileEntry>();
  for (const t of tiles) {
    byKey.set(tileKey(t.col, t.row), t);
  }
  const getTile = (col: number, row: number): GridTileEntry => {
    const t = byKey.get(tileKey(col, row));
    if (!t) throw new Error(`Missing grid tile (${col}, ${row})`);
    return t;
  };

  const out = new Uint8Array(fullWidth * fullHeight * 4);
  const currBand = rows > 1 ? new Uint8Array(fullWidth * tileSizePx * 4) : null;

  for (let rIdx = 0; rIdx < rows; rIdx++) {
    const row = rowOffset + rIdx;
    const rowTiles: GridTileEntry[] = [];
    for (let cIdx = 0; cIdx < cols; cIdx++) {
      rowTiles.push(getTile(colOffset + cIdx, row));
    }
    const rowVertCuts = plan.verticalCuts.slice(rIdx * (cols - 1), (rIdx + 1) * (cols - 1));

    if (rIdx === 0) {
      stitchRowStripHorizontal(
        rowTiles,
        cols,
        tileSizePx,
        overlapPx,
        rowVertCuts,
        0,
        tileSizePx,
        featherRadiusPx,
        out,
        fullWidth,
        0,
      );
      continue;
    }

    stitchRowStripHorizontal(
      rowTiles,
      cols,
      tileSizePx,
      overlapPx,
      rowVertCuts,
      0,
      tileSizePx,
      featherRadiusPx,
      currBand!,
      fullWidth,
      0,
    );

    const hCuts = plan.horizontalCuts[rIdx - 1]!;
    const outBaseY = rIdx * stridePx;

    for (let oy = 0; oy < overlapPx; oy++) {
      const outY = outBaseY + oy;
      const outRowOff = outY * fullWidth * 4;
      const botRowOff = oy * fullWidth * 4;
      for (let x = 0; x < fullWidth; x++) {
        const cutY = hCuts[x]!;
        const dst = outRowOff + x * 4;
        if (featherRadiusPx > 0 && Math.abs(oy - cutY) <= featherRadiusPx) {
          const wBottom = smoothstep01(
            (oy - (cutY - featherRadiusPx)) / (featherRadiusPx * 2),
          );
          const wTop = 1 - wBottom;
          const srcB = botRowOff + x * 4;
          out[dst] = clampByte(out[dst]! * wTop + currBand![srcB]! * wBottom);
          out[dst + 1] = clampByte(out[dst + 1]! * wTop + currBand![srcB + 1]! * wBottom);
          out[dst + 2] = clampByte(out[dst + 2]! * wTop + currBand![srcB + 2]! * wBottom);
          out[dst + 3] = 255;
        } else if (oy >= cutY) {
          const srcB = botRowOff + x * 4;
          out[dst] = currBand![srcB]!;
          out[dst + 1] = currBand![srcB + 1]!;
          out[dst + 2] = currBand![srcB + 2]!;
          out[dst + 3] = currBand![srcB + 3]!;
        }
      }
    }

    for (let by = overlapPx; by < tileSizePx; by++) {
      const outY = outBaseY + by;
      const srcStart = by * fullWidth * 4;
      out.set(currBand!.subarray(srcStart, srcStart + fullWidth * 4), outY * fullWidth * 4);
    }
  }

  return out;
}
