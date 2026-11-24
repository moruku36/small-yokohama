import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { DataTileGridSpec, DziSpec } from "@small-yokohama/core";
import { encodePngRgba } from "./png.js";

function downsample2xRgba(
  src: Uint8Array,
  w: number,
  h: number,
): { width: number; height: number; data: Uint8Array } {
  const nw = Math.max(1, Math.ceil(w / 2));
  const nh = Math.max(1, Math.ceil(h / 2));
  const dst = new Uint8Array(nw * nh * 4);

  for (let y = 0; y < nh; y++) {
    const sy0 = Math.min(h - 1, y * 2);
    const sy1 = Math.min(h - 1, sy0 + 1);
    for (let x = 0; x < nw; x++) {
      const sx0 = Math.min(w - 1, x * 2);
      const sx1 = Math.min(w - 1, sx0 + 1);
      const i00 = (sy0 * w + sx0) * 4;
      const i10 = (sy0 * w + sx1) * 4;
      const i01 = (sy1 * w + sx0) * 4;
      const i11 = (sy1 * w + sx1) * 4;
      const o = (y * nw + x) * 4;
      for (let c = 0; c < 4; c++) {
        dst[o + c] = (src[i00 + c]! + src[i10 + c]! + src[i01 + c]! + src[i11 + c]! + 2) >> 2;
      }
    }
  }

  return { width: nw, height: nh, data: dst };
}

function cropRgba(
  src: Uint8Array,
  srcW: number,
  x0: number,
  y0: number,
  cropW: number,
  cropH: number,
): Uint8Array {
  const out = new Uint8Array(cropW * cropH * 4);
  const rowBytes = cropW * 4;
  for (let y = 0; y < cropH; y++) {
    const s = ((y0 + y) * srcW + x0) * 4;
    out.set(src.subarray(s, s + rowBytes), y * rowBytes);
  }
  return out;
}

/**
 * Write an OpenSeadragon-compatible Deep Zoom Image (DZI) pyramid.
 * Returns total bytes written across the .dzi XML and all PNG tiles.
 */
export function writeDziPyramid(
  outputDir: string,
  name: string,
  fullWidth: number,
  fullHeight: number,
  fullRgba: Uint8Array,
  dzi: DziSpec,
): number {
  mkdirSync(outputDir, { recursive: true });
  const dziPath = join(outputDir, `${name}.dzi`);
  const filesRoot = join(outputDir, `${name}_files`);
  mkdirSync(filesRoot, { recursive: true });

  const dziXml = [
    `<?xml version="1.0" encoding="UTF-8"?>`,
    `<Image xmlns="http://schemas.microsoft.com/deepzoom/2008"`,
    `  Format="${dzi.format}"`,
    `  Overlap="${dzi.overlap}"`,
    `  TileSize="${dzi.tileSize}">`,
    `  <Size Width="${fullWidth}" Height="${fullHeight}"/>`,
    `</Image>`,
    "",
  ].join("\n");
  writeFileSync(dziPath, dziXml, "utf8");
  let totalBytes = Buffer.byteLength(dziXml, "utf8");

  const maxLevel = Math.ceil(Math.log2(Math.max(fullWidth, fullHeight)));
  const levels: Array<{ level: number; width: number; height: number; data: Uint8Array }> = [];

  let curW = fullWidth;
  let curH = fullHeight;
  let curData = fullRgba;
  for (let level = maxLevel; level >= 0; level--) {
    levels.push({ level, width: curW, height: curH, data: curData });
    if (level > 0) {
      const next = downsample2xRgba(curData, curW, curH);
      curW = next.width;
      curH = next.height;
      curData = next.data;
    }
  }

  for (const { level, width, height, data } of levels) {
    const levelDir = join(filesRoot, String(level));
    mkdirSync(levelDir, { recursive: true });
    const cols = Math.ceil(width / dzi.tileSize);
    const rows = Math.ceil(height / dzi.tileSize);

    for (let row = 0; row < rows; row++) {
      const yStart = Math.max(0, row * dzi.tileSize - dzi.overlap);
      const yEnd = Math.min(height, (row + 1) * dzi.tileSize + dzi.overlap);
      const th = yEnd - yStart;
      for (let col = 0; col < cols; col++) {
        const xStart = Math.max(0, col * dzi.tileSize - dzi.overlap);
        const xEnd = Math.min(width, (col + 1) * dzi.tileSize + dzi.overlap);
        const tw = xEnd - xStart;
        const tileBuf = cropRgba(data, width, xStart, yStart, tw, th);
        const png = encodePngRgba(tw, th, tileBuf);
        writeFileSync(join(levelDir, `${col}_${row}.${dzi.format}`), png);
        totalBytes += png.byteLength;
      }
    }
  }

  return totalBytes;
}

export function writeDownsampledPreviewPng(
  outPath: string,
  fullWidth: number,
  fullHeight: number,
  fullRgba: Uint8Array,
  targetSize = 1024,
): number {
  let w = fullWidth;
  let h = fullHeight;
  let data = fullRgba;
  while (w > targetSize || h > targetSize) {
    const next = downsample2xRgba(data, w, h);
    w = next.width;
    h = next.height;
    data = next.data;
  }
  const png = encodePngRgba(w, h, data);
  writeFileSync(outPath, png);
  return png.byteLength;
}

/**
 * Write lossless non-interpolated 2x2 data tiles (depth, featureId, roadElevation).
 */
export function writeLosslessDataTiles(
  outputDir: string,
  prefix: string,
  fullWidth: number,
  fullHeight: number,
  fullRgba: Uint8Array,
  grid: DataTileGridSpec,
): number {
  mkdirSync(outputDir, { recursive: true });
  let totalBytes = 0;

  for (let row = 0; row < grid.rows; row++) {
    const y0 = row * grid.tileSizePx;
    const h = Math.min(grid.tileSizePx, fullHeight - y0);
    for (let col = 0; col < grid.cols; col++) {
      const x0 = col * grid.tileSizePx;
      const w = Math.min(grid.tileSizePx, fullWidth - x0);
      const tileData = cropRgba(fullRgba, fullWidth, x0, y0, w, h);
      const png = encodePngRgba(w, h, tileData);
      const name = prefix ? `${prefix}_tile_${col}_${row}.png` : `tile_${col}_${row}.png`;
      writeFileSync(join(outputDir, name), png);
      totalBytes += png.byteLength;
    }
  }

  return totalBytes;
}
