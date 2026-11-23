import type { CameraManifest, SeamCheckResult } from "@small-yokohama/core";
import type { RenderedTileBuffers } from "./rasterizer.js";

export interface StitchedPilotBuffers {
  width: number;
  height: number;
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

function stitchRowHorizontal(
  left: Uint8Array,
  right: Uint8Array,
  tileW: number,
  tileH: number,
  overlapPx: number,
  cuts: Int32Array,
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
        if (y < cutY) {
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

  const stitchBand = (key: "plainRgba" | "illustratedRgba" | "depthRgba" | "surfaceIdRgba" | "roadElevRgba") => ({
    top: stitchRowHorizontal(t00[key], t10[key], tileSizePx, tileSizePx, overlapPx, seamTop.cuts),
    bottom: stitchRowHorizontal(t01[key], t11[key], tileSizePx, tileSizePx, overlapPx, seamBottom.cuts),
  });

  const illusBands = stitchBand("illustratedRgba");
  const seamHoriz = findMinHorizontalSeam(
    illusBands.top,
    tileSizePx,
    illusBands.bottom,
    fullW,
    overlapPx,
  );

  const plainBands = stitchBand("plainRgba");
  const depthBands = stitchBand("depthRgba");
  const idBands = stitchBand("surfaceIdRgba");
  const roadBands = stitchBand("roadElevRgba");

  const seamChecks: SeamCheckResult[] = [
    {
      seamId: "vertical-top-row-0",
      orientation: "vertical",
      lengthPx: tileSizePx,
      meanColorDiff: Number(seamTop.meanDiff.toFixed(4)),
      maxColorDiff: seamTop.maxDiff,
      passed: seamTop.meanDiff <= 8.0,
    },
    {
      seamId: "vertical-bottom-row-1",
      orientation: "vertical",
      lengthPx: tileSizePx,
      meanColorDiff: Number(seamBottom.meanDiff.toFixed(4)),
      maxColorDiff: seamBottom.maxDiff,
      passed: seamBottom.meanDiff <= 8.0,
    },
    {
      seamId: "horizontal-across-cols",
      orientation: "horizontal",
      lengthPx: fullW,
      meanColorDiff: Number(seamHoriz.meanDiff.toFixed(4)),
      maxColorDiff: seamHoriz.maxDiff,
      passed: seamHoriz.meanDiff <= 8.0,
    },
  ];

  return {
    width: fullW,
    height: fullH,
    plainRgba: stitchRowsVertical(plainBands.top, plainBands.bottom, fullW, tileSizePx, overlapPx, seamHoriz.cuts),
    illustratedRgba: stitchRowsVertical(illusBands.top, illusBands.bottom, fullW, tileSizePx, overlapPx, seamHoriz.cuts),
    depthRgba: stitchRowsVertical(depthBands.top, depthBands.bottom, fullW, tileSizePx, overlapPx, seamHoriz.cuts),
    surfaceIdRgba: stitchRowsVertical(idBands.top, idBands.bottom, fullW, tileSizePx, overlapPx, seamHoriz.cuts),
    roadElevRgba: stitchRowsVertical(roadBands.top, roadBands.bottom, fullW, tileSizePx, overlapPx, seamHoriz.cuts),
    seamChecks,
  };
}
