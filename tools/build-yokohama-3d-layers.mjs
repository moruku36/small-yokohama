import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";

const REPO_ROOT = path.resolve(import.meta.dirname, "..");
const RELEASE_DIR = path.join(REPO_ROOT, "viewer", "public", "releases", "full-yokohama-v1");
const BUILDINGS_PATH = path.join(REPO_ROOT, "data", "yokohama-osm-buildings.json");
const BUILDING_META_PATH = path.join(REPO_ROOT, "data", "yokohama-osm-building-meta.json");

const ID_OFFSET = 10000;
const DRAWN_HEIGHT_SCALE = 0.6;
const BASE_Z_M = 2.0;
const HAS_JA = /[\u3040-\u30ff\u3400-\u9fff\uff65-\uff9f]/;

const SURFACE_KIND = {
  VOID: 0,
  WATER: 1,
  GROUND: 2,
  ROAD: 3,
  BUILDING: 4,
  BRIDGE_DECK: 5,
  BRIDGE_SUPPORT: 6,
  QUAY: 7,
  VEGETATION: 8,
};

// ---------- Exact EPSG:6677 projection matching packages/core/src/epsg6677.ts ----------
const GRS80_A = 6378137.0;
const GRS80_F = 1.0 / 298.257222101;
const M0 = 0.9999;
const DEG_TO_RAD = Math.PI / 180.0;
const PHI0_RAD = 36.0 * DEG_TO_RAD;
const LAMBDA0_RAD = (139.0 + 50.0 / 60.0) * DEG_TO_RAD;

const N = GRS80_F / (2.0 - GRS80_F);
const N2 = N * N;
const N3 = N2 * N;
const N4 = N3 * N;
const N5 = N4 * N;

const A0 = 1.0 + N2 / 4.0 + N4 / 64.0;
const A1 = -1.5 * (N - N3 / 8.0 - N5 / 64.0);
const A2 = (15.0 / 16.0) * (N2 - N4 / 4.0);
const A3 = (-35.0 / 48.0) * (N3 - (5.0 / 16.0) * N5);
const A4 = (315.0 / 512.0) * N4;
const A5 = (-693.0 / 1280.0) * N5;

const A_BAR = ((M0 * GRS80_A) / (1.0 + N)) * A0;
const S_PHI0 =
  ((M0 * GRS80_A) / (1.0 + N)) *
  (A0 * PHI0_RAD +
    A1 * Math.sin(2.0 * PHI0_RAD) +
    A2 * Math.sin(4.0 * PHI0_RAD) +
    A3 * Math.sin(6.0 * PHI0_RAD) +
    A4 * Math.sin(8.0 * PHI0_RAD) +
    A5 * Math.sin(10.0 * PHI0_RAD));

const ALPHA = [
  0,
  0.5 * N - (2.0 / 3.0) * N2 + (5.0 / 16.0) * N3 + (41.0 / 180.0) * N4 - (127.0 / 288.0) * N5,
  (13.0 / 48.0) * N2 - (3.0 / 5.0) * N3 + (557.0 / 1440.0) * N4 + (281.0 / 630.0) * N5,
  (61.0 / 240.0) * N3 - (103.0 / 140.0) * N4 + (15061.0 / 26880.0) * N5,
  (49561.0 / 161280.0) * N4 - (179.0 / 168.0) * N5,
  (34729.0 / 80640.0) * N5,
];
const TWO_SQRT_N = (2.0 * Math.sqrt(N)) / (1.0 + N);

function wgs84ToLocal(cam, lon, lat, elevM = 0) {
  const phi = lat * DEG_TO_RAD;
  const dLambda = lon * DEG_TO_RAD - LAMBDA0_RAD;
  const sinPhi = Math.sin(phi);
  const t = Math.sinh(
    Math.atanh(sinPhi) - TWO_SQRT_N * Math.atanh(TWO_SQRT_N * sinPhi),
  );
  const tBar = Math.sqrt(1.0 + t * t);
  const xiPrime = Math.atan2(t, Math.cos(dLambda));
  const etaPrime = Math.atanh(Math.sin(dLambda) / tBar);
  let xi = xiPrime;
  let eta = etaPrime;
  for (let j = 1; j <= 5; j++) {
    const a = ALPHA[j];
    xi += a * Math.sin(2 * j * xiPrime) * Math.cosh(2 * j * etaPrime);
    eta += a * Math.cos(2 * j * xiPrime) * Math.sinh(2 * j * etaPrime);
  }
  const easting = A_BAR * eta;
  const northing = A_BAR * xi - S_PHI0;
  return [
    easting - cam.originEpsg6677.easting,
    northing - cam.originEpsg6677.northing,
    elevM,
  ];
}

function localToImage(cam, loc) {
  const dx = loc[0] - cam.cameraOriginLocalM[0];
  const dy = loc[1] - cam.cameraOriginLocalM[1];
  const dz = loc[2] - cam.cameraOriginLocalM[2];
  const cx = dx * cam.basis.right[0] + dy * cam.basis.right[1] + dz * cam.basis.right[2];
  const cy = dx * cam.basis.up[0] + dy * cam.basis.up[1] + dz * cam.basis.up[2];
  const depthM =
    dx * cam.basis.forward[0] + dy * cam.basis.forward[1] + dz * cam.basis.forward[2];
  return {
    px: cam.imageOriginPx.x + cx / cam.metersPerPixel,
    py: cam.imageOriginPx.y - cy / cam.metersPerPixel,
    depthM,
  };
}

function imageToLocalOnPlane(cam, px, py, elevationM) {
  const cx = (px - cam.imageOriginPx.x) * cam.metersPerPixel;
  const cy = (cam.imageOriginPx.y - py) * cam.metersPerPixel;
  const bx =
    cam.cameraOriginLocalM[0] + cam.basis.right[0] * cx + cam.basis.up[0] * cy;
  const by =
    cam.cameraOriginLocalM[1] + cam.basis.right[1] * cx + cam.basis.up[1] * cy;
  const bz =
    cam.cameraOriginLocalM[2] + cam.basis.right[2] * cx + cam.basis.up[2] * cy;
  const t = (elevationM - bz) / cam.basis.forward[2];
  return [
    bx + cam.basis.forward[0] * t,
    by + cam.basis.forward[1] * t,
    elevationM,
  ];
}

// ---------- PNG codec (matching tools/pilot-builder/src/png.ts) ----------
const PNG_SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  }
  return (c ^ 0xffffffff) >>> 0;
}

function makeChunk(type, data) {
  const len = data.length;
  const out = Buffer.allocUnsafe(12 + len);
  out.writeUInt32BE(len, 0);
  out.write(type, 4, 4, "ascii");
  Buffer.from(data.buffer, data.byteOffset, data.byteLength).copy(out, 8);
  out.writeUInt32BE(crc32(out.subarray(4, 8 + len)), 8 + len);
  return out;
}

function encodePngRgba(width, height, rgba) {
  const ihdr = Buffer.allocUnsafe(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;

  const stride = width * 4;
  const raw = Buffer.allocUnsafe(height * (1 + stride));
  for (let y = 0; y < height; y++) {
    const srcRow = y * stride;
    const dstRow = y * (1 + stride);
    raw[dstRow] = 1; // Filter type 1: Sub
    for (let x = 0; x < stride; x++) {
      const val = rgba[srcRow + x];
      const left = x >= 4 ? rgba[srcRow + x - 4] : 0;
      raw[dstRow + 1 + x] = (val - left) & 0xff;
    }
  }
  const compressed = zlib.deflateSync(raw, { level: 4 });
  return Buffer.concat([
    PNG_SIGNATURE,
    makeChunk("IHDR", ihdr),
    makeChunk("IDAT", compressed),
    makeChunk("IEND", Buffer.alloc(0)),
  ]);
}

function decodePngRgba(buf) {
  let offset = 8;
  let width = 0;
  let height = 0;
  let colorType = 6;
  const idatChunks = [];
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
      idatChunks.push(buf.subarray(dStart, dEnd));
    } else if (type === "IEND") {
      break;
    }
    offset = dEnd + 4;
  }

  const raw = zlib.inflateSync(Buffer.concat(idatChunks));
  const bpp = colorType === 6 ? 4 : 3;
  const srcStride = width * bpp;
  const dstStride = width * 4;
  const reconRow = new Uint8Array(srcStride);
  const prevRow = new Uint8Array(srcStride);
  const out = new Uint8Array(height * dstStride);

  for (let y = 0; y < height; y++) {
    const rowStart = y * (1 + srcStride);
    const filter = raw[rowStart];
    const outRow = y * dstStride;
    for (let x = 0; x < srcStride; x++) {
      const rawByte = raw[rowStart + 1 + x];
      const left = x >= bpp ? reconRow[x - bpp] : 0;
      const up = y > 0 ? prevRow[x] : 0;
      const upLeft = y > 0 && x >= bpp ? prevRow[x - bpp] : 0;
      let recon = rawByte;
      if (filter === 1) recon = (rawByte + left) & 0xff;
      else if (filter === 2) recon = (rawByte + up) & 0xff;
      else if (filter === 3) recon = (rawByte + ((left + up) >> 1)) & 0xff;
      else if (filter === 4) {
        const p = left + up - upLeft;
        const pa = Math.abs(p - left);
        const pb = Math.abs(p - up);
        const pc = Math.abs(p - upLeft);
        recon = (rawByte + (pa <= pb && pa <= pc ? left : pb <= pc ? up : upLeft)) & 0xff;
      }
      reconRow[x] = recon;
    }
    prevRow.set(reconRow);
    if (bpp === 4) {
      out.set(reconRow, outRow);
    } else {
      for (let px = 0; px < width; px++) {
        const s = px * 3;
        const d = outRow + px * 4;
        out[d] = reconRow[s];
        out[d + 1] = reconRow[s + 1];
        out[d + 2] = reconRow[s + 2];
        out[d + 3] = 255;
      }
    }
  }
  return { width, height, data: out };
}

// ---------- Geometry helpers ----------
function pointInRing(x, y, pts) {
  let inside = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const xi = pts[i][0];
    const yi = pts[i][1];
    const xj = pts[j][0];
    const yj = pts[j][1];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi + 1e-12) + xi) {
      inside = !inside;
    }
  }
  return inside;
}

function dedupeAndWindCcw(rawPts) {
  const pts = [];
  for (const p of rawPts) {
    const prev = pts[pts.length - 1];
    if (!prev || Math.hypot(p[0] - prev[0], p[1] - prev[1]) > 0.15) {
      pts.push(p);
    }
  }
  if (
    pts.length >= 2 &&
    Math.hypot(pts[0][0] - pts[pts.length - 1][0], pts[0][1] - pts[pts.length - 1][1]) <= 0.15
  ) {
    pts.pop();
  }
  if (pts.length < 3) return null;
  let area2 = 0;
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i];
    const q = pts[(i + 1) % pts.length];
    area2 += p[0] * q[1] - q[0] * p[1];
  }
  if (Math.abs(area2) < 0.2) return null;
  if (area2 < 0) pts.reverse();
  return pts;
}

function earClipTriangles(pts) {
  const n = pts.length;
  if (n === 3) return [[0, 1, 2]];
  if (n === 4) {
    const a = pts[0];
    const b = pts[1];
    const c = pts[2];
    const d = pts[3];
    const c1 = (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
    const c2 = (c[0] - a[0]) * (d[1] - a[1]) - (c[1] - a[1]) * (d[0] - a[0]);
    if (c1 > 0 && c2 > 0) return [[0, 1, 2], [0, 2, 3]];
    return [[1, 2, 3], [1, 3, 0]];
  }

  const tris = [];
  const idx = [];
  for (let i = 0; i < n; i++) idx.push(i);

  const cross2 = (a, b, c) =>
    (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
  const inTri = (p, a, b, c) =>
    cross2(a, b, p) >= -1e-6 && cross2(b, c, p) >= -1e-6 && cross2(c, a, p) >= -1e-6;

  let guard = 0;
  while (idx.length > 3 && guard < 2000) {
    guard++;
    let clipped = false;
    const len = idx.length;
    for (let i = 0; i < len; i++) {
      const i0 = idx[(i + len - 1) % len];
      const i1 = idx[i];
      const i2 = idx[(i + 1) % len];
      const a = pts[i0];
      const b = pts[i1];
      const c = pts[i2];
      if (cross2(a, b, c) <= 1e-6) continue;

      let hit = false;
      for (let j = 0; j < len; j++) {
        const ij = idx[j];
        if (ij === i0 || ij === i1 || ij === i2) continue;
        if (inTri(pts[ij], a, b, c)) {
          hit = true;
          break;
        }
      }
      if (!hit) {
        tris.push([i0, i1, i2]);
        idx.splice(i, 1);
        clipped = true;
        break;
      }
    }
    if (!clipped) break;
  }

  if (idx.length === 3) {
    tris.push([idx[0], idx[1], idx[2]]);
  } else if (idx.length > 3) {
    for (let i = 1; i + 1 < idx.length; i++) {
      tris.push([idx[0], idx[i], idx[i + 1]]);
    }
  }
  return tris;
}

function edgeFn(ax, ay, bx, by, cx, cy) {
  return (cx - ax) * (by - ay) - (cy - ay) * (bx - ax);
}

// ---------- Main builder ----------
function main() {
  const tStart = performance.now();
  const cam = JSON.parse(fs.readFileSync(path.join(RELEASE_DIR, "camera.json"), "utf8"));
  const release = JSON.parse(fs.readFileSync(path.join(RELEASE_DIR, "release.json"), "utf8"));
  const landmarksPayload = JSON.parse(
    fs.readFileSync(path.join(RELEASE_DIR, "landmarks.json"), "utf8"),
  );
  const bldData = JSON.parse(fs.readFileSync(BUILDINGS_PATH, "utf8"));
  const metaData = JSON.parse(fs.readFileSync(BUILDING_META_PATH, "utf8"));

  if (bldData.buildings.length !== metaData.records.length) {
    throw new Error(
      `Building count mismatch: buildings=${bldData.buildings.length}, meta=${metaData.records.length}`,
    );
  }

  const dScale = cam.dataTileGrid.scale ?? 0.5;
  const W = Math.floor(cam.imageWidthPx * dScale); // 7744
  const H = Math.floor(cam.imageHeightPx * dScale); // 2944
  const tileSizePx = cam.dataTileGrid.tileSizePx; // 1024
  const cols = cam.dataTileGrid.cols; // 8
  const rows = cam.dataTileGrid.rows; // 3
  const nearM = cam.nearM;
  const farM = cam.farM;
  const depthSpan = farM - nearM;

  // 1. Read existing 24 depth and surface-id tiles
  const nPix = W * H;
  const zBuf = new Float32Array(nPix);
  const kindBuf = new Uint8Array(nPix);
  const fidBuf = new Uint32Array(nPix);
  const origDepthRgba = new Uint8Array(nPix * 4);
  const origFidRgba = new Uint8Array(nPix * 4);

  for (let row = 0; row < rows; row++) {
    const y0 = row * tileSizePx;
    for (let col = 0; col < cols; col++) {
      const x0 = col * tileSizePx;
      const dPng = decodePngRgba(
        fs.readFileSync(path.join(RELEASE_DIR, "depth", `tile_${col}_${row}.png`)),
      );
      const sPng = decodePngRgba(
        fs.readFileSync(path.join(RELEASE_DIR, "surface-id", `tile_${col}_${row}.png`)),
      );
      for (let ly = 0; ly < dPng.height; ly++) {
        const gy = y0 + ly;
        for (let lx = 0; lx < dPng.width; lx++) {
          const gx = x0 + lx;
          const gi = gy * W + gx;
          const so = (ly * dPng.width + lx) * 4;
          const go = gi * 4;
          origDepthRgba[go] = dPng.data[so];
          origDepthRgba[go + 1] = dPng.data[so + 1];
          origDepthRgba[go + 2] = dPng.data[so + 2];
          origDepthRgba[go + 3] = 255;
          origFidRgba[go] = sPng.data[so];
          origFidRgba[go + 1] = sPng.data[so + 1];
          origFidRgba[go + 2] = sPng.data[so + 2];
          origFidRgba[go + 3] = 255;

          const q16 = (dPng.data[so] << 8) | dPng.data[so + 1];
          zBuf[gi] = nearM + (q16 / 65535) * depthSpan;
          kindBuf[gi] = dPng.data[so + 2];
          fidBuf[gi] = (sPng.data[so] << 16) | (sPng.data[so + 1] << 8) | sPng.data[so + 2];
        }
      }
    }
  }

  // 2. Exact affine plane depth evaluators on half-res (hx, hy)
  const makePlaneDepth = (elevM) => {
    const px0 = 0.5 / dScale;
    const py0 = 0.5 / dScale;
    const d00 = localToImage(cam, imageToLocalOnPlane(cam, px0, py0, elevM)).depthM;
    const dX = localToImage(cam, imageToLocalOnPlane(cam, px0 + 1000 / dScale, py0, elevM)).depthM;
    const dY = localToImage(cam, imageToLocalOnPlane(cam, px0, py0 + 1000 / dScale, elevM)).depthM;
    const ddDx = (dX - d00) / 1000;
    const ddDy = (dY - d00) / 1000;
    return { d00, ddDx, ddDy };
  };
  const gPlane = makePlaneDepth(BASE_Z_M);
  const wPlane = makePlaneDepth(0.0);

  // 3. Protect Shinko 3D pilot core & reset non-core pixels cleanly for idempotency
  const shinkoCoreMask = new Uint8Array(nPix);
  const shinkoSolidMask = new Uint8Array(nPix);
  for (let hy = 0; hy < H; hy++) {
    const inShinkoY = hy >= 960 && hy < 2944;
    const gRow = gPlane.d00 + hy * gPlane.ddDy;
    for (let hx = 0; hx < W; hx++) {
      const i = hy * W + hx;
      const inShinko = inShinkoY && hx >= 1920 && hx < 3904;
      const fid = fidBuf[i];
      const kind = kindBuf[i];
      if (inShinko && fid > 0 && fid < ID_OFFSET && kind !== SURFACE_KIND.GROUND) {
        shinkoCoreMask[i] = 1;
        if (
          kind === SURFACE_KIND.BUILDING ||
          kind === SURFACE_KIND.BRIDGE_DECK ||
          kind === SURFACE_KIND.BRIDGE_SUPPORT
        ) {
          shinkoSolidMask[i] = 1;
        }
      } else {
        zBuf[i] = gRow + hx * gPlane.ddDx;
        kindBuf[i] = SURFACE_KIND.GROUND;
        fidBuf[i] = inShinko && fid > 0 && fid < ID_OFFSET ? fid : 0;
      }
    }
  }

  // 4. Step A: Full-city paint-truth water mask from Level 13 DZI tiles
  const l13Dir = path.join(RELEASE_DIR, "illustrated_files", "13");
  const dziTileSize = 512;
  const dziOverlap = 1;
  const cols13 = Math.ceil(W / dziTileSize);
  const rows13 = Math.ceil(H / dziTileSize);
  const rgb13 = new Uint8Array(nPix * 3);
  for (let r = 0; r < rows13; r++) {
    const ys = Math.max(0, r * dziTileSize - dziOverlap);
    const yi0 = r * dziTileSize;
    const yi1 = Math.min(H, (r + 1) * dziTileSize);
    for (let c = 0; c < cols13; c++) {
      const xs = Math.max(0, c * dziTileSize - dziOverlap);
      const xi0 = c * dziTileSize;
      const xi1 = Math.min(W, (c + 1) * dziTileSize);
      const tile = decodePngRgba(fs.readFileSync(path.join(l13Dir, `${c}_${r}.png`)));
      const sl = xi0 - xs;
      const st = yi0 - ys;
      const cw = Math.min(xi1 - xi0, tile.width - sl);
      const ch = Math.min(yi1 - yi0, tile.height - st);
      for (let ly = 0; ly < ch; ly++) {
        const dstOff = ((yi0 + ly) * W + xi0) * 3;
        const srcOff = (st + ly) * tile.width + sl;
        for (let lx = 0; lx < cw; lx++) {
          const s = (srcOff + lx) * 4;
          const d = dstOff + lx * 3;
          rgb13[d] = tile.data[s];
          rgb13[d + 1] = tile.data[s + 1];
          rgb13[d + 2] = tile.data[s + 2];
        }
      }
    }
  }

  const candWater = new Uint8Array(nPix);
  for (let i = 0; i < nPix; i++) {
    if (shinkoCoreMask[i]) {
      if (kindBuf[i] === SURFACE_KIND.WATER) candWater[i] = 1;
      continue;
    }
    const o = i * 3;
    const r = rgb13[o];
    const g = rgb13[o + 1];
    const b = rgb13[o + 2];
    if (r < 95 && g > r + 28 && b > r + 40 && b > g + 3 && b < 170 && g < 148) {
      candWater[i] = 1;
    }
  }

  const visited = new Uint8Array(nPix);
  const queue = new Int32Array(nPix);
  let totalWaterPixels = 0;
  for (let i = 0; i < nPix; i++) {
    if (!candWater[i] || visited[i]) continue;
    let head = 0;
    let tail = 0;
    queue[tail++] = i;
    visited[i] = 1;
    let touchesShinkoWater = false;
    let touchesBorder = false;

    while (head < tail) {
      const cur = queue[head++];
      if (shinkoCoreMask[cur] && kindBuf[cur] === SURFACE_KIND.WATER) {
        touchesShinkoWater = true;
      }
      const x = cur % W;
      const y = (cur - x) / W;
      if (x === 0 || x === W - 1 || y === 0 || y === H - 1) touchesBorder = true;
      if (x > 0) {
        const nb = cur - 1;
        if (candWater[nb] && !visited[nb]) {
          visited[nb] = 1;
          queue[tail++] = nb;
        }
      }
      if (x + 1 < W) {
        const nb = cur + 1;
        if (candWater[nb] && !visited[nb]) {
          visited[nb] = 1;
          queue[tail++] = nb;
        }
      }
      if (y > 0) {
        const nb = cur - W;
        if (candWater[nb] && !visited[nb]) {
          visited[nb] = 1;
          queue[tail++] = nb;
        }
      }
      if (y + 1 < H) {
        const nb = cur + W;
        if (candWater[nb] && !visited[nb]) {
          visited[nb] = 1;
          queue[tail++] = nb;
        }
      }
    }

    const keep =
      touchesShinkoWater || tail >= 2000 || (touchesBorder && tail >= 300);
    if (!keep) continue;

    for (let k = 0; k < tail; k++) {
      const idx = queue[k];
      if (!shinkoCoreMask[idx]) {
        const hx = idx % W;
        const hy = (idx - hx) / W;
        zBuf[idx] = wPlane.d00 + hx * wPlane.ddDx + hy * wPlane.ddDy;
        kindBuf[idx] = SURFACE_KIND.WATER;
        fidBuf[idx] = 1;
      }
      totalWaterPixels++;
    }
  }

  // 5. Convert building rings to local EPSG:6677 meters & build spatial grid
  const [lon0, lat0] = bldData.origin;
  const count = bldData.buildings.length;
  const cellM = 50;
  const spatialGrid = new Map();
  const parsedBuildings = new Array(count);

  for (let idx = 0; idx < count; idx++) {
    const raw = bldData.buildings[idx];
    const realHeightM = raw[0];
    const rawPts = [];
    for (let k = 1; k + 1 < raw.length; k += 2) {
      const loc = wgs84ToLocal(cam, lon0 + raw[k] / 1e6, lat0 + raw[k + 1] / 1e6, 0);
      rawPts.push([loc[0], loc[1]]);
    }
    const pts = dedupeAndWindCcw(rawPts);
    if (!pts) {
      parsedBuildings[idx] = null;
      continue;
    }
    let minX = Infinity;
    let maxX = -Infinity;
    let minY = Infinity;
    let maxY = -Infinity;
    let area2 = 0;
    let sx = 0;
    let sy = 0;
    for (let i = 0; i < pts.length; i++) {
      const a = pts[i];
      const b = pts[(i + 1) % pts.length];
      if (a[0] < minX) minX = a[0];
      if (a[0] > maxX) maxX = a[0];
      if (a[1] < minY) minY = a[1];
      if (a[1] > maxY) maxY = a[1];
      area2 += a[0] * b[1] - b[0] * a[1];
      sx += a[0];
      sy += a[1];
    }
    const areaM2 = Math.abs(area2) * 0.5;
    const cx = sx / pts.length;
    const cy = sy / pts.length;
    const entry = { idx, realHeightM, pts, minX, maxX, minY, maxY, cx, cy, areaM2 };
    parsedBuildings[idx] = entry;

    for (let gy = Math.floor(minY / cellM); gy <= Math.floor(maxY / cellM); gy++) {
      for (let gx = Math.floor(minX / cellM); gx <= Math.floor(maxX / cellM); gx++) {
        const key = `${gx}:${gy}`;
        let bucket = spatialGrid.get(key);
        if (!bucket) spatialGrid.set(key, (bucket = []));
        bucket.push(entry);
      }
    }
  }

  // 6. Step B: Cross-match OSM buildings to curated landmarks & POIs
  const landmarkByBld = new Array(count).fill("");
  const poiByBld = new Array(count).fill("");

  const findBestBuildingAt = (lon, lat, elevM, maxCentroidDistM) => {
    const loc = wgs84ToLocal(cam, lon, lat, elevM);
    const lx = loc[0];
    const ly = loc[1];
    const gx = Math.floor(lx / cellM);
    const gy = Math.floor(ly / cellM);
    const seen = new Set();
    let insideBest = null;
    let insideMinArea = Infinity;
    let nearBest = null;
    let nearBestDist = maxCentroidDistM;

    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        const bucket = spatialGrid.get(`${gx + dx}:${gy + dy}`);
        if (!bucket) continue;
        for (const b of bucket) {
          if (seen.has(b.idx)) continue;
          seen.add(b.idx);
          if (lx >= b.minX && lx <= b.maxX && ly >= b.minY && ly <= b.maxY && pointInRing(lx, ly, b.pts)) {
            if (b.areaM2 < insideMinArea) {
              insideMinArea = b.areaM2;
              insideBest = b;
            }
          } else {
            const dist = Math.hypot(lx - b.cx, ly - b.cy);
            if (dist < nearBestDist) {
              nearBestDist = dist;
              nearBest = b;
            }
          }
        }
      }
    }
    return insideBest ?? nearBest;
  };

  let matchedLandmarks = 0;
  for (const lm of landmarksPayload.landmarks ?? []) {
    if (lm.featureId > 6 || lm.category === "park") continue;
    const hit = findBestBuildingAt(lm.lon, lm.lat, 0, lm.category === "pier" ? 10 : 18);
    if (hit && !landmarkByBld[hit.idx]) {
      landmarkByBld[hit.idx] = lm.id;
      matchedLandmarks++;
    }
  }

  const NON_BUILDING_POI_CATS = new Set(["park", "river", "street", "water", "viewpoint"]);
  let matchedPois = 0;
  for (const poi of landmarksPayload.pois ?? []) {
    if (NON_BUILDING_POI_CATS.has(poi.category)) continue;
    const hit = findBestBuildingAt(poi.lon, poi.lat, 0, 12);
    if (hit && !poiByBld[hit.idx]) {
      poiByBld[hit.idx] = poi.id;
      matchedPois++;
    }
  }

  // 7. Step C: 3D Extrusion & Z-buffer rasterization for all OSM buildings
  const fVec = cam.basis.forward;
  const renderedPixels = new Uint32Array(count);

  const rasterizeTri = (v0, v1, v2, fid, bIdx) => {
    const p0 = localToImage(cam, v0);
    const p1 = localToImage(cam, v1);
    const p2 = localToImage(cam, v2);
    const x0 = p0.px * dScale;
    const y0 = p0.py * dScale;
    const x1 = p1.px * dScale;
    const y1 = p1.py * dScale;
    const x2 = p2.px * dScale;
    const y2 = p2.py * dScale;

    const minX = Math.max(0, Math.floor(Math.min(x0, x1, x2)));
    const maxX = Math.min(W - 1, Math.ceil(Math.max(x0, x1, x2)));
    const minY = Math.max(0, Math.floor(Math.min(y0, y1, y2)));
    const maxY = Math.min(H - 1, Math.ceil(Math.max(y0, y1, y2)));
    if (minX > maxX || minY > maxY) return;

    let area = edgeFn(x0, y0, x1, y1, x2, y2);
    if (Math.abs(area) < 1e-6) return;
    const sign = area > 0 ? 1 : -1;
    area = Math.abs(area);
    const invArea = 1 / area;

    for (let hy = minY; hy <= maxY; hy++) {
      const sy = hy + 0.5;
      const rowOff = hy * W;
      for (let hx = minX; hx <= maxX; hx++) {
        const sx = hx + 0.5;
        const w0 = sign * edgeFn(x1, y1, x2, y2, sx, sy);
        if (w0 < -1e-4) continue;
        const w1 = sign * edgeFn(x2, y2, x0, y0, sx, sy);
        if (w1 < -1e-4) continue;
        const w2 = sign * edgeFn(x0, y0, x1, y1, sx, sy);
        if (w2 < -1e-4) continue;

        const o = rowOff + hx;
        if (shinkoSolidMask[o]) continue;
        const depthM = (w0 * p0.depthM + w1 * p1.depthM + w2 * p2.depthM) * invArea;
        if (depthM < zBuf[o]) {
          zBuf[o] = depthM;
          kindBuf[o] = SURFACE_KIND.BUILDING;
          fidBuf[o] = fid;
          renderedPixels[bIdx]++;
        }
      }
    }
  };

  let skippedShinko = 0;
  for (let idx = 0; idx < count; idx++) {
    const b = parsedBuildings[idx];
    if (!b) continue;
    const pts = b.pts;

    // Shinko overlap guard: protect Shinko hand-built 3D geometry & 8 GCPs
    const cImg = localToImage(cam, [b.cx, b.cy, BASE_Z_M]);
    const chx = Math.floor(cImg.px * dScale);
    const chy = Math.floor(cImg.py * dScale);
    let nearShinko = chx >= 1880 && chx < 3944 && chy >= 920 && chy < 2944;
    if (!nearShinko) {
      for (let i = 0; i < pts.length; i++) {
        const pImg = localToImage(cam, [pts[i][0], pts[i][1], BASE_Z_M]);
        const phx = pImg.px * dScale;
        const phy = pImg.py * dScale;
        if (phx >= 1920 && phx < 3904 && phy >= 960 && phy < 2944) {
          nearShinko = true;
          break;
        }
      }
    }
    if (nearShinko) {
      let sampleTotal = 0;
      let solidHits = 0;
      const checkSample = (wx, wy) => {
        const img = localToImage(cam, [wx, wy, BASE_Z_M]);
        const hx = Math.floor(img.px * dScale);
        const hy = Math.floor(img.py * dScale);
        if (hx < 0 || hx >= W || hy < 0 || hy >= H) return;
        sampleTotal++;
        if (shinkoSolidMask[hy * W + hx]) solidHits++;
      };
      checkSample(b.cx, b.cy);
      for (let i = 0; i < pts.length; i++) {
        const a = pts[i];
        const c = pts[(i + 1) % pts.length];
        checkSample(a[0], a[1]);
        checkSample((a[0] + c[0]) * 0.5, (a[1] + c[1]) * 0.5);
      }
      if (sampleTotal > 0 && solidHits / sampleTotal >= 0.3) {
        skippedShinko++;
        continue;
      }
    }

    const drawnH = Math.max(3.0, Math.min(b.realHeightM, b.realHeightM * DRAWN_HEIGHT_SCALE));
    const topZ = BASE_Z_M + drawnH;
    const fid = ID_OFFSET + idx;

    // Roof triangulation
    const roofTris = earClipTriangles(pts);
    for (const [i0, i1, i2] of roofTris) {
      rasterizeTri(
        [pts[i0][0], pts[i0][1], topZ],
        [pts[i1][0], pts[i1][1], topZ],
        [pts[i2][0], pts[i2][1], topZ],
        fid,
        idx,
      );
    }

    // Front-facing extruded side walls
    for (let i = 0; i < pts.length; i++) {
      const a = pts[i];
      const c = pts[(i + 1) % pts.length];
      const dx = c[0] - a[0];
      const dy = c[1] - a[1];
      if (dy * fVec[0] - dx * fVec[1] < 0) {
        const b0 = [a[0], a[1], BASE_Z_M];
        const b1 = [c[0], c[1], BASE_Z_M];
        const t1 = [c[0], c[1], topZ];
        const t0 = [a[0], a[1], topZ];
        rasterizeTri(b0, b1, t1, fid, idx);
        rasterizeTri(b0, t1, t0, fid, idx);
      }
    }
  }

  // 8. Encode & write updated 24 depth and surface-id PNG tiles
  let totalDepthBytes = 0;
  let totalIdBytes = 0;
  let totalBldgPixels = 0;
  let voidPixels = 0;
  const tilesWithBuildings = new Set();

  for (let row = 0; row < rows; row++) {
    const y0 = row * tileSizePx;
    const th = Math.min(tileSizePx, H - y0);
    for (let col = 0; col < cols; col++) {
      const x0 = col * tileSizePx;
      const tw = Math.min(tileSizePx, W - x0);
      const dTile = new Uint8Array(tw * th * 4);
      const sTile = new Uint8Array(tw * th * 4);
      let hasBldg = false;

      for (let ly = 0; ly < th; ly++) {
        const gy = y0 + ly;
        for (let lx = 0; lx < tw; lx++) {
          const gx = x0 + lx;
          const gi = gy * W + gx;
          const to = (ly * tw + lx) * 4;
          const go = gi * 4;
          const kind = kindBuf[gi];
          if (kind === SURFACE_KIND.VOID) voidPixels++;
          if (kind === SURFACE_KIND.BUILDING) {
            totalBldgPixels++;
            hasBldg = true;
          }

          if (shinkoCoreMask[gi]) {
            dTile[to] = origDepthRgba[go];
            dTile[to + 1] = origDepthRgba[go + 1];
            dTile[to + 2] = origDepthRgba[go + 2];
            dTile[to + 3] = 255;
            sTile[to] = origFidRgba[go];
            sTile[to + 1] = origFidRgba[go + 1];
            sTile[to + 2] = origFidRgba[go + 2];
            sTile[to + 3] = 255;
          } else {
            const norm = Math.min(1, Math.max(0, (zBuf[gi] - nearM) / depthSpan));
            const q16 = Math.round(norm * 65535);
            dTile[to] = (q16 >> 8) & 0xff;
            dTile[to + 1] = q16 & 0xff;
            dTile[to + 2] = kind & 0xff;
            dTile[to + 3] = 255;

            const fid = fidBuf[gi];
            sTile[to] = (fid >> 16) & 0xff;
            sTile[to + 1] = (fid >> 8) & 0xff;
            sTile[to + 2] = fid & 0xff;
            sTile[to + 3] = 255;
          }
        }
      }
      if (hasBldg) tilesWithBuildings.add(`${col}_${row}`);
      const dPng = encodePngRgba(tw, th, dTile);
      const sPng = encodePngRgba(tw, th, sTile);
      fs.writeFileSync(path.join(RELEASE_DIR, "depth", `tile_${col}_${row}.png`), dPng);
      fs.writeFileSync(path.join(RELEASE_DIR, "surface-id", `tile_${col}_${row}.png`), sPng);
      totalDepthBytes += dPng.byteLength;
      totalIdBytes += sPng.byteLength;
    }
  }

  // 9. Build compact release buildings.json and update release.json
  const outRecords = new Array(count);
  for (let idx = 0; idx < count; idx++) {
    const rec = [...metaData.records[idx]];
    while (rec.length < 12) rec.push("");
    if (rec[8] && HAS_JA.test(String(rec[8]))) {
      rec[8] = "";
    }
    rec[12] = landmarkByBld[idx] || "";
    rec[13] = poiByBld[idx] || "";
    while (rec.length > 7 && rec[rec.length - 1] === "") {
      rec.pop();
    }
    outRecords[idx] = rec;
  }

  const buildingsBundle = {
    schemaVersion: "1.0.0",
    idOffset: ID_OFFSET,
    origin: metaData.origin,
    count,
    types: metaData.types,
    records: outRecords,
  };
  const buildingsJsonPath = path.join(RELEASE_DIR, "buildings.json");
  fs.writeFileSync(buildingsJsonPath, JSON.stringify(buildingsBundle));
  const buildingsKb = Math.round(fs.statSync(buildingsJsonPath).size / 1024);

  release.buildingsPath = "buildings.json";
  fs.writeFileSync(path.join(RELEASE_DIR, "release.json"), JSON.stringify(release, null, 2));

  // 10. Built-in QA checks
  if (voidPixels > 0) {
    throw new Error(`QA FAILED: voidPixels=${voidPixels}`);
  }
  const gcps = landmarksPayload.gcps ?? [];
  let maxGcpDisp = 0;
  for (const gcp of gcps) {
    const pt = localToImage(cam, wgs84ToLocal(cam, gcp.lon, gcp.lat, gcp.elevationM));
    const ehx = Math.round(pt.px * dScale);
    const ehy = Math.round(pt.py * dScale);
    let best = Infinity;
    for (let dy = -8; dy <= 8; dy++) {
      const hy = ehy + dy;
      if (hy < 0 || hy >= H) continue;
      for (let dx = -8; dx <= 8; dx++) {
        const hx = ehx + dx;
        if (hx < 0 || hx >= W) continue;
        if (fidBuf[hy * W + hx] === gcp.featureId) {
          const dist = Math.hypot((hx + 0.5) / dScale - pt.px, (hy + 0.5) / dScale - pt.py);
          if (dist < best) best = dist;
        }
      }
    }
    if (best > 8.0) {
      throw new Error(`QA FAILED: GCP ${gcp.id} displacement ${best.toFixed(2)}px > 8px`);
    }
    if (best > maxGcpDisp) maxGcpDisp = best;
  }

  const probe = (label, lon, lat, elevM, expectKind, minFid = 1) => {
    const img = localToImage(cam, wgs84ToLocal(cam, lon, lat, elevM));
    const hx = Math.min(W - 1, Math.max(0, Math.floor(img.px * dScale)));
    const hy = Math.min(H - 1, Math.max(0, Math.floor(img.py * dScale)));
    const o = hy * W + hx;
    const k = kindBuf[o];
    const f = fidBuf[o];
    console.log(
      `[3d-layers] probe ${label}: kind=${k} fid=${f} depth=${zBuf[o].toFixed(1)}m`,
    );
    if (k !== expectKind || f < minFid) {
      throw new Error(
        `QA probe failed for ${label}: expected kind=${expectKind} fid>=${minFid}, got kind=${k} fid=${f}`,
      );
    }
  };

  probe("Landmark Tower", 139.6316, 35.4549, 150, SURFACE_KIND.BUILDING, ID_OFFSET);
  probe("Yokohama Sogo", 139.6249, 35.4653, 25, SURFACE_KIND.BUILDING, ID_OFFSET);
  probe("Yokohama Stadium", 139.6401, 35.4435, 18, SURFACE_KIND.BUILDING, ID_OFFSET);
  probe("Marine Tower", 139.650902, 35.443934, 40, SURFACE_KIND.BUILDING, ID_OFFSET);
  probe("Yamashita Bay", 139.653, 35.448, 0, SURFACE_KIND.WATER, 1);
  probe("Minato Mirai Canal", 139.6335, 35.4530, 0, SURFACE_KIND.WATER, 1);

  const elapsedSec = ((performance.now() - tStart) / 1000).toFixed(2);
  console.log(
    `[3d-layers] DONE in ${elapsedSec}s | activeBuildingTiles=${tilesWithBuildings.size}/24 | bldgPixels=${totalBldgPixels} | waterPixels=${totalWaterPixels} | skippedShinko=${skippedShinko} | maxGcpDisp=${maxGcpDisp.toFixed(3)}px | matchedLandmarks=${matchedLandmarks} matchedPois=${matchedPois} | buildings.json=${buildingsKb}KB | depth=${(totalDepthBytes / 1048576).toFixed(2)}MB surfaceId=${(totalIdBytes / 1048576).toFixed(2)}MB`,
  );
}

main();
