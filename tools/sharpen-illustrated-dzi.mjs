import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";

const FILES_ROOT = path.resolve(
  "viewer/public/releases/full-yokohama-v1/illustrated_files",
);
const FULL_W = 15488;
const FULL_H = 5888;
const LEVEL13_W = Math.ceil(FULL_W / 2); // 7744
const LEVEL13_H = Math.ceil(FULL_H / 2); // 2944
const TILE_SIZE = 512;
const OVERLAP = 1;

const PNG_SIG = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function makeChunk(type, data) {
  const out = Buffer.allocUnsafe(12 + data.length);
  out.writeUInt32BE(data.length, 0);
  out.write(type, 4, 4, "ascii");
  Buffer.from(data.buffer, data.byteOffset, data.byteLength).copy(out, 8);
  out.writeUInt32BE(crc32(out.subarray(4, 8 + data.length)), 8 + data.length);
  return out;
}

function decodePngRgb(buf) {
  let offset = 8;
  let width = 0;
  let height = 0;
  let colorType = 6;
  const idat = [];
  while (offset + 8 <= buf.length) {
    const len = buf.readUInt32BE(offset);
    const type = buf.toString("ascii", offset + 4, offset + 8);
    const dStart = offset + 8;
    const dEnd = dStart + len;
    if (type === "IHDR") {
      width = buf.readUInt32BE(dStart);
      height = buf.readUInt32BE(dStart + 4);
      colorType = buf[dStart + 9];
    } else if (type === "IDAT") {
      idat.push(buf.subarray(dStart, dEnd));
    } else if (type === "IEND") {
      break;
    }
    offset = dEnd + 4;
  }
  const bpp = colorType === 2 ? 3 : 4;
  const raw = zlib.inflateSync(Buffer.concat(idat));
  const stride = width * bpp;
  const reconRow = new Uint8Array(stride);
  const prevRow = new Uint8Array(stride);
  const rgb = new Uint8Array(width * height * 3);

  for (let y = 0; y < height; y++) {
    const rs = y * (1 + stride);
    const ft = raw[rs];
    for (let x = 0; x < stride; x++) {
      const val = raw[rs + 1 + x];
      const a = x >= bpp ? reconRow[x - bpp] : 0;
      const b = y > 0 ? prevRow[x] : 0;
      const c = y > 0 && x >= bpp ? prevRow[x - bpp] : 0;
      let r = val;
      if (ft === 1) r = (val + a) & 0xff;
      else if (ft === 2) r = (val + b) & 0xff;
      else if (ft === 3) r = (val + ((a + b) >> 1)) & 0xff;
      else if (ft === 4) {
        const p = a + b - c;
        const pa = Math.abs(p - a);
        const pb = Math.abs(p - b);
        const pc = Math.abs(p - c);
        r = (val + (pa <= pb && pa <= pc ? a : pb <= pc ? b : c)) & 0xff;
      }
      reconRow[x] = r;
    }
    prevRow.set(reconRow);
    const dstOff = y * width * 3;
    for (let x = 0; x < width; x++) {
      const s = x * bpp;
      const d = dstOff + x * 3;
      rgb[d] = reconRow[s];
      rgb[d + 1] = reconRow[s + 1];
      rgb[d + 2] = reconRow[s + 2];
    }
  }
  return { width, height, rgb };
}

function encodePngRgbAsRgba(width, height, rgb, x0, y0, fullW) {
  const stride = width * 4;
  const raw = Buffer.allocUnsafe(height * (1 + stride));
  for (let y = 0; y < height; y++) {
    const dstRow = y * (1 + stride);
    const srcRow = (y0 + y) * fullW * 3 + x0 * 3;
    raw[dstRow] = 1; // Filter Sub
    let prevR = 0;
    let prevG = 0;
    let prevB = 0;
    let prevA = 0;
    for (let x = 0; x < width; x++) {
      const s = srcRow + x * 3;
      const d = dstRow + 1 + x * 4;
      const r = rgb[s];
      const g = rgb[s + 1];
      const b = rgb[s + 2];
      raw[d] = (r - prevR) & 0xff;
      raw[d + 1] = (g - prevG) & 0xff;
      raw[d + 2] = (b - prevB) & 0xff;
      raw[d + 3] = (255 - prevA) & 0xff;
      prevR = r;
      prevG = g;
      prevB = b;
      prevA = 255;
    }
  }
  const ihdr = Buffer.allocUnsafe(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;
  const compressed = zlib.deflateSync(raw, { level: 5 });
  return Buffer.concat([
    PNG_SIG,
    makeChunk("IHDR", ihdr),
    makeChunk("IDAT", compressed),
    makeChunk("IEND", Buffer.alloc(0)),
  ]);
}

function clampByte(v) {
  return v <= 0 ? 0 : v >= 255 ? 255 : Math.round(v);
}

function catmullRomWeights(t) {
  // Catmull-Rom cubic kernel (a = -0.5) evaluated at offsets -1, 0, +1, +2
  const t2 = t * t;
  const t3 = t2 * t;
  return [
    -0.5 * t + t2 - 0.5 * t3,
    1.0 - 2.5 * t2 + 1.5 * t3,
    0.5 * t + 2.0 * t2 - 1.5 * t3,
    -0.5 * t2 + 0.5 * t3,
  ];
}

function upscale2xCatmullRomRgb(src, srcW, srcH, dstW, dstH) {
  // 2x grid: even dst pixels (2*sx + 0) sample fractional offset -0.25 from center (Wait: (d+0.5)*0.5 - 0.5 = d*0.5 - 0.25)
  // Using symmetric Catmull-Rom weights at t = 0.75 (for even dst) and t = 0.25 (for odd dst):
  // Standard pixel-center mapping: u = (x + 0.5) * (srcW / dstW) - 0.5
  const temp = new Float32Array(dstW * srcH * 3);
  for (let y = 0; y < srcH; y++) {
    const sRow = y * srcW * 3;
    const dRow = y * dstW * 3;
    for (let x = 0; x < dstW; x++) {
      const u = (x + 0.5) * 0.5 - 0.5;
      const iu = Math.floor(u);
      const t = u - iu;
      const [w0, w1, w2, w3] = catmullRomWeights(t);
      const i0 = Math.max(0, Math.min(srcW - 1, iu - 1)) * 3 + sRow;
      const i1 = Math.max(0, Math.min(srcW - 1, iu)) * 3 + sRow;
      const i2 = Math.max(0, Math.min(srcW - 1, iu + 1)) * 3 + sRow;
      const i3 = Math.max(0, Math.min(srcW - 1, iu + 2)) * 3 + sRow;
      const d = dRow + x * 3;
      temp[d] = src[i0] * w0 + src[i1] * w1 + src[i2] * w2 + src[i3] * w3;
      temp[d + 1] = src[i0 + 1] * w0 + src[i1 + 1] * w1 + src[i2 + 1] * w2 + src[i3 + 1] * w3;
      temp[d + 2] = src[i0 + 2] * w0 + src[i1 + 2] * w1 + src[i2 + 2] * w2 + src[i3 + 2] * w3;
    }
  }

  const out = new Uint8Array(dstW * dstH * 3);
  for (let y = 0; y < dstH; y++) {
    const v = (y + 0.5) * 0.5 - 0.5;
    const iv = Math.floor(v);
    const t = v - iv;
    const [w0, w1, w2, w3] = catmullRomWeights(t);
    const r0 = Math.max(0, Math.min(srcH - 1, iv - 1)) * dstW * 3;
    const r1 = Math.max(0, Math.min(srcH - 1, iv)) * dstW * 3;
    const r2 = Math.max(0, Math.min(srcH - 1, iv + 1)) * dstW * 3;
    const r3 = Math.max(0, Math.min(srcH - 1, iv + 2)) * dstW * 3;
    const dRow = y * dstW * 3;
    for (let x = 0; x < dstW * 3; x++) {
      const val =
        temp[r0 + x] * w0 + temp[r1 + x] * w1 + temp[r2 + x] * w2 + temp[r3 + x] * w3;
      out[dRow + x] = clampByte(val);
    }
  }
  return out;
}

/**
 * Edge-directed luminance Ligne-Claire sharpening:
 * Sharpens architectural ink contours cleanly while leaving flat fills & water untouched,
 * and clamps output luminance within local 3x3 bounds (+tolerance) to guarantee zero ringing/halos.
 */
function sharpenLuminanceLigneClaire(rgb, w, h, { usmGain, shockGain, maxDelta, haloTol }) {
  const n = w * h;
  const lum = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const o = i * 3;
    lum[i] = 0.299 * rgb[o] + 0.587 * rgb[o + 1] + 0.114 * rgb[o + 2];
  }

  const out = new Uint8Array(rgb);
  for (let y = 1; y < h - 1; y++) {
    const rPrev = (y - 1) * w;
    const rCurr = y * w;
    const rNext = (y + 1) * w;
    for (let x = 1; x < w - 1; x++) {
      const idx = rCurr + x;
      const y00 = lum[rPrev + x - 1];
      const y10 = lum[rPrev + x];
      const y20 = lum[rPrev + x + 1];
      const y01 = lum[rCurr + x - 1];
      const y11 = lum[idx];
      const y21 = lum[rCurr + x + 1];
      const y02 = lum[rNext + x - 1];
      const y12 = lum[rNext + x];
      const y22 = lum[rNext + x + 1];

      const gx = -y00 + y20 - 2 * y01 + 2 * y21 - y02 + y22;
      const gy = -y00 - 2 * y10 - y20 + y02 + 2 * y12 + y22;
      const grad = Math.hypot(gx, gy);
      const edgeW = Math.min(1, Math.max(0, (grad - 18) / 48));
      if (edgeW <= 0) continue;

      const minY = Math.min(y00, y10, y20, y01, y11, y21, y02, y12, y22);
      const maxY = Math.max(y00, y10, y20, y01, y11, y21, y02, y12, y22);
      const avgY =
        (y00 + y10 + y20 + y01 + y11 + y21 + y02 + y12 + y22) * (1 / 9);

      const usm = (y11 - avgY) * usmGain;
      const shock =
        (y11 < (minY + maxY) * 0.5 ? minY - y11 : maxY - y11) * shockGain;
      let delta = (usm + shock) * edgeW;
      if (delta > maxDelta) delta = maxDelta;
      else if (delta < -maxDelta) delta = -maxDelta;

      const targetY = Math.min(maxY + haloTol, Math.max(minY - haloTol, y11 + delta));
      const applied = targetY - y11;
      const o = idx * 3;
      out[o] = clampByte(rgb[o] + applied);
      out[o + 1] = clampByte(rgb[o + 1] + applied);
      out[o + 2] = clampByte(rgb[o + 2] + applied);
    }
  }
  return out;
}

function downsample2xBoxRgb(src, w, h) {
  const nw = Math.max(1, Math.ceil(w / 2));
  const nh = Math.max(1, Math.ceil(h / 2));
  const dst = new Uint8Array(nw * nh * 3);
  for (let y = 0; y < nh; y++) {
    const sy0 = Math.min(h - 1, y * 2);
    const sy1 = Math.min(h - 1, sy0 + 1);
    for (let x = 0; x < nw; x++) {
      const sx0 = Math.min(w - 1, x * 2);
      const sx1 = Math.min(w - 1, sx0 + 1);
      const i00 = (sy0 * w + sx0) * 3;
      const i10 = (sy0 * w + sx1) * 3;
      const i01 = (sy1 * w + sx0) * 3;
      const i11 = (sy1 * w + sx1) * 3;
      const o = (y * nw + x) * 3;
      dst[o] = (src[i00] + src[i10] + src[i01] + src[i11] + 2) >> 2;
      dst[o + 1] = (src[i00 + 1] + src[i10 + 1] + src[i01 + 1] + src[i11 + 1] + 2) >> 2;
      dst[o + 2] = (src[i00 + 2] + src[i10 + 2] + src[i01 + 2] + src[i11 + 2] + 2) >> 2;
    }
  }
  return { width: nw, height: nh, rgb: dst };
}

function writeLevelTiles(level, width, height, rgb) {
  const dir = path.join(FILES_ROOT, String(level));
  fs.mkdirSync(dir, { recursive: true });
  const cols = Math.ceil(width / TILE_SIZE);
  const rows = Math.ceil(height / TILE_SIZE);
  let count = 0;
  for (let row = 0; row < rows; row++) {
    const yStart = Math.max(0, row * TILE_SIZE - OVERLAP);
    const yEnd = Math.min(height, (row + 1) * TILE_SIZE + OVERLAP);
    const th = yEnd - yStart;
    for (let col = 0; col < cols; col++) {
      const xStart = Math.max(0, col * TILE_SIZE - OVERLAP);
      const xEnd = Math.min(width, (col + 1) * TILE_SIZE + OVERLAP);
      const tw = xEnd - xStart;
      const png = encodePngRgbAsRgba(tw, th, rgb, xStart, yStart, width);
      fs.writeFileSync(path.join(dir, `${col}_${row}.png`), png);
      count++;
    }
  }
  return count;
}

function main() {
  const t0 = performance.now();
  // 1. Reconstruct native 7744 x 2944 canvas from Level 13 DZI tiles
  const cols13 = Math.ceil(LEVEL13_W / TILE_SIZE); // 16
  const rows13 = Math.ceil(LEVEL13_H / TILE_SIZE); // 6
  const level13Canvas = new Uint8Array(LEVEL13_W * LEVEL13_H * 3);
  const dir13 = path.join(FILES_ROOT, "13");

  for (let row = 0; row < rows13; row++) {
    const yStart = Math.max(0, row * TILE_SIZE - OVERLAP);
    const yInterior0 = row * TILE_SIZE;
    const yInterior1 = Math.min(LEVEL13_H, (row + 1) * TILE_SIZE);
    for (let col = 0; col < cols13; col++) {
      const xStart = Math.max(0, col * TILE_SIZE - OVERLAP);
      const xInterior0 = col * TILE_SIZE;
      const xInterior1 = Math.min(LEVEL13_W, (col + 1) * TILE_SIZE);
      const { width: tw, height: th, rgb } = decodePngRgb(
        fs.readFileSync(path.join(dir13, `${col}_${row}.png`)),
      );
      const skipLeft = xInterior0 - xStart;
      const skipTop = yInterior0 - yStart;
      const copyW = Math.min(xInterior1 - xInterior0, tw - skipLeft);
      const copyH = Math.min(yInterior1 - yInterior0, th - skipTop);
      for (let ly = 0; ly < copyH; ly++) {
        const srcOff = ((skipTop + ly) * tw + skipLeft) * 3;
        const dstOff = ((yInterior0 + ly) * LEVEL13_W + xInterior0) * 3;
        level13Canvas.set(rgb.subarray(srcOff, srcOff + copyW * 3), dstOff);
      }
    }
  }
  console.log(
    `[sharpen-dzi] Reconstructed level 13 (${LEVEL13_W}x${LEVEL13_H}) in ${(performance.now() - t0).toFixed(0)} ms`,
  );

  // 2. Upscale 7744x2944 -> 15488x5888 with separable Catmull-Rom bicubic
  const tUp = performance.now();
  const up14 = upscale2xCatmullRomRgb(level13Canvas, LEVEL13_W, LEVEL13_H, FULL_W, FULL_H);
  console.log(
    `[sharpen-dzi] Catmull-Rom 2x upscale (${FULL_W}x${FULL_H}) in ${(performance.now() - tUp).toFixed(0)} ms`,
  );

  // 3. Apply edge-directed Ligne-Claire sharpening to Level 14
  const tSh = performance.now();
  const sharp14 = sharpenLuminanceLigneClaire(up14, FULL_W, FULL_H, {
    usmGain: 0.55,
    shockGain: 0.22,
    maxDelta: 38,
    haloTol: 6,
  });
  console.log(
    `[sharpen-dzi] Edge-directed Level 14 sharpening in ${(performance.now() - tSh).toFixed(0)} ms`,
  );

  const count14 = writeLevelTiles(14, FULL_W, FULL_H, sharp14);
  console.log(`[sharpen-dzi] Wrote Level 14: ${count14} tiles`);

  // 4. Gently sharpen Level 13 and rebuild Levels 12..0 by 2x2 box downsampling
  const sharp13 = sharpenLuminanceLigneClaire(level13Canvas, LEVEL13_W, LEVEL13_H, {
    usmGain: 0.20,
    shockGain: 0.0,
    maxDelta: 22,
    haloTol: 3,
  });
  let totalTiles = count14 + writeLevelTiles(13, LEVEL13_W, LEVEL13_H, sharp13);

  let cur = { width: LEVEL13_W, height: LEVEL13_H, rgb: sharp13 };
  for (let level = 12; level >= 0; level--) {
    cur = downsample2xBoxRgb(cur.rgb, cur.width, cur.height);
    totalTiles += writeLevelTiles(level, cur.width, cur.height, cur.rgb);
  }
  console.log(
    `[sharpen-dzi] Complete! Wrote ${totalTiles} PNG tiles across levels 0..14 in ${(performance.now() - t0).toFixed(0)} ms`,
  );
}

main();
