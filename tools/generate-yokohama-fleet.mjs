import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";

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

function wgs84ToImage(cam, lon, lat, elevM = 0) {
  const loc = wgs84ToLocal(cam, lon, lat, elevM);
  const dx = loc[0] - cam.cameraOriginLocalM[0];
  const dy = loc[1] - cam.cameraOriginLocalM[1];
  const dz = loc[2] - cam.cameraOriginLocalM[2];
  const cx = dx * cam.basis.right[0] + dy * cam.basis.right[1] + dz * cam.basis.right[2];
  const cy = dx * cam.basis.up[0] + dy * cam.basis.up[1] + dz * cam.basis.up[2];
  return {
    px: cam.imageOriginPx.x + cx / cam.metersPerPixel,
    py: cam.imageOriginPx.y - cy / cam.metersPerPixel,
  };
}

// ---------- Minimal pure-Node PNG RGBA decoder for water verification ----------
function decodePngRgba(buf) {
  let offset = 8;
  let width = 0;
  let height = 0;
  const idatChunks = [];
  while (offset < buf.length) {
    const len = buf.readUInt32BE(offset);
    const type = buf.toString("ascii", offset + 4, offset + 8);
    const data = buf.subarray(offset + 8, offset + 8 + len);
    if (type === "IHDR") {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      const colorType = data[9];
      if (colorType !== 6 && colorType !== 2) {
        throw new Error(`Unsupported PNG colorType=${colorType}`);
      }
      buf._colorType = colorType;
    } else if (type === "IDAT") {
      idatChunks.push(data);
    } else if (type === "IEND") {
      break;
    }
    offset += 12 + len;
  }
  const bpp = buf._colorType === 2 ? 3 : 4;
  const raw = zlib.inflateSync(Buffer.concat(idatChunks));
  const stride = width * bpp;
  const out = new Uint8Array(width * height * bpp);
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)];
    const rowStart = y * (stride + 1) + 1;
    const outRow = y * stride;
    const prevRow = (y - 1) * stride;
    for (let x = 0; x < stride; x++) {
      const val = raw[rowStart + x];
      const a = x >= bpp ? out[outRow + x - bpp] : 0;
      const b = y > 0 ? out[prevRow + x] : 0;
      const c = y > 0 && x >= bpp ? out[prevRow + x - bpp] : 0;
      let recon = val;
      if (filter === 1) recon = (val + a) & 0xff;
      else if (filter === 2) recon = (val + b) & 0xff;
      else if (filter === 3) recon = (val + Math.floor((a + b) / 2)) & 0xff;
      else if (filter === 4) {
        const p = a + b - c;
        const pa = Math.abs(p - a);
        const pb = Math.abs(p - b);
        const pc = Math.abs(p - c);
        const pr = pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
        recon = (val + pr) & 0xff;
      }
      out[outRow + x] = recon;
    }
  }
  return { width, height, bpp, data: out };
}

function isWaterPixel(png, previewX, previewY) {
  const ix = Math.round(previewX);
  const iy = Math.round(previewY);
  if (ix < 4 || iy < 4 || ix >= png.width - 4 || iy >= png.height - 4) {
    return { ok: false, rgb: [0, 0, 0] };
  }
  const check = (x, y) => {
    const o = (y * png.width + x) * png.bpp;
    const r = png.data[o];
    const g = png.data[o + 1];
    const b = png.data[o + 2];
    return { isBlue: b > r + 24 && g > r + 10 && r < 98, rgb: [r, g, b] };
  };
  const center = check(ix, iy);
  if (center.isBlue) return { ok: true, rgb: center.rgb };
  for (let dy = -1; dy <= 1; dy++) {
    for (let dx = -1; dx <= 1; dx++) {
      const nb = check(ix + dx, iy + dy);
      if (nb.isBlue) return { ok: true, rgb: nb.rgb };
    }
  }
  return { ok: false, rgb: center.rgb };
}

function headingBetween(cam, a, b) {
  const la = wgs84ToLocal(cam, a[0], a[1], 0);
  const lb = wgs84ToLocal(cam, b[0], b[1], 0);
  const deg = (Math.atan2(lb[0] - la[0], lb[1] - la[1]) * 180) / Math.PI;
  return ((deg % 360) + 360) % 360;
}

function distMeters(cam, a, b) {
  const la = wgs84ToLocal(cam, a[0], a[1], 0);
  const lb = wgs84ToLocal(cam, b[0], b[1], 0);
  return Math.hypot(lb[0] - la[0], lb[1] - la[1]);
}

function lerpBearing(a, b, t) {
  const diff = ((((b - a) % 360) + 540) % 360) - 180;
  return (((a + diff * t) % 360) + 360) % 360;
}

function sampleLoop(kfs, timeSec, dur) {
  const w = ((timeSec % dur) + dur) % dur;
  for (let i = 0; i < kfs.length - 1; i++) {
    const a = kfs[i];
    const b = kfs[i + 1];
    if (w >= a.timeSec && w <= b.timeSec) {
      const span = b.timeSec - a.timeSec || 1;
      const t = (w - a.timeSec) / span;
      return {
        lon: a.lon + (b.lon - a.lon) * t,
        lat: a.lat + (b.lat - a.lat) * t,
        bearingDeg: lerpBearing(a.bearingDeg, b.bearingDeg, t),
      };
    }
  }
  return kfs[kfs.length - 1];
}

/**
 * Build a seamless closed loop of keyframes starting at `phaseFraction` (0..1).
 * If `coords[last] !== coords[0]`, automatically closes back via return points!
 */
function buildClosedLoopKeyframes(cam, rawCoords, speedMps, phaseFraction, extra = {}) {
  const coords = [...rawCoords];
  const first = coords[0];
  const last = coords[coords.length - 1];
  if (distMeters(cam, first, last) > 4) {
    // Out-and-back smoothly reversed so vehicles turn smoothly along streets / harbor loops
    for (let i = rawCoords.length - 2; i >= 0; i--) {
      coords.push(rawCoords[i]);
    }
  }

  const segTimes = [0];
  let totalTime = 0;
  for (let i = 0; i < coords.length - 1; i++) {
    const d = distMeters(cam, coords[i], coords[i + 1]);
    totalTime += Math.max(0.8, d / speedMps);
    segTimes.push(totalTime);
  }

  const baseKfs = coords.map((pt, idx) => {
    const nextPt = coords[(idx + 1) % (coords.length - 1)] || coords[0];
    const prevPt = coords[idx > 0 ? idx - 1 : coords.length - 2];
    const b =
      idx < coords.length - 1
        ? headingBetween(cam, pt, nextPt)
        : headingBetween(cam, prevPt, pt);
    return {
      timeSec: Number(segTimes[idx].toFixed(2)),
      lon: pt[0],
      lat: pt[1],
      bearingDeg: Number(b.toFixed(2)),
      ...extra,
    };
  });

  // Shift phase by sampling the closed track at phaseOffset and rebuilding monotone [0..dur] keyframes
  const dur = baseKfs[baseKfs.length - 1].timeSec;
  const shift = ((phaseFraction % 1) + 1) % 1 * dur;
  const startSample = sampleLoop(baseKfs, shift, dur);
  const shifted = [{ timeSec: 0, ...startSample, ...extra }];
  for (let i = 0; i < baseKfs.length - 1; i++) {
    if (baseKfs[i].timeSec > shift + 0.05) {
      shifted.push({
        ...baseKfs[i],
        timeSec: Number((baseKfs[i].timeSec - shift).toFixed(2)),
      });
    }
  }
  for (let i = 0; i < baseKfs.length - 1; i++) {
    if (baseKfs[i].timeSec < shift - 0.05) {
      shifted.push({
        ...baseKfs[i],
        timeSec: Number((baseKfs[i].timeSec + dur - shift).toFixed(2)),
      });
    }
  }
  shifted.push({
    timeSec: Number(dur.toFixed(2)),
    lon: startSample.lon,
    lat: startSample.lat,
    bearingDeg: startSample.bearingDeg,
    ...extra,
  });
  // Keep bearingDeg tidy
  for (const k of shifted) {
    k.bearingDeg = Number(k.bearingDeg.toFixed(2));
  }
  return shifted;
}

const HAS_JA = (s) => /[\u3040-\u30ff\u3400-\u9fff]/.test(s || "");

function main() {
  const rootDir = process.cwd();
  const releaseDir = path.join(rootDir, "viewer", "public", "releases", "full-yokohama-v1");
  const cam = JSON.parse(fs.readFileSync(path.join(releaseDir, "camera.json"), "utf8"));
  const synPath = path.join(releaseDir, "fixtures", "synthetic-bayside-blue.json");
  const schedPath = path.join(releaseDir, "fixtures", "scheduled-bayside-blue.json");
  const previewPng = decodePngRgba(
    fs.readFileSync(path.join(rootDir, "docs", "images", "full-yokohama-23tiles-preview.png")),
  );
  const scaleToPreview = previewPng.width / cam.imageWidthPx;

  const existingSyn = JSON.parse(fs.readFileSync(synPath, "utf8"));
  const existingBb01 = existingSyn.vehicles[0];
  const existingBb01Kfs = existingSyn.keyframes["syn-bayside-blue-01"];
  if (!existingBb01 || !existingBb01Kfs || existingBb01Kfs.length !== 9) {
    throw new Error("Expected preserved syn-bayside-blue-01 baseline keyframes");
  }

  // Real OSM waterfront road corridors from data/shinko-osm.json
  const BAYSIDE_SPINE = [
    [139.6246, 35.4650], // Yokohama Sta. East Gate
    [139.6272, 35.4612], // Nissan HQ / Takashima
    [139.63319, 35.46296], // Rinko Kansen N (OSM 78995787)
    [139.63538, 35.45823], // Pacifico N (OSM 220878903)
    [139.63650, 35.45684], // Kokusai Bridge (OSM 25831182)
    [139.63820, 35.45537], // Kokusai-Odori (OSM 36114181)
    [139.64060, 35.45401], // Circle Walk (OSM 328071941)
    [139.64166, 35.45299], // Shinko SE (OSM 220878905)
    [139.64207, 35.45187], // Red Brick W (OSM 220880600)
    [139.64259, 35.44875], // Kaigan-dori (OSM 25997895)
    [139.6458, 35.4468], // Yamashita Park W
    [139.6512, 35.4439], // Yamashita Pier entrance
    [139.6458, 35.4468],
    [139.64250, 35.44858],
    [139.64193, 35.45185],
    [139.64039, 35.45376], // Return NB under Circle Walk
    [139.63793, 35.45505],
    [139.63698, 35.45581],
    [139.63624, 35.45670],
    [139.63308, 35.46299], // Rinko Kansen NB (OSM 724084571)
    [139.6272, 35.4612],
    [139.6246, 35.4650],
  ];

  const AKAI_KUTSU_LOOP = [
    [139.63522, 35.44653], // Bashamichi South (OSM 26642983)
    [139.63724, 35.44966], // Bankokubashi-dori (OSM 25944245)
    [139.63800, 35.45074],
    [139.63902, 35.45188], // Bankokubashi Bridge (OSM 25944234)
    [139.64039, 35.45376], // Circle Walk
    [139.64120, 35.45469], // Hammerhead Entrance (OSM 26642985)
    [139.6422, 35.4556], // Hammerhead Terminal loop
    [139.64120, 35.45469],
    [139.64166, 35.45299],
    [139.64264, 35.45244], // Red Brick Warehouse #2 rear
    [139.64342, 35.45194], // Red Brick Plaza
    [139.64259, 35.44875], // Kaigan-dori
    [139.64475, 35.44774], // Osanbashi-dori (OSM 26467439)
    [139.64623, 35.44982], // Osanbashi Pier Gate
    [139.64475, 35.44774],
    [139.6498, 35.4449], // Yamashita Park
    [139.6458, 35.4430], // Chinatown North Gate
    [139.6401, 35.4450], // Yokohama Stadium N
    [139.63583, 35.44585], // Kannai-Odori
    [139.63522, 35.44653],
  ];

  const PIER_LINE_LOOP = [
    [139.6312, 35.4510], // Sakuragicho Station
    [139.63296, 35.45520], // Sakura-dori (OSM 832563178)
    [139.63635, 35.45703], // Pacifico / Exhibition Hall
    [139.63820, 35.45537],
    [139.64060, 35.45401], // Circle Walk
    [139.64166, 35.45299],
    [139.64207, 35.45187],
    [139.63902, 35.45188], // Bankokubashi
    [139.63800, 35.45074],
    [139.63644, 35.45013], // Honcho (OSM 283907965)
    [139.63365, 35.45164], // Minato Mirai Blvd (OSM 283907976)
    [139.6312, 35.4510],
  ];

  const CITY_26_CORRIDOR = [
    [139.6244, 35.4654], // Yokohama Sta.
    [139.6275, 35.4608],
    [139.6316, 35.4549], // Landmark Tower
    [139.63364, 35.45149], // Minato Mirai Blvd (OSM 222974798)
    [139.63644, 35.45013], // Honcho (OSM 26642978)
    [139.63939, 35.44854], // Honcho East (OSM 220880592)
    [139.64250, 35.44858], // Kaigan-dori
    [139.6458, 35.4468],
    [139.6502, 35.4442], // Yamashita Park
  ];

  const CITY_8_58_CORRIDOR = [
    [139.6314, 35.4508], // Sakuragicho
    [139.63498, 35.44974], // Honcho W (OSM 26642978)
    [139.63836, 35.44909], // Kannai-Odori / Bashamichi (OSM 180205027)
    [139.63591, 35.44580], // Kannai Sta. (OSM 180205027)
    [139.6401, 35.4436], // Yokohama Stadium
    [139.6458, 35.4432], // Chinatown
    [139.6502, 35.4418], // Motomachi
    [139.6458, 35.4468], // Yamashita Park
    [139.64250, 35.44858], // Kaigan-dori
    [139.63810, 35.45069], // Bankokubashi S (OSM 25997869)
    [139.63498, 35.44974],
    [139.6314, 35.4508],
  ];

  const busSpecs = [
    // 5 additional Bayside Blue articulated buses (total 6 with syn-bayside-blue-01)
    ...[0.08, 0.28, 0.48, 0.68, 0.88].map((phase, idx) => ({
      entityId: `syn-bb-${String(idx + 2).padStart(2, "0")}`,
      routeId: "bayside-blue",
      routeLabelJa: "ベイサイドブルー",
      routeLabelEn: "Bayside Blue",
      dirJa: idx % 2 === 0 ? "山下ふ頭ゆき" : "横浜駅前ゆき",
      dirEn: idx % 2 === 0 ? "To Yamashita Pier" : "To Yokohama Station",
      articulated: true,
      lengthM: 18,
      widthM: 2.5,
      heightM: 3.3,
      speedMps: 9.2,
      coords: BAYSIDE_SPINE,
      phase,
      noteJa: "ベイサイドブルー連節バス運行中",
      noteEn: "Articulated Bayside Blue waterfront corridor",
    })),
    // 6 Akai Kutsu retro sightseeing buses
    ...[0.04, 0.21, 0.37, 0.54, 0.71, 0.87].map((phase, idx) => ({
      entityId: `syn-akaikutsu-${String(idx + 1).padStart(2, "0")}`,
      routeId: "akai-kutsu",
      routeLabelJa: "あかいくつ",
      routeLabelEn: "Akai Kutsu",
      dirJa: "みなとみらい・赤レンガ・中華街循環",
      dirEn: "Red Brick / Osanbashi / Chinatown Loop",
      articulated: false,
      lengthM: 9.5,
      widthM: 2.3,
      heightM: 3.0,
      speedMps: 7.4,
      coords: AKAI_KUTSU_LOOP,
      phase,
      noteJa: "観光周遊バス「あかいくつ」周回中",
      noteEn: "Retro sightseeing loop via Red Brick & Chinatown",
    })),
    // 5 Pier Line buses
    ...[0.1, 0.3, 0.5, 0.7, 0.9].map((phase, idx) => ({
      entityId: `syn-pierline-${String(idx + 1).padStart(2, "0")}`,
      routeId: "pier-line",
      routeLabelJa: "ピアライン",
      routeLabelEn: "Pier Line",
      dirJa: "桜木町駅前 ↔ ハンマーヘッド・赤レンガ",
      dirEn: "Sakuragicho Sta. <-> Hammerhead & Red Brick",
      articulated: false,
      lengthM: 11.5,
      widthM: 2.45,
      heightM: 3.1,
      speedMps: 7.8,
      coords: PIER_LINE_LOOP,
      phase,
      noteJa: "新港・桜木町シャトル「ピアライン」運行中",
      noteEn: "Shinko Waterfront shuttle serving Sakuragicho & Red Brick",
    })),
    // 5 Municipal City Buses (26, 8, 58)
    ...[
      { id: "syn-city26-01", routeId: "city-bus-26", labelJa: "市営バス 26系統", labelEn: "City Bus #26", coords: CITY_26_CORRIDOR, phase: 0.14 },
      { id: "syn-city26-02", routeId: "city-bus-26", labelJa: "市営バス 26系統", labelEn: "City Bus #26", coords: CITY_26_CORRIDOR, phase: 0.64 },
      { id: "syn-city8-01", routeId: "city-bus-8", labelJa: "市営バス 8系統", labelEn: "City Bus #8", coords: CITY_8_58_CORRIDOR, phase: 0.18 },
      { id: "syn-city8-02", routeId: "city-bus-8", labelJa: "市営バス 8系統", labelEn: "City Bus #8", coords: CITY_8_58_CORRIDOR, phase: 0.52 },
      { id: "syn-city58-01", routeId: "city-bus-58", labelJa: "市営バス 58系統", labelEn: "City Bus #58", coords: CITY_8_58_CORRIDOR, phase: 0.82 },
    ].map((c) => ({
      entityId: c.id,
      routeId: c.routeId,
      routeLabelJa: c.labelJa,
      routeLabelEn: c.labelEn,
      dirJa: "横浜都心臨海ルート",
      dirEn: "Central Yokohama Waterfront Loop",
      articulated: false,
      lengthM: 11.0,
      widthM: 2.45,
      heightM: 3.1,
      speedMps: 8.2,
      coords: c.coords,
      phase: c.phase,
      noteJa: "横浜市営バス 本町通り・関内大通り走行中",
      noteEn: "Yokohama Municipal Bus along Honcho & Kannai avenues",
    })),
  ];

  // Verified open-water harbor routes in Yokohama Bay
  const HARBOR_OUTER_CRUISE = [
    [139.6545, 35.4480],
    [139.6535, 35.4518],
    [139.6512, 35.4548],
    [139.6485, 35.4568],
    [139.6462, 35.4585],
    [139.6485, 35.4568],
    [139.6512, 35.4548],
    [139.6535, 35.4518],
    [139.6545, 35.4480],
  ];

  const SEABASS_MAIN_CORRIDOR = [
    [139.6532, 35.4468], // Yamashita Park offshore
    [139.6516, 35.4502], // Yamashita - Osanbashi basin
    [139.6514, 35.4536], // Off Osanbashi tip
    [139.6486, 35.4552], // Off Red Brick Warehouse outer
    [139.6476, 35.4578], // Off Hammerhead Pier 9 outer
    [139.6454, 35.4596], // Shinko North harbor
    [139.6432, 35.4614], // Pacifico Pukari off
    [139.6406, 35.4634], // Takashima / Bay Quarter channel
    [139.6432, 35.4614],
    [139.6454, 35.4596],
    [139.6476, 35.4578],
    [139.6486, 35.4552],
    [139.6514, 35.4536],
    [139.6516, 35.4502],
    [139.6532, 35.4468],
  ];

  const SHINKO_BASIN_LOOP = [
    [139.6472, 35.4522], // Off Red Brick South / Zou-no-Hana basin
    [139.6478, 35.4545], // Off Red Brick E
    [139.6464, 35.4568], // Off Hammerhead
    [139.6495, 35.4560], // Outer basin
    [139.6508, 35.4535], // Off Osanbashi tip
    [139.6496, 35.4502], // Between Osanbashi & Yamashita
    [139.6518, 35.4472], // Off Yamashita Park
    [139.6538, 35.4495], // East basin
    [139.6518, 35.4538],
    [139.6486, 35.4542],
    [139.6472, 35.4522],
  ];

  const TUG_HARBOR_LOOP = [
    [139.6472, 35.4526],
    [139.6486, 35.4545],
    [139.6514, 35.4536],
    [139.6528, 35.4508],
    [139.6520, 35.4478],
    [139.6502, 35.4506],
    [139.6514, 35.4534],
    [139.6486, 35.4545],
    [139.6472, 35.4526],
  ];

  const portCallsRaw = [
    {
      id: "portcall-shinko-berth9",
      vesselNameJa: "飛鳥Ⅱ",
      vesselNameEn: "Asuka II",
      berthJa: "新港ふ頭9号岸壁（ハンマーヘッド）",
      berthEn: "Shinko Pier Berth 9 (Hammerhead)",
      vesselKind: "cruise",
      lengthM: 88,
      widthM: 15,
      heightM: 18,
      bearingDeg: 34,
      speedKnots: 0,
      moving: false,
      lon: 139.641613,
      lat: 35.456954,
      arrivalTime: "2026-11-24T09:00:00+09:00",
      departureTime: "2026-11-24T17:00:00+09:00",
      mode: "scheduled",
      source: "Yokohama Port Scheduled Calls",
    },
    {
      id: "portcall-diamond-princess",
      vesselNameJa: "ダイヤモンド・プリンセス",
      vesselNameEn: "Diamond Princess",
      berthJa: "大さん橋沖（入港航路）",
      berthEn: "Yokohama Harbor Approach (Osanbashi)",
      vesselKind: "cruise",
      lengthM: 94,
      widthM: 16,
      heightM: 20,
      speedKnots: 5.5,
      moving: true,
      coords: HARBOR_OUTER_CRUISE,
      speedMps: 2.8,
      phase: 0.12,
      arrivalTime: "2026-11-24T10:30:00+09:00",
      departureTime: "2026-11-24T19:00:00+09:00",
    },
    {
      id: "portcall-nippon-maru",
      vesselNameJa: "にっぽん丸",
      vesselNameEn: "Nippon Maru",
      berthJa: "山下沖〜横浜港中央航路",
      berthEn: "Outer Yokohama Harbor off Yamashita",
      vesselKind: "cruise",
      lengthM: 76,
      widthM: 13.5,
      heightM: 16,
      speedKnots: 6.2,
      moving: true,
      coords: HARBOR_OUTER_CRUISE,
      speedMps: 3.1,
      phase: 0.62,
      arrivalTime: "2026-11-24T11:15:00+09:00",
      departureTime: "2026-11-24T18:30:00+09:00",
    },
    // 3 Harbor Cruisers
    {
      id: "boat-marine-rouge",
      vesselNameJa: "マリンルージュ",
      vesselNameEn: "Marine Rouge",
      berthJa: "山下公園 ↔ 赤レンガ倉庫・みなとみらい航路",
      berthEn: "Yamashita Park <-> Red Brick Harbor Cruise",
      vesselKind: "cruiser",
      lengthM: 44,
      widthM: 9.5,
      heightM: 9,
      speedKnots: 9.5,
      moving: true,
      coords: SHINKO_BASIN_LOOP,
      speedMps: 4.8,
      phase: 0.1,
      arrivalTime: "2026-11-24T10:00:00+09:00",
      departureTime: "2026-11-24T20:00:00+09:00",
    },
    {
      id: "boat-marine-shuttle",
      vesselNameJa: "マリンシャトル",
      vesselNameEn: "Marine Shuttle",
      berthJa: "みなとみらい ↔ 山下・大さん橋周遊",
      berthEn: "Minato Mirai & Osanbashi Sightseeing",
      vesselKind: "cruiser",
      lengthM: 40,
      widthM: 9.0,
      heightM: 8.5,
      speedKnots: 9.0,
      moving: true,
      coords: SHINKO_BASIN_LOOP,
      speedMps: 4.5,
      phase: 0.56,
      arrivalTime: "2026-11-24T10:30:00+09:00",
      departureTime: "2026-11-24T19:30:00+09:00",
    },
    {
      id: "boat-royal-wing",
      vesselNameJa: "ロイヤルウイング",
      vesselNameEn: "Royal Wing",
      berthJa: "大さん橋 ↔ 横浜ベイブリッジ沖ディナー航路",
      berthEn: "Osanbashi Bay Dining Cruise",
      vesselKind: "cruiser",
      lengthM: 48,
      widthM: 10.0,
      heightM: 10,
      speedKnots: 8.4,
      moving: true,
      coords: HARBOR_OUTER_CRUISE,
      speedMps: 4.2,
      phase: 0.36,
      arrivalTime: "2026-11-24T12:00:00+09:00",
      departureTime: "2026-11-24T21:30:00+09:00",
    },
    // 4 Sea Bass Water Buses
    ...[
      { id: "boat-seabass-zero", ja: "シーバス ZERO", en: "Sea Bass Zero", phase: 0.04 },
      { id: "boat-seabass-ace", ja: "シーバス ACE", en: "Sea Bass Ace", phase: 0.29 },
      { id: "boat-seabass-3", ja: "シーバス 3号", en: "Sea Bass 3", phase: 0.54 },
      { id: "boat-seabass-5", ja: "シーバス 5号", en: "Sea Bass 5", phase: 0.79 },
    ].map((sb) => ({
      id: sb.id,
      vesselNameJa: sb.ja,
      vesselNameEn: sb.en,
      berthJa: "横浜駅東口 ↔ ハンマーヘッド ↔ 山下公園",
      berthEn: "Yokohama Bay Quarter <-> Hammerhead <-> Yamashita",
      vesselKind: "waterbus",
      lengthM: 25,
      widthM: 6.4,
      heightM: 5.0,
      speedKnots: 12.5,
      moving: true,
      coords: SEABASS_MAIN_CORRIDOR,
      speedMps: 6.4,
      phase: sb.phase,
      arrivalTime: "2026-11-24T09:00:00+09:00",
      departureTime: "2026-11-24T20:30:00+09:00",
    })),
    // 4 Harbor Tugboats & Launches
    ...[
      { id: "boat-yokohama-maru", ja: "よこはま丸", en: "Yokohama Maru", phase: 0.14 },
      { id: "boat-kamome", ja: "かもめ", en: "Kamome", phase: 0.39 },
      { id: "boat-minato-1", ja: "みなと1号", en: "Minato No. 1", phase: 0.64 },
      { id: "boat-bay-breeze", ja: "ベイブリーズ", en: "Bay Breeze", phase: 0.89 },
    ].map((tb) => ({
      id: tb.id,
      vesselNameJa: tb.ja,
      vesselNameEn: tb.en,
      berthJa: "新港・大さん橋・山下 港湾作業域",
      berthEn: "Shinko, Osanbashi & Yamashita Harbor Basin",
      vesselKind: "tug",
      lengthM: 17,
      widthM: 5.8,
      heightM: 5.8,
      speedKnots: 10.2,
      moving: true,
      coords: TUG_HARBOR_LOOP,
      speedMps: 5.2,
      phase: tb.phase,
      arrivalTime: "2026-11-24T06:00:00+09:00",
      departureTime: "2026-11-24T22:00:00+09:00",
    })),
  ];

  // Compile boat keyframes and STRICTLY validate every 2s sample lands on real harbor water!
  const compiledPortCalls = portCallsRaw.map((raw) => {
    if (!raw.moving || !raw.coords) {
      return {
        id: raw.id,
        vesselNameJa: raw.vesselNameJa,
        vesselNameEn: raw.vesselNameEn,
        berthJa: raw.berthJa,
        berthEn: raw.berthEn,
        vesselKind: raw.vesselKind,
        lengthM: raw.lengthM,
        widthM: raw.widthM,
        heightM: raw.heightM,
        bearingDeg: raw.bearingDeg,
        speedKnots: raw.speedKnots,
        moving: false,
        lon: raw.lon,
        lat: raw.lat,
        arrivalTime: raw.arrivalTime,
        departureTime: raw.departureTime,
        mode: "scheduled",
        source: raw.source ?? "Yokohama Port Waterfront Vessels",
      };
    }

    const kfs = buildClosedLoopKeyframes(cam, raw.coords, raw.speedMps, raw.phase).map((k) => ({
      timeSec: k.timeSec,
      lon: k.lon,
      lat: k.lat,
      bearingDeg: k.bearingDeg,
    }));
    const dur = kfs[kfs.length - 1].timeSec;
    for (let t = 0; t <= dur; t += 2) {
      const s = sampleLoop(kfs, t, dur);
      const img = wgs84ToImage(cam, s.lon, s.lat, 0);
      const px = img.px * scaleToPreview;
      const py = img.py * scaleToPreview;
      const check = isWaterPixel(previewPng, px, py);
      if (!check.ok) {
        throw new Error(
          `Boat ${raw.id} (${raw.vesselNameEn}) left water at t=${t}s lon=${s.lon.toFixed(5)} lat=${s.lat.toFixed(5)} preview=(${px.toFixed(1)},${py.toFixed(1)}) rgb=(${check.rgb.join(",")})`,
        );
      }
    }

    return {
      id: raw.id,
      vesselNameJa: raw.vesselNameJa,
      vesselNameEn: raw.vesselNameEn,
      berthJa: raw.berthJa,
      berthEn: raw.berthEn,
      vesselKind: raw.vesselKind,
      lengthM: raw.lengthM,
      widthM: raw.widthM,
      heightM: raw.heightM,
      bearingDeg: kfs[0].bearingDeg,
      speedKnots: raw.speedKnots,
      moving: true,
      lon: kfs[0].lon,
      lat: kfs[0].lat,
      arrivalTime: raw.arrivalTime,
      departureTime: raw.departureTime,
      mode: "scheduled",
      source: "Yokohama Port Waterfront Vessels",
      keyframes: kfs,
    };
  });

  const buildSnapshot = (mode) => {
    const vehicles = [];
    const keyframes = {};

    if (mode === "synthetic") {
      vehicles.push(existingBb01);
      keyframes["syn-bayside-blue-01"] = existingBb01Kfs;
    }

    for (const spec of busSpecs) {
      const entityId = mode === "scheduled" ? spec.entityId.replace(/^syn-/, "sched-") : spec.entityId;
      const kfs = buildClosedLoopKeyframes(cam, spec.coords, spec.speedMps, spec.phase, {
        roadElevationM: 2.2,
        deckId: "ground-road",
        noteJa: spec.noteJa,
        noteEn: spec.noteEn,
      });
      const first = kfs[0];
      vehicles.push({
        entityId,
        mode,
        routeId: spec.routeId,
        routeLabelJa: spec.routeLabelJa,
        routeLabelEn: spec.routeLabelEn,
        tripId: `${entityId}-trip`,
        directionId: 0,
        directionLabelJa: spec.dirJa,
        directionLabelEn: spec.dirEn,
        observedAt: mode === "scheduled" ? null : "2026-11-24T08:00:00+09:00",
        fetchedAt: "2026-11-24T08:00:00+09:00",
        lon: first.lon,
        lat: first.lat,
        bearingDeg: first.bearingDeg,
        speedMps: spec.speedMps,
        deckId: "ground-road",
        roadElevationM: 2.2,
        lengthM: spec.lengthM,
        widthM: spec.widthM,
        heightM: spec.heightM,
        articulated: spec.articulated,
        shapeProgress: Number(spec.phase.toFixed(2)),
        statusNote: spec.noteEn,
      });
      keyframes[entityId] = kfs;
    }

    // Also include 1 Circle-Walk bus in scheduled preset if desired
    if (mode === "scheduled") {
      vehicles.unshift({
        ...existingBb01,
        entityId: "sched-bayside-blue-102",
        mode: "scheduled",
        routeLabelJa: "ベイサイドブルー",
        routeLabelEn: "Bayside Blue",
        directionLabelJa: "横浜駅前 → 赤レンガ倉庫・山下ふ頭",
        directionLabelEn: "Yokohama Sta. -> Red Brick / Yamashita Pier",
        observedAt: null,
        statusNote: "Estimated from GTFS-JP stop_times",
      });
      keyframes["sched-bayside-blue-102"] = existingBb01Kfs;
    }

    for (const v of vehicles) {
      if (HAS_JA(v.routeLabelEn) || HAS_JA(v.directionLabelEn)) {
        throw new Error(`JA leaked in vehicle EN: ${v.entityId}`);
      }
      for (const kf of keyframes[v.entityId]) {
        if (HAS_JA(kf.noteEn)) {
          throw new Error(`JA leaked in kf noteEn: ${v.entityId}`);
        }
      }
    }
    for (const pc of compiledPortCalls) {
      if (HAS_JA(pc.vesselNameEn) || HAS_JA(pc.berthEn) || HAS_JA(pc.source)) {
        throw new Error(`JA leaked in portCall EN: ${pc.id}`);
      }
    }

    return {
      schemaVersion: "1.0.0",
      generatedAt: "2026-11-24T08:00:00+09:00",
      fetchedAt: "2026-11-24T08:00:00+09:00",
      feedHealth: "ok",
      feedMessage:
        mode === "synthetic"
          ? {
              ja: "横浜臨海部ミニチュア運行：ベイサイドブルー・あかいくつ・ピアライン・市営バス＆横浜港船隊",
              en: "Yokohama waterfront simulation: Bayside Blue, Akai Kutsu, Pier Line, City Buses & Harbor vessels",
            }
          : {
              ja: "時刻表推定レイヤー：全22台バス＆横浜港14隻の定時ダイヤ推定運行",
              en: "Scheduled timetable layer: 22 transit buses & 14 Yokohama Harbor vessels",
            },
      source:
        mode === "synthetic"
          ? {
              id: "synthetic-yokohama-fleet",
              labelJa: "横浜臨海部ミニチュア運行",
              labelEn: "Yokohama Waterfront Fleet Simulation",
              attribution: "Small Yokohama Fleet Fixture (MIT)",
            }
          : {
              id: "gtfs-jp-scheduled-fixture",
              labelJa: "時刻表推定（横浜臨海部ダイヤ）",
              labelEn: "Scheduled Timetable (Yokohama Fleet)",
              attribution: "Yokohama Municipal Bus & Harbor Fixture",
            },
      vehicles,
      replayDurationSec: 58,
      keyframes,
      portCalls: compiledPortCalls,
    };
  };

  const synOut = buildSnapshot("synthetic");
  const schedOut = buildSnapshot("scheduled");
  fs.writeFileSync(synPath, `${JSON.stringify(synOut, null, 2)}\n`, "utf8");
  fs.writeFileSync(schedPath, `${JSON.stringify(schedOut, null, 2)}\n`, "utf8");
  console.log(
    `Generated Yokohama fleet fixtures cleanly: synthetic(${synOut.vehicles.length} buses, ${synOut.portCalls.length} ships), scheduled(${schedOut.vehicles.length} buses, ${schedOut.portCalls.length} ships) — 100% harbor water & EN verified!`,
  );
}

main();
