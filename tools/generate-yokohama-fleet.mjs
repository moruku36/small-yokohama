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

function localToDepthM(cam, loc) {
  const dx = loc[0] - cam.cameraOriginLocalM[0];
  const dy = loc[1] - cam.cameraOriginLocalM[1];
  const dz = loc[2] - cam.cameraOriginLocalM[2];
  return (
    dx * cam.basis.forward[0] +
    dy * cam.basis.forward[1] +
    dz * cam.basis.forward[2]
  );
}

function buildRoadGraph(cam, osm) {
  const adj = new Map();
  const allowed = new Set([
    "trunk",
    "primary",
    "secondary",
    "tertiary",
    "unclassified",
    "trunk_link",
    "primary_link",
    "secondary_link",
    "tertiary_link",
  ]);
  for (const w of osm.roadWays) {
    if (!allowed.has(w.highway)) continue;
    const isMajor =
      w.highway === "trunk" ||
      w.highway === "primary" ||
      w.highway === "secondary";
    const weight = isMajor ? 1.0 : w.highway.endsWith("_link") ? 1.2 : 1.35;
    for (let i = 0; i < w.nodes.length - 1; i++) {
      const a = String(w.nodes[i]);
      const b = String(w.nodes[i + 1]);
      const ca = osm.nodes[a];
      const cb = osm.nodes[b];
      if (!ca || !cb) continue;
      const d = distMeters(cam, ca, cb);
      if (d < 0.01) continue;
      if (!adj.has(a)) adj.set(a, []);
      if (!adj.has(b)) adj.set(b, []);
      adj.get(a).push({ to: b, cost: d * weight, dist: d });
      if (w.oneway !== "yes" && w.oneway !== "1") {
        adj.get(b).push({ to: a, cost: d * weight, dist: d });
      } else {
        // Allow reverse traversal with a tiny penalty if needed for two-way bus routing
        adj.get(b).push({ to: a, cost: d * (weight * 2.2), dist: d });
      }
    }
  }
  // Keep largest connected component so waypoints never snap to isolated stubs
  const seen = new Set();
  let mainComp = new Set();
  for (const id of adj.keys()) {
    if (seen.has(id)) continue;
    const comp = new Set([id]);
    seen.add(id);
    const stack = [id];
    while (stack.length > 0) {
      const u = stack.pop();
      for (const e of adj.get(u) ?? []) {
        if (!seen.has(e.to)) {
          seen.add(e.to);
          comp.add(e.to);
          stack.push(e.to);
        }
      }
    }
    if (comp.size > mainComp.size) mainComp = comp;
  }
  for (const id of [...adj.keys()]) {
    if (!mainComp.has(id)) adj.delete(id);
  }
  return adj;
}

function nearestGraphNodes(cam, osm, adj, pt, maxM = 450, topK = 6) {
  const list = [];
  for (const id of adj.keys()) {
    const c = osm.nodes[id];
    if (!c) continue;
    const d = distMeters(cam, c, pt);
    if (d <= maxM) list.push({ id, dist: d });
  }
  list.sort((a, b) => a.dist - b.dist);
  return list.slice(0, topK);
}

function dijkstraMultiGraph(adj, starts, goals) {
  if (starts.length === 0 || goals.length === 0) return null;
  const goalSet = new Set(goals.map((g) => g.id));
  const dist = new Map();
  const prev = new Map();
  const edgeUsed = new Map();
  const heap = [];
  for (const s of starts) {
    dist.set(s.id, s.dist);
    heap.push([s.dist, s.id]);
  }
  heap.sort((a, b) => a[0] - b[0]);
  while (heap.length > 0) {
    const [d, u] = heap.shift();
    if (d > (dist.get(u) ?? Infinity)) continue;
    if (goalSet.has(u)) {
      const nodes = [];
      let cur = u;
      while (cur) {
        nodes.push({ id: cur, edge: edgeUsed.get(cur) ?? null });
        cur = prev.get(cur);
      }
      return nodes.reverse();
    }
    for (const e of adj.get(u) ?? []) {
      const nd = d + e.cost;
      if (nd < (dist.get(e.to) ?? Infinity)) {
        dist.set(e.to, nd);
        prev.set(e.to, u);
        edgeUsed.set(e.to, e);
        heap.push([nd, e.to]);
        heap.sort((a, b) => a[0] - b[0]);
      }
    }
  }
  return null;
}

function subdividePolyline(cam, coords, maxSegM = 45) {
  if (coords.length <= 1) return coords;
  const out = [coords[0]];
  for (let i = 1; i < coords.length; i++) {
    const a = coords[i - 1];
    const b = coords[i];
    const d = distMeters(cam, a, b);
    if (d > maxSegM) {
      const steps = Math.ceil(d / maxSegM);
      for (let s = 1; s < steps; s++) {
        const t = s / steps;
        out.push([
          Number((a[0] + (b[0] - a[0]) * t).toFixed(7)),
          Number((a[1] + (b[1] - a[1]) * t).toFixed(7)),
        ]);
      }
    }
    if (d >= 0.8 || i === coords.length - 1) {
      out.push(b);
    }
  }
  return out;
}

function routeStopsOnRoadGraph(cam, osm, roadGraph, waypoints, label) {
  const pathCoords = [];
  for (let i = 0; i < waypoints.length - 1; i++) {
    const a = nearestGraphNodes(cam, osm, roadGraph, waypoints[i], 450, 6);
    const b = nearestGraphNodes(cam, osm, roadGraph, waypoints[i + 1], 450, 6);
    const seg = dijkstraMultiGraph(roadGraph, a, b);
    if (!seg) {
      throw new Error(`Road Dijkstra failed for ${label} segment ${i}`);
    }
    const segCoords = seg.map((n) => osm.nodes[n.id]);
    if (pathCoords.length === 0) {
      pathCoords.push(...segCoords);
    } else {
      pathCoords.push(...segCoords.slice(1));
    }
  }
  // If closed loop, snap last to exact first if close (< 60m)
  if (pathCoords.length >= 2) {
    const dClose = distMeters(cam, pathCoords[0], pathCoords[pathCoords.length - 1]);
    if (dClose > 2 && dClose < 120) {
      pathCoords.push(pathCoords[0]);
    }
  }
  return subdividePolyline(cam, pathCoords, 45);
}

function buildRailGraphBridged(cam, osm, primaryFn, fallbackFn) {
  const adj = new Map();
  for (const w of osm.railWays) {
    const isPrimary = primaryFn(w);
    const isFallback = !isPrimary && fallbackFn(w);
    if (!isPrimary && !isFallback) continue;
    const wt = isPrimary ? 1.0 : 8.0;
    const isElevated = w.bridge === "yes" || (w.layer ?? 0) > 0;
    for (let i = 0; i < w.nodes.length - 1; i++) {
      const a = String(w.nodes[i]);
      const b = String(w.nodes[i + 1]);
      const ca = osm.nodes[a];
      const cb = osm.nodes[b];
      if (!ca || !cb) continue;
      const d = distMeters(cam, ca, cb);
      if (d < 0.05) continue;
      if (!adj.has(a)) adj.set(a, []);
      if (!adj.has(b)) adj.set(b, []);
      adj.get(a).push({
        to: b,
        cost: d * wt,
        dist: d,
        elevM: isElevated ? 7.5 : 3.2,
        tunnel: false,
      });
      adj.get(b).push({
        to: a,
        cost: d * wt,
        dist: d,
        elevM: isElevated ? 7.5 : 3.2,
        tunnel: false,
      });
    }
  }

  // Bridge short tunnel gaps (<= 800m) between disjoint rail components
  const compOf = new Map();
  const comps = [];
  for (const id of adj.keys()) {
    if (compOf.has(id)) continue;
    const comp = [];
    const stack = [id];
    compOf.set(id, comps.length);
    while (stack.length > 0) {
      const u = stack.pop();
      comp.push(u);
      for (const e of adj.get(u) ?? []) {
        if (!compOf.has(e.to)) {
          compOf.set(e.to, comps.length);
          stack.push(e.to);
        }
      }
    }
    comps.push(comp);
  }
  for (let i = 0; i < comps.length; i++) {
    for (let j = i + 1; j < comps.length; j++) {
      let best = null;
      for (const a of comps[i]) {
        const ca = osm.nodes[a];
        for (const b of comps[j]) {
          const cb = osm.nodes[b];
          const d = distMeters(cam, ca, cb);
          if (d <= 800 && (!best || d < best.d)) best = { a, b, d };
        }
      }
      if (best) {
        adj.get(best.a).push({
          to: best.b,
          cost: best.d * 20,
          dist: best.d,
          elevM: -15,
          tunnel: true,
        });
        adj.get(best.b).push({
          to: best.a,
          cost: best.d * 20,
          dist: best.d,
          elevM: -15,
          tunnel: true,
        });
      }
    }
  }
  return adj;
}

function isInsideCanvas(cam, lon, lat, marginPx = 40) {
  const img = wgs84ToImage(cam, lon, lat, 4);
  return (
    img.px >= marginPx &&
    img.px <= cam.imageWidthPx - marginPx &&
    img.py >= marginPx &&
    img.py <= cam.imageHeightPx - marginPx
  );
}

function intersectBoundaryLonLat(cam, insidePt, outsidePt, marginPx = 40) {
  let lo = 0;
  let hi = 1;
  for (let iter = 0; iter < 18; iter++) {
    const mid = (lo + hi) * 0.5;
    const lon = insidePt[0] + (outsidePt[0] - insidePt[0]) * mid;
    const lat = insidePt[1] + (outsidePt[1] - insidePt[1]) * mid;
    if (isInsideCanvas(cam, lon, lat, marginPx)) {
      lo = mid;
    } else {
      hi = mid;
    }
  }
  return [
    Number((insidePt[0] + (outsidePt[0] - insidePt[0]) * lo).toFixed(7)),
    Number((insidePt[1] + (outsidePt[1] - insidePt[1]) * lo).toFixed(7)),
  ];
}

function buildYokohamaRailBundle(cam, osm) {
  const specs = [
    {
      id: "jr-keihin-tohoku",
      code: "JK",
      operatorJa: "JR東日本",
      operatorEn: "JR East",
      lineNameJa: "京浜東北・根岸線",
      lineNameEn: "Keihin-Tohoku / Negishi Line",
      odptRailway: "odpt.Railway:JR-East.KeihinTohokuNegishi",
      colorHex: "#00bae8",
      cars: 6,
      carLengthM: 17.0,
      carWidthM: 2.95,
      carHeightM: 3.6,
      speedMps: 16.0,
      headwaySec: 130,
      dwellSec: 16,
      inboundLabelJa: "大船方面（磯子・石川町）",
      inboundLabelEn: "Southbound (Sakuragicho / Ishikawacho / Ofuna)",
      outboundLabelJa: "東京・大宮方面（横浜・東神奈川）",
      outboundLabelEn: "Northbound (Yokohama / Tokyo / Omiya)",
      primary: (w) => w.name.includes("京浜東北") || w.name.includes("根岸線"),
      fallback: (w) => !w.name,
      waypoints: [
        [139.63332, 35.47794], // Higashi-Kanagawa
        [139.62227, 35.46581], // Yokohama
        [139.63102, 35.45099], // Sakuragicho
        [139.64275, 35.43923], // Ishikawacho
        [139.64369, 35.43734], // Ishikawacho South Portal
      ],
      stations: [
        { id: "jk-higashi-kanagawa", nameJa: "東神奈川", nameEn: "Higashi-Kanagawa", lon: 139.63332, lat: 35.47794, odptStationId: "odpt.Station:JR-East.KeihinTohokuNegishi.HigashiKanagawa" },
        { id: "jk-yokohama", nameJa: "横浜", nameEn: "Yokohama", lon: 139.62227, lat: 35.46581, odptStationId: "odpt.Station:JR-East.KeihinTohokuNegishi.Yokohama" },
        { id: "jk-sakuragicho", nameJa: "桜木町", nameEn: "Sakuragicho", lon: 139.63102, lat: 35.45099, odptStationId: "odpt.Station:JR-East.Negishi.Sakuragicho" },
        { id: "jk-kannai", nameJa: "関内", nameEn: "Kannai", lon: 139.63604, lat: 35.44408, odptStationId: "odpt.Station:JR-East.Negishi.Kannai" },
        { id: "jk-ishikawacho", nameJa: "石川町", nameEn: "Ishikawacho", lon: 139.64275, lat: 35.43923, odptStationId: "odpt.Station:JR-East.Negishi.Ishikawacho" },
      ],
    },
    {
      id: "jr-tokaido",
      code: "JT",
      operatorJa: "JR東日本",
      operatorEn: "JR East",
      lineNameJa: "東海道線",
      lineNameEn: "Tokaido Line",
      odptRailway: "odpt.Railway:JR-East.Tokaido",
      colorHex: "#f68b1e",
      cars: 6,
      carLengthM: 17.5,
      carWidthM: 2.95,
      carHeightM: 3.65,
      speedMps: 18.0,
      headwaySec: 140,
      dwellSec: 18,
      inboundLabelJa: "大船・小田原・熱海方面",
      inboundLabelEn: "Down (Ofuna / Odawara / Atami)",
      outboundLabelJa: "品川・東京方面",
      outboundLabelEn: "Up (Kawasaki / Shinagawa / Tokyo)",
      primary: (w) => w.name === "東海道本線",
      fallback: (w) => !w.name || w.name.includes("東海道"),
      waypoints: [
        [139.63332, 35.47794],
        [139.62227, 35.46581],
        [139.60848, 35.45329],
      ],
      stations: [
        { id: "jt-kawasaki", nameJa: "川崎方面", nameEn: "Kawasaki Bound", lon: 139.63332, lat: 35.47794, odptStationId: "odpt.Station:JR-East.Tokaido.Kawasaki" },
        { id: "jt-yokohama", nameJa: "横浜", nameEn: "Yokohama", lon: 139.62227, lat: 35.46581, odptStationId: "odpt.Station:JR-East.Tokaido.Yokohama" },
        { id: "jt-totsuka", nameJa: "戸塚・大船方面", nameEn: "Totsuka Bound", lon: 139.60848, lat: 35.45329, odptStationId: "odpt.Station:JR-East.Tokaido.Totsuka" },
      ],
    },
    {
      id: "jr-yokosuka",
      code: "JO",
      operatorJa: "JR東日本",
      operatorEn: "JR East",
      lineNameJa: "横須賀・湘南新宿ライン",
      lineNameEn: "Yokosuka / Shonan-Shinjuku Line",
      odptRailway: "odpt.Railway:JR-East.Yokosuka",
      colorHex: "#0067c0",
      cars: 6,
      carLengthM: 17.5,
      carWidthM: 2.95,
      carHeightM: 3.65,
      speedMps: 17.5,
      headwaySec: 150,
      dwellSec: 18,
      inboundLabelJa: "鎌倉・逗子・久里浜方面",
      inboundLabelEn: "Down (Kamakura / Zushi / Kurihama)",
      outboundLabelJa: "品川・東京・新宿方面",
      outboundLabelEn: "Up (Musashi-Kosugi / Tokyo / Shinjuku)",
      primary: (w) => w.name.includes("横須賀線"),
      fallback: (w) => !w.name,
      waypoints: [
        [139.63332, 35.47794],
        [139.62227, 35.46581],
        [139.60848, 35.45329],
      ],
      stations: [
        { id: "jo-shin-kawasaki", nameJa: "新川崎方面", nameEn: "Shin-Kawasaki Bound", lon: 139.63332, lat: 35.47794, odptStationId: "odpt.Station:JR-East.Yokosuka.ShinKawasaki" },
        { id: "jo-yokohama", nameJa: "横浜", nameEn: "Yokohama", lon: 139.62227, lat: 35.46581, odptStationId: "odpt.Station:JR-East.Yokosuka.Yokohama" },
        { id: "jo-hodogaya", nameJa: "保土ケ谷・大船方面", nameEn: "Hodogaya Bound", lon: 139.60848, lat: 35.45329, odptStationId: "odpt.Station:JR-East.Yokosuka.Hodogaya" },
      ],
    },
    {
      id: "keikyu-main",
      code: "KK",
      operatorJa: "京急電鉄",
      operatorEn: "Keikyu",
      lineNameJa: "京急本線",
      lineNameEn: "Keikyu Main Line",
      odptRailway: "odpt.Railway:Keikyu.Main",
      colorHex: "#e8334a",
      cars: 5,
      carLengthM: 16.5,
      carWidthM: 2.85,
      carHeightM: 3.55,
      speedMps: 16.0,
      headwaySec: 120,
      dwellSec: 16,
      inboundLabelJa: "上大岡・浦賀方面（日ノ出町）",
      inboundLabelEn: "Down (Hinodecho / Kamiooka / Uraga)",
      outboundLabelJa: "京急川崎・品川方面（横浜）",
      outboundLabelEn: "Up (Yokohama / Keikyu Kawasaki / Shinagawa)",
      primary: (w) => w.name.includes("京浜急行"),
      fallback: (w) => w.operator.includes("京浜急行") || !w.name,
      waypoints: [
        [139.62752, 35.47153], // Kanagawa
        [139.62320, 35.46621], // Yokohama
        [139.61954, 35.45675], // Tobe
        [139.62671, 35.44555], // Hinodecho
        [139.62315, 35.43992], // Koganecho
      ],
      stations: [
        { id: "kk-kanagawa", nameJa: "神奈川", nameEn: "Kanagawa", lon: 139.62752, lat: 35.47153, odptStationId: "odpt.Station:Keikyu.Main.Kanagawa" },
        { id: "kk-yokohama", nameJa: "横浜", nameEn: "Yokohama", lon: 139.62320, lat: 35.46621, odptStationId: "odpt.Station:Keikyu.Main.Yokohama" },
        { id: "kk-tobe", nameJa: "戸部", nameEn: "Tobe", lon: 139.61954, lat: 35.45675, odptStationId: "odpt.Station:Keikyu.Main.Tobe" },
        { id: "kk-hinodecho", nameJa: "日ノ出町", nameEn: "Hinodecho", lon: 139.62671, lat: 35.44555, odptStationId: "odpt.Station:Keikyu.Main.Hinodecho" },
        { id: "kk-koganecho", nameJa: "黄金町", nameEn: "Koganecho", lon: 139.62315, lat: 35.43992, odptStationId: "odpt.Station:Keikyu.Main.Koganecho" },
      ],
    },
    {
      id: "sotetsu-main",
      code: "SO",
      operatorJa: "相鉄線",
      operatorEn: "Sotetsu",
      lineNameJa: "相鉄本線",
      lineNameEn: "Sotetsu Main Line",
      odptRailway: "odpt.Railway:Sotetsu.Main",
      colorHex: "#1c438a",
      cars: 5,
      carLengthM: 16.5,
      carWidthM: 2.9,
      carHeightM: 3.55,
      speedMps: 14.5,
      headwaySec: 110,
      dwellSec: 16,
      inboundLabelJa: "二俣川・海老名・湘南台方面",
      inboundLabelEn: "Down (Futamatagawa / Ebina / Shonandai)",
      outboundLabelJa: "横浜ゆき",
      outboundLabelEn: "Up (To Yokohama)",
      primary: (w) => w.name.includes("相模鉄道"),
      fallback: (w) => w.operator.includes("相模鉄道"),
      waypoints: [
        [139.62030, 35.46427], // Yokohama Sotetsu
        [139.61634, 35.45967], // Hiranumabashi
        [139.60848, 35.45329], // Nishi-Yokohama
        [139.60263, 35.45400], // Tennocho
      ],
      stations: [
        { id: "so-yokohama", nameJa: "横浜", nameEn: "Yokohama", lon: 139.62030, lat: 35.46427, odptStationId: "odpt.Station:Sotetsu.Main.Yokohama" },
        { id: "so-hiranumabashi", nameJa: "平沼橋", nameEn: "Hiranumabashi", lon: 139.61634, lat: 35.45967, odptStationId: "odpt.Station:Sotetsu.Main.Hiranumabashi" },
        { id: "so-nishi-yokohama", nameJa: "西横浜", nameEn: "Nishi-Yokohama", lon: 139.60848, lat: 35.45329, odptStationId: "odpt.Station:Sotetsu.Main.NishiYokohama" },
      ],
    },
  ];

  const lines = [];
  for (const spec of specs) {
    const graph = buildRailGraphBridged(cam, osm, spec.primary, spec.fallback);
    const rawNodes = [];
    for (let i = 0; i < spec.waypoints.length - 1; i++) {
      const a = nearestGraphNodes(cam, osm, graph, spec.waypoints[i], 500, 8);
      const b = nearestGraphNodes(cam, osm, graph, spec.waypoints[i + 1], 500, 8);
      const seg = dijkstraMultiGraph(graph, a, b);
      if (!seg) {
        throw new Error(`Rail Dijkstra failed for ${spec.id} seg ${i}`);
      }
      if (rawNodes.length === 0) {
        rawNodes.push(...seg);
      } else {
        rawNodes.push(...seg.slice(1));
      }
    }

    // Build point sequence including tunnel portal drops (elevM = -15 inside tunnel interiors)
    const rawPts = [];
    for (let i = 0; i < rawNodes.length; i++) {
      const cur = osm.nodes[rawNodes[i].id];
      const edge = rawNodes[i].edge;
      if (i > 0 && edge?.tunnel) {
        const prev = osm.nodes[rawNodes[i - 1].id];
        const prevElev = rawPts[rawPts.length - 1]?.elevM ?? 4.0;
        const d = distMeters(cam, prev, cur);
        if (d > 14) {
          const t0 = Math.min(0.15, 5 / d);
          const t1 = 1 - t0;
          rawPts.push({
            lon: Number((prev[0] + (cur[0] - prev[0]) * t0).toFixed(7)),
            lat: Number((prev[1] + (cur[1] - prev[1]) * t0).toFixed(7)),
            elevM: prevElev,
          });
          rawPts.push({
            lon: Number((prev[0] + (cur[0] - prev[0]) * (t0 + 0.02)).toFixed(7)),
            lat: Number((prev[1] + (cur[1] - prev[1]) * (t0 + 0.02)).toFixed(7)),
            elevM: -15,
          });
          rawPts.push({
            lon: Number((prev[0] + (cur[0] - prev[0]) * (t1 - 0.02)).toFixed(7)),
            lat: Number((prev[1] + (cur[1] - prev[1]) * (t1 - 0.02)).toFixed(7)),
            elevM: -15,
          });
          rawPts.push({
            lon: Number((prev[0] + (cur[0] - prev[0]) * t1).toFixed(7)),
            lat: Number((prev[1] + (cur[1] - prev[1]) * t1).toFixed(7)),
            elevM: 4.5,
          });
        }
      }
      rawPts.push({
        lon: cur[0],
        lat: cur[1],
        elevM: edge ? (edge.tunnel ? 4.5 : edge.elevM) : 4.5,
      });
    }

    // Clip to continuous inside-canvas span [40..W-40] x [40..H-40]
    let firstIn = rawPts.findIndex((p) => isInsideCanvas(cam, p.lon, p.lat, 40));
    let lastIn = -1;
    for (let i = rawPts.length - 1; i >= 0; i--) {
      if (isInsideCanvas(cam, rawPts[i].lon, rawPts[i].lat, 40)) {
        lastIn = i;
        break;
      }
    }
    if (firstIn < 0 || lastIn <= firstIn) {
      throw new Error(`Rail ${spec.id} had insufficient inside-canvas span`);
    }

    const clipped = [];
    if (firstIn > 0) {
      const bnd = intersectBoundaryLonLat(
        cam,
        [rawPts[firstIn].lon, rawPts[firstIn].lat],
        [rawPts[firstIn - 1].lon, rawPts[firstIn - 1].lat],
        40,
      );
      clipped.push({ lon: bnd[0], lat: bnd[1], elevM: rawPts[firstIn].elevM });
    }
    for (let i = firstIn; i <= lastIn; i++) {
      clipped.push(rawPts[i]);
    }
    if (lastIn < rawPts.length - 1) {
      const bnd = intersectBoundaryLonLat(
        cam,
        [rawPts[lastIn].lon, rawPts[lastIn].lat],
        [rawPts[lastIn + 1].lon, rawPts[lastIn + 1].lat],
        40,
      );
      clipped.push({ lon: bnd[0], lat: bnd[1], elevM: rawPts[lastIn].elevM });
    }

    // Compute cumulative distM and bearings
    let totalDistM = 0;
    const points = [];
    for (let i = 0; i < clipped.length; i++) {
      const pt = clipped[i];
      if (i > 0) {
        totalDistM += distMeters(
          cam,
          [clipped[i - 1].lon, clipped[i - 1].lat],
          [pt.lon, pt.lat],
        );
      }
      const next = clipped[Math.min(clipped.length - 1, i + 1)];
      const prev = clipped[Math.max(0, i - 1)];
      const bearingDeg =
        i < clipped.length - 1 && distMeters(cam, [pt.lon, pt.lat], [next.lon, next.lat]) > 0.2
          ? headingBetween(cam, [pt.lon, pt.lat], [next.lon, next.lat])
          : headingBetween(cam, [prev.lon, prev.lat], [pt.lon, pt.lat]);
      points.push({
        lon: Number(pt.lon.toFixed(7)),
        lat: Number(pt.lat.toFixed(7)),
        elevM: Number(pt.elevM.toFixed(2)),
        distM: Number(totalDistM.toFixed(2)),
        bearingDeg: Number(bearingDeg.toFixed(2)),
      });
    }

    // Project station coordinates to closest distM along clipped line
    const stations = spec.stations.map((st) => {
      let bestDist = points[0].distM;
      let bestGap = Infinity;
      for (const p of points) {
        const gap = distMeters(cam, [st.lon, st.lat], [p.lon, p.lat]);
        if (gap < bestGap) {
          bestGap = gap;
          bestDist = p.distM;
        }
      }
      if (HAS_JA(st.nameEn)) {
        throw new Error(`JA leaked in station nameEn: ${st.id}`);
      }
      return {
        ...st,
        distM: Number(bestDist.toFixed(2)),
      };
    });

    if (
      HAS_JA(spec.lineNameEn) ||
      HAS_JA(spec.operatorEn) ||
      HAS_JA(spec.inboundLabelEn) ||
      HAS_JA(spec.outboundLabelEn)
    ) {
      throw new Error(`JA leaked in rail line EN: ${spec.id}`);
    }

    lines.push({
      id: spec.id,
      code: spec.code,
      operatorJa: spec.operatorJa,
      operatorEn: spec.operatorEn,
      lineNameJa: spec.lineNameJa,
      lineNameEn: spec.lineNameEn,
      odptRailway: spec.odptRailway,
      colorHex: spec.colorHex,
      cars: spec.cars,
      carLengthM: spec.carLengthM,
      carWidthM: spec.carWidthM,
      carHeightM: spec.carHeightM,
      speedMps: spec.speedMps,
      headwaySec: spec.headwaySec,
      dwellSec: spec.dwellSec,
      totalDistM: Number(totalDistM.toFixed(2)),
      inboundLabelJa: spec.inboundLabelJa,
      inboundLabelEn: spec.inboundLabelEn,
      outboundLabelJa: spec.outboundLabelJa,
      outboundLabelEn: spec.outboundLabelEn,
      points,
      stations,
    });
  }

  return {
    schemaVersion: "1.0.0",
    generatedAt: "2026-11-25T15:00:00+09:00",
    lines,
  };
}

function buildCityStreetlights(cam, osm, previewPng, scaleToPreview) {
  const majorTypes = new Set(["trunk", "primary", "secondary"]);
  const minorTypes = new Set(["tertiary", "unclassified"]);
  const grid = new Map();

  const tryAddLamp = (lon, lat, elevM, warmWeight) => {
    const img = wgs84ToImage(cam, lon, lat, elevM);
    if (
      img.px < 40 ||
      img.px > cam.imageWidthPx - 40 ||
      img.py < 40 ||
      img.py > cam.imageHeightPx - 40
    ) {
      return;
    }
    const cell = `${Math.floor(img.px / 44)}:${Math.floor(img.py / 44)}`;
    if (grid.has(cell)) return;
    // Skip lamps falling on open harbor water
    const wCheck = isWaterPixel(
      previewPng,
      img.px * scaleToPreview,
      img.py * scaleToPreview,
    );
    if (wCheck.ok) return;

    const loc = wgs84ToLocal(cam, lon, lat, elevM);
    const depthM = localToDepthM(cam, loc);
    grid.set(cell, [
      Number(img.px.toFixed(1)),
      Number(img.py.toFixed(1)),
      Number(depthM.toFixed(2)),
      Number(warmWeight.toFixed(2)),
    ]);
  };

  for (const w of osm.roadWays) {
    const isMajor = majorTypes.has(w.highway);
    const isMinor = minorTypes.has(w.highway);
    if (!isMajor && !isMinor) continue;
    const stepM = isMajor ? 30 : 52;
    const warmWeight = isMajor ? 0.95 : 0.65;
    for (let i = 0; i < w.nodes.length - 1; i++) {
      const ca = osm.nodes[String(w.nodes[i])];
      const cb = osm.nodes[String(w.nodes[i + 1])];
      if (!ca || !cb) continue;
      const d = distMeters(cam, ca, cb);
      const count = Math.max(1, Math.floor(d / stepM));
      for (let s = 0; s < count; s++) {
        const t = s / count;
        tryAddLamp(
          ca[0] + (cb[0] - ca[0]) * t,
          ca[1] + (cb[1] - ca[1]) * t,
          2.2,
          warmWeight,
        );
      }
    }
  }

  // Emphasize iconic Minato Mirai / Red Brick / Yamashita / Yokohama Sta. plazas
  const plazas = [
    [139.64264, 35.45244],
    [139.64342, 35.45194],
    [139.64060, 35.45401],
    [139.63130, 35.45480],
    [139.64950, 35.44520],
    [139.62380, 35.46580],
    [139.63780, 35.44380],
  ];
  for (const [lon, lat] of plazas) {
    tryAddLamp(lon, lat, 3.0, 1.0);
  }

  let items = [...grid.values()];
  if (items.length > 1600) {
    const stride = items.length / 1600;
    const sampled = [];
    for (let i = 0; i < 1600; i++) {
      sampled.push(items[Math.floor(i * stride)]);
    }
    items = sampled;
  }

  return {
    schemaVersion: "1.0.0",
    count: items.length,
    points: items.flat(),
  };
}

function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const SURFACE_KIND_MAP = {
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

function loadDepthTiles(releaseDir, cam) {
  const { cols, rows, tileSizePx, scale } = cam.dataTileGrid;
  const tiles = new Map();
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const p = path.join(releaseDir, "depth", `tile_${c}_${r}.png`);
      if (!fs.existsSync(p)) continue;
      tiles.set(`${c}_${r}`, decodePngRgba(fs.readFileSync(p)));
    }
  }
  const sampleKind = (px, py) => {
    const sx = Math.floor(px * scale);
    const sy = Math.floor(py * scale);
    if (sx < 0 || sy < 0) return -1;
    const c = Math.floor(sx / tileSizePx);
    const r = Math.floor(sy / tileSizePx);
    const t = tiles.get(`${c}_${r}`);
    if (!t) return -1;
    const lx = sx - c * tileSizePx;
    const ly = sy - r * tileSizePx;
    if (lx < 0 || ly < 0 || lx >= t.width || ly >= t.height) return -1;
    return t.data[(ly * t.width + lx) * t.bpp + 2];
  };
  const hasForbiddenSurfaceNearby = (px, py, allowDeck = false) => {
    const center = sampleKind(px, py);
    if (center === SURFACE_KIND_MAP.ROAD || center === SURFACE_KIND_MAP.BUILDING) {
      return true;
    }
    if (!allowDeck && center === SURFACE_KIND_MAP.WATER) {
      return true;
    }
    if (allowDeck && center === SURFACE_KIND_MAP.WATER) {
      return true;
    }
    const step = 1 / scale;
    // 5x5 half-res pixel buffer (~+-3.4m): NEVER stand on or immediately beside ROAD
    for (let dy = -2; dy <= 2; dy++) {
      for (let dx = -2; dx <= 2; dx++) {
        const k = sampleKind(px + dx * step, py + dy * step);
        if (k === SURFACE_KIND_MAP.ROAD) return true;
      }
    }
    // 3x3 half-res pixel buffer: reject WATER (unless on deck/quay center) and building interiors
    let bldgHits = 0;
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        const k = sampleKind(px + dx * step, py + dy * step);
        if (k === SURFACE_KIND_MAP.BUILDING) bldgHits++;
        if (
          k === SURFACE_KIND_MAP.WATER &&
          !(
            allowDeck &&
            (center === SURFACE_KIND_MAP.BRIDGE_DECK || center === SURFACE_KIND_MAP.QUAY)
          )
        ) {
          return true;
        }
      }
    }
    if (bldgHits >= 2) return true;
    return false;
  };
  return { sampleKind, hasForbiddenSurfaceNearby };
}

function buildRoadClearanceIndex(cam, osm) {
  const cellM = 40;
  const grid = new Map();
  const halfWidthForRoad = (hw) => {
    if (hw === "trunk" || hw === "trunk_link") return 14.5;
    if (hw === "primary" || hw === "primary_link") return 12.0;
    if (hw === "secondary" || hw === "secondary_link") return 10.0;
    if (hw === "tertiary" || hw === "tertiary_link") return 8.2;
    return 6.8;
  };
  const insertSeg = (ax, ay, bx, by, halfWidthM) => {
    const pad = halfWidthM + 2;
    const minCx = Math.floor((Math.min(ax, bx) - pad) / cellM);
    const maxCx = Math.floor((Math.max(ax, bx) + pad) / cellM);
    const minCy = Math.floor((Math.min(ay, by) - pad) / cellM);
    const maxCy = Math.floor((Math.max(ay, by) + pad) / cellM);
    const seg = { ax, ay, bx, by, halfWidthSq: halfWidthM * halfWidthM };
    for (let cy = minCy; cy <= maxCy; cy++) {
      for (let cx = minCx; cx <= maxCx; cx++) {
        const key = `${cx}:${cy}`;
        let list = grid.get(key);
        if (!list) {
          list = [];
          grid.set(key, list);
        }
        list.push(seg);
      }
    }
  };
  const indexWays = (ways, widthFn) => {
    for (const w of ways ?? []) {
      const halfW = widthFn(w);
      for (let i = 0; i < w.nodes.length - 1; i++) {
        const ca = osm.nodes[String(w.nodes[i])];
        const cb = osm.nodes[String(w.nodes[i + 1])];
        if (!ca || !cb) continue;
        const la = wgs84ToLocal(cam, ca[0], ca[1], 0);
        const lb = wgs84ToLocal(cam, cb[0], cb[1], 0);
        insertSeg(la[0], la[1], lb[0], lb[1], halfW);
      }
    }
  };
  indexWays(osm.roadWays, (w) => halfWidthForRoad(w.highway));
  indexWays(osm.railWays, () => 10.5);

  const isClearOfAllRoads = (lx, ly) => {
    const cx = Math.floor(lx / cellM);
    const cy = Math.floor(ly / cellM);
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        const list = grid.get(`${cx + dx}:${cy + dy}`);
        if (!list) continue;
        for (const s of list) {
          const abx = s.bx - s.ax;
          const aby = s.by - s.ay;
          const abLenSq = abx * abx + aby * aby;
          let t = 0;
          if (abLenSq > 1e-6) {
            t = Math.max(0, Math.min(1, ((lx - s.ax) * abx + (ly - s.ay) * aby) / abLenSq));
          }
          const px = s.ax + abx * t;
          const py = s.ay + aby * t;
          const distSq = (lx - px) * (lx - px) + (ly - py) * (ly - py);
          if (distSq < s.halfWidthSq) {
            return false;
          }
        }
      }
    }
    return true;
  };
  return { isClearOfAllRoads };
}

function hashStr32(str) {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function angleDiffDeg(a, b) {
  const d = ((((b - a) % 360) + 540) % 360) - 180;
  return Math.abs(d);
}

function buildAmbientTraffic(cam, osm, previewPng, scaleToPreview) {
  const allowed = new Set([
    "trunk",
    "trunk_link",
    "primary",
    "primary_link",
    "secondary",
    "tertiary",
    "tertiary_link",
    "unclassified",
  ]);
  const rankOf = (hw) =>
    hw === "trunk" || hw === "trunk_link" || hw === "primary" || hw === "primary_link"
      ? 3
      : hw === "secondary"
        ? 2
        : 1;

  const nodeWayDeg = new Map();
  const nodeMaxRank = new Map();
  for (const w of osm.roadWays) {
    if (!allowed.has(w.highway) || w.nodes.length < 2) continue;
    const rank = rankOf(w.highway);
    const seen = new Set();
    for (const nid of w.nodes) {
      const k = String(nid);
      nodeMaxRank.set(k, Math.max(nodeMaxRank.get(k) ?? 0, rank));
      if (!seen.has(k)) {
        seen.add(k);
        nodeWayDeg.set(k, (nodeWayDeg.get(k) ?? 0) + 1);
      }
    }
  }

  // Split every road way at interior intersection nodes (degree >= 3) & canvas boundaries
  const rawBlocks = [];
  for (const w of osm.roadWays) {
    if (!allowed.has(w.highway) || w.nodes.length < 2) continue;
    const hwRank = rankOf(w.highway);
    const oneway = w.oneway === "yes" || w.oneway === "1";
    const lanes =
      w.highway === "trunk" || w.highway === "primary" || (w.highway === "secondary" && oneway)
        ? 2
        : 1;
    const elevM = w.bridge === "yes" || (w.layer ?? 0) > 0 ? 4.5 : 2.1;
    const speedMps = hwRank === 3 ? 11.5 : hwRank === 2 ? 9.6 : 7.6;

    let current = [];
    const flushBlock = () => {
      if (current.length < 2) {
        current = [];
        return;
      }
      if (w.bridge !== "yes") {
        for (const pt of current) {
          const img = wgs84ToImage(cam, pt.coord[0], pt.coord[1], 0);
          if (isWaterPixel(previewPng, img.px * scaleToPreview, img.py * scaleToPreview).ok) {
            current = [];
            return;
          }
        }
      }
      let totalDistM = 0;
      for (let i = 1; i < current.length; i++) {
        const step = distMeters(cam, current[i - 1].coord, current[i].coord);
        if (step > 260) {
          current = [];
          return;
        }
        totalDistM += step;
      }
      if (totalDistM < 22) {
        current = [];
        return;
      }
      rawBlocks.push({
        hwRank,
        oneway,
        lanes,
        elevM,
        speedMps,
        totalDistM,
        nodes: current,
      });
      current = [];
    };

    for (let i = 0; i < w.nodes.length; i++) {
      const nid = String(w.nodes[i]);
      const c = osm.nodes[nid];
      if (!c || !isInsideCanvas(cam, c[0], c[1], 36)) {
        flushBlock();
        continue;
      }
      current.push({ nid, coord: c });
      const isInteriorIntersection =
        i > 0 && i < w.nodes.length - 1 && (nodeWayDeg.get(nid) ?? 0) >= 3;
      if (isInteriorIntersection) {
        flushBlock();
        current.push({ nid, coord: c });
      }
    }
    flushBlock();
  }

  // Keep up to ~620 undirected blocks (up to ~1200 directed edges), prioritizing major avenues & central blocks
  rawBlocks.sort((a, b) => {
    if (b.hwRank !== a.hwRank) return b.hwRank - a.hwRank;
    return b.totalDistM - a.totalDistM;
  });
  const selectedBlocks = rawBlocks.slice(0, 620);

  const edges = [];
  const makeDirEdge = (block, reverse) => {
    const seq = reverse ? [...block.nodes].reverse() : block.nodes;
    let totalDistM = 0;
    let minPx = Infinity;
    let maxPx = -Infinity;
    let minPy = Infinity;
    let maxPy = -Infinity;
    const flatPts = [];

    for (let i = 0; i < seq.length; i++) {
      const c = seq[i].coord;
      if (i > 0) {
        totalDistM += distMeters(cam, seq[i - 1].coord, c);
      }
      const img = wgs84ToImage(cam, c[0], c[1], block.elevM);
      minPx = Math.min(minPx, img.px);
      maxPx = Math.max(maxPx, img.px);
      minPy = Math.min(minPy, img.py);
      maxPy = Math.max(maxPy, img.py);
      flatPts.push(
        Number(c[0].toFixed(6)),
        Number(c[1].toFixed(6)),
        Number(totalDistM.toFixed(1)),
      );
    }

    const entryBearing = headingBetween(cam, seq[0].coord, seq[1].coord);
    const exitBearing = headingBetween(
      cam,
      seq[seq.length - 2].coord,
      seq[seq.length - 1].coord,
    );

    const toOsmId = seq[seq.length - 1].nid;
    const deg = nodeWayDeg.get(toOsmId) ?? 1;
    const nRank = nodeMaxRank.get(toOsmId) ?? 1;
    const sigKind = deg >= 3 ? (nRank >= 2 || deg >= 4 ? 1 : 2) : 0;
    const h = hashStr32(toOsmId);
    const cycleSec = sigKind === 1 ? 30 + (h % 14) : sigKind === 2 ? 12 : 0;
    const phaseOffset = cycleSec > 0 ? (h >>> 6) % cycleSec : 0;
    const axis =
      Math.abs(Math.cos((exitBearing * Math.PI) / 180)) >=
      Math.abs(Math.sin((exitBearing * Math.PI) / 180))
        ? 0
        : 1;

    const spacingM = block.hwRank === 3 ? 34 : block.hwRank === 2 ? 42 : 56;
    const maxPerLane = block.hwRank === 3 ? 7 : 5;
    const cars = Math.min(maxPerLane, Math.max(1, Math.round(totalDistM / spacingM)));

    const id = edges.length;
    edges.push({
      id,
      fromOsmId: seq[0].nid,
      toOsmId,
      oneway: block.oneway,
      lanes: block.lanes,
      hwRank: block.hwRank,
      elevM: block.elevM,
      speedMps: block.speedMps,
      totalDistM: Number(totalDistM.toFixed(1)),
      minPx: Math.round(minPx),
      maxPx: Math.round(maxPx),
      minPy: Math.round(minPy),
      maxPy: Math.round(maxPy),
      entryBearing: Number(entryBearing.toFixed(1)),
      exitBearing: Number(exitBearing.toFixed(1)),
      cars,
      endSig: [cycleSec, phaseOffset, axis, sigKind],
      next: [],
      pts: flatPts,
    });
  };

  for (const b of selectedBlocks) {
    makeDirEdge(b, false);
    if (!b.oneway) {
      makeDirEdge(b, true);
    }
  }

  // Link outgoing edges at each intersection node (excluding U-turns >= 135 deg)
  const outgoingByNode = new Map();
  for (const e of edges) {
    let list = outgoingByNode.get(e.fromOsmId);
    if (!list) {
      list = [];
      outgoingByNode.set(e.fromOsmId, list);
    }
    list.push(e);
  }
  const serializedEdges = edges.map((e) => {
    const cands = (outgoingByNode.get(e.toOsmId) ?? [])
      .filter(
        (nxt) =>
          nxt.toOsmId !== e.fromOsmId &&
          angleDiffDeg(e.exitBearing, nxt.entryBearing) < 135,
      )
      .sort(
        (a, b) =>
          angleDiffDeg(e.exitBearing, a.entryBearing) -
          angleDiffDeg(e.exitBearing, b.entryBearing),
      );
    return {
      oneway: e.oneway,
      lanes: e.lanes,
      hwRank: e.hwRank,
      elevM: e.elevM,
      speedMps: e.speedMps,
      totalDistM: e.totalDistM,
      minPx: e.minPx,
      maxPx: e.maxPx,
      minPy: e.minPy,
      maxPy: e.maxPy,
      entryBearing: e.entryBearing,
      exitBearing: e.exitBearing,
      cars: e.cars,
      endSig: e.endSig,
      next: cands.map((c) => c.id),
      pts: e.pts,
    };
  });

  return {
    schemaVersion: "2.0.0",
    edgeCount: serializedEdges.length,
    edges: serializedEdges,
  };
}

function buildPedestrians(cam, osm, depthTiles, roadClearance, previewPng, scaleToPreview) {
  const rng = mulberry32(20261125);
  const grid = new Set();
  const points = [];

  const pushPerson = (lon, lat, elevM, colorIdx, poseIdx, allowDeck = false) => {
    const img = wgs84ToImage(cam, lon, lat, elevM);
    if (
      img.px < 56 ||
      img.px > cam.imageWidthPx - 56 ||
      img.py < 56 ||
      img.py > cam.imageHeightPx - 56
    ) {
      return false;
    }
    const cell = `${Math.floor(img.px / 14)}:${Math.floor(img.py / 14)}`;
    if (grid.has(cell)) return false;

    if (depthTiles.hasForbiddenSurfaceNearby(img.px, img.py, allowDeck)) {
      return false;
    }
    const loc = wgs84ToLocal(cam, lon, lat, elevM);
    if (!roadClearance.isClearOfAllRoads(loc[0], loc[1])) {
      return false;
    }
    if (!allowDeck && isWaterPixel(previewPng, img.px * scaleToPreview, img.py * scaleToPreview).ok) {
      return false;
    }

    grid.add(cell);
    const depthM = localToDepthM(cam, loc);
    const packed = (colorIdx & 7) + ((poseIdx & 3) << 3);
    points.push(
      Number(img.px.toFixed(1)),
      Number(img.py.toFixed(1)),
      Number(depthM.toFixed(2)),
      packed,
    );
    return true;
  };

  // 1. Vibrant Yokohama pedestrian plazas, decks & parks (strictly checked against roads & buildings)
  const hotspots = [
    { lon: 139.6429, lat: 35.4526, radLon: 0.0009, radLat: 0.00065, elevM: 2.2, n: 120, allowDeck: false }, // Red Brick Courtyard
    { lon: 139.6478, lat: 35.4517, radLon: 0.0006, radLat: 0.00045, elevM: 6.5, n: 85, allowDeck: true },  // Osanbashi Deck
    { lon: 139.6496, lat: 35.4465, radLon: 0.0018, radLat: 0.0008, elevM: 2.2, n: 140, allowDeck: false },  // Yamashita Park
    { lon: 139.6435, lat: 35.4553, radLon: 0.0007, radLat: 0.0005, elevM: 2.5, n: 70, allowDeck: false },   // Hammerhead Terrace
    { lon: 139.6448, lat: 35.4501, radLon: 0.0007, radLat: 0.0005, elevM: 2.2, n: 65, allowDeck: false },   // Zou-no-Hana Park
    { lon: 139.6316, lat: 35.4548, radLon: 0.0010, radLat: 0.0007, elevM: 2.4, n: 100, allowDeck: false },  // Nippon Maru / Landmark Plaza
    { lon: 139.6336, lat: 35.4566, radLon: 0.0009, radLat: 0.0007, elevM: 2.4, n: 85, allowDeck: false },   // Queen's Square / MARK IS
    { lon: 139.6371, lat: 35.4596, radLon: 0.0012, radLat: 0.0009, elevM: 2.2, n: 95, allowDeck: false },   // Rinko Park
    { lon: 139.6458, lat: 35.4429, radLon: 0.0012, radLat: 0.0008, elevM: 2.2, n: 100, allowDeck: false },  // Chinatown
    { lon: 139.6401, lat: 35.4434, radLon: 0.0010, radLat: 0.0008, elevM: 2.2, n: 85, allowDeck: false },   // Yokohama Park
    { lon: 139.6226, lat: 35.4658, radLon: 0.0012, radLat: 0.0009, elevM: 2.4, n: 105, allowDeck: false },  // Yokohama Sta.
    { lon: 139.6312, lat: 35.4512, radLon: 0.0008, radLat: 0.0006, elevM: 2.4, n: 80, allowDeck: false },   // Sakuragicho Sta.
    { lon: 139.6266, lat: 35.4666, radLon: 0.0007, radLat: 0.0005, elevM: 2.8, n: 60, allowDeck: false },   // Bay Quarter
    { lon: 139.6275, lat: 35.4608, radLon: 0.0012, radLat: 0.0009, elevM: 2.2, n: 80, allowDeck: false },   // Takashima Central Park
  ];

  for (const h of hotspots) {
    let placed = 0;
    for (let attempt = 0; attempt < h.n * 4 && placed < h.n; attempt++) {
      const a = rng() * Math.PI * 2;
      const r = Math.sqrt(rng());
      const lon = h.lon + Math.cos(a) * h.radLon * r;
      const lat = h.lat + Math.sin(a) * h.radLat * r;
      const colIdx = Math.floor(rng() * 8);
      const poseIdx = Math.floor(rng() * 4);
      if (pushPerson(lon, lat, h.elevM, colIdx, poseIdx, h.allowDeck)) {
        placed++;
        if (rng() < 0.25 && placed < h.n) {
          const companionA = rng() * Math.PI * 2;
          const partnerLon = lon + (Math.cos(companionA) * 1.4) / 90600;
          const partnerLat = lat + (Math.sin(companionA) * 1.4) / 111000;
          if (pushPerson(partnerLon, partnerLat, h.elevM, Math.floor(rng() * 8), (poseIdx + 1) & 3, h.allowDeck)) {
            placed++;
          }
        }
      }
    }
  }

  // 2. Sidewalk pedestrians strictly outside asphalt clearance along city streets
  const sidewalkOffsetFor = (hw) => {
    if (hw === "primary") return 13.2 + rng() * 1.6;
    if (hw === "secondary") return 10.8 + rng() * 1.4;
    if (hw === "tertiary") return 9.0 + rng() * 1.2;
    return 7.4 + rng() * 1.0;
  };
  const sidewalkRoads = new Set(["primary", "secondary", "tertiary", "unclassified"]);
  const offLonPerM = 1 / 90600;
  const offLatPerM = 1 / 111000;

  for (const w of osm.roadWays) {
    if (!sidewalkRoads.has(w.highway) || w.bridge === "yes") continue;
    for (let i = 0; i < w.nodes.length - 1; i++) {
      if (points.length / 4 >= 2650) break;
      const ca = osm.nodes[String(w.nodes[i])];
      const cb = osm.nodes[String(w.nodes[i + 1])];
      if (!ca || !cb) continue;
      const d = distMeters(cam, ca, cb);
      if (d < 8) continue;
      const count = Math.max(1, Math.floor(d / 20));
      const la = wgs84ToLocal(cam, ca[0], ca[1], 0);
      const lb = wgs84ToLocal(cam, cb[0], cb[1], 0);
      const tx = (lb[0] - la[0]) / d;
      const ty = (lb[1] - la[1]) / d;
      const nx = -ty;
      const ny = tx;

      for (let k = 0; k < count; k++) {
        if (rng() > 0.78 || points.length / 4 >= 2650) continue;
        const t = (k + 0.5) / count;
        const side = (rng() < 0.5 ? 1 : -1) * sidewalkOffsetFor(w.highway);
        const lon = ca[0] + (cb[0] - ca[0]) * t + nx * side * offLonPerM;
        const lat = ca[1] + (cb[1] - ca[1]) * t + ny * side * offLatPerM;
        const colIdx = Math.floor(rng() * 8);
        const poseIdx = Math.floor(rng() * 3);
        if (pushPerson(lon, lat, 2.2, colIdx, poseIdx, false) && rng() < 0.28) {
          // Companion walks along sidewalk tangent (never stepping into the street)
          const stepAlong = (rng() < 0.5 ? 1 : -1) * 1.4;
          const pLon = lon + tx * stepAlong * offLonPerM;
          const pLat = lat + ty * stepAlong * offLatPerM;
          pushPerson(pLon, pLat, 2.2, Math.floor(rng() * 8), (poseIdx + 1) % 3, false);
        }
      }
    }
  }

  return {
    schemaVersion: "1.0.0",
    count: Math.floor(points.length / 4),
    points,
  };
}

function main() {
  const rootDir = process.cwd();
  const releaseDir = path.join(rootDir, "viewer", "public", "releases", "full-yokohama-v1");
  const cam = JSON.parse(fs.readFileSync(path.join(releaseDir, "camera.json"), "utf8"));
  const osm = JSON.parse(fs.readFileSync(path.join(rootDir, "data", "yokohama-osm-network.json"), "utf8"));
  const synPath = path.join(releaseDir, "fixtures", "synthetic-bayside-blue.json");
  const schedPath = path.join(releaseDir, "fixtures", "scheduled-bayside-blue.json");
  const trainsPath = path.join(releaseDir, "fixtures", "yokohama-trains.json");
  const lightsPath = path.join(releaseDir, "fixtures", "streetlights.json");
  const trafficPath = path.join(releaseDir, "fixtures", "ambient-traffic.json");
  const pedsPath = path.join(releaseDir, "fixtures", "pedestrians.json");
  const previewPng = decodePngRgba(
    fs.readFileSync(path.join(rootDir, "docs", "images", "full-yokohama-23tiles-preview.png")),
  );
  const scaleToPreview = previewPng.width / cam.imageWidthPx;

  const pilotSyn = JSON.parse(
    fs.readFileSync(
      path.join(
        rootDir,
        "viewer",
        "public",
        "releases",
        "pilot-shinko-v1",
        "fixtures",
        "synthetic-bayside-blue.json",
      ),
      "utf8",
    ),
  );
  const existingBb01 = pilotSyn.vehicles[0];
  if (!existingBb01) {
    throw new Error("Expected baseline syn-bayside-blue-01 vehicle metadata");
  }

  const roadGraph = buildRoadGraph(cam, osm);
  const depthTiles = loadDepthTiles(releaseDir, cam);
  const roadClearance = buildRoadClearanceIndex(cam, osm);

  // Real OSM waterfront road corridors routed strictly along connected OSM surface streets
  const SHINKO_BB01_WAYPOINTS = [
    [139.6398, 35.4546],
    [139.64060, 35.45401],
    [139.64166, 35.45299],
    [139.64207, 35.45187],
    [139.64193, 35.45185],
    [139.64039, 35.45376],
    [139.6398, 35.4546],
  ];
  const SHINKO_BB01_ROAD = routeStopsOnRoadGraph(cam, osm, roadGraph, SHINKO_BB01_WAYPOINTS, "bb01");

  const BAYSIDE_SPINE = routeStopsOnRoadGraph(
    cam,
    osm,
    roadGraph,
    [
      [139.6246, 35.4650], // Yokohama Sta. East Gate
      [139.6272, 35.4612], // Nissan HQ / Takashima
      [139.63319, 35.46296], // Rinko Kansen N
      [139.63538, 35.45823], // Pacifico N
      [139.64060, 35.45401], // Circle Walk
      [139.64207, 35.45187], // Red Brick W
      [139.64259, 35.44875], // Kaigan-dori
      [139.6458, 35.4468], // Yamashita Park W
      [139.6512, 35.4439], // Yamashita Pier entrance
      [139.6458, 35.4468],
      [139.64250, 35.44858],
      [139.64193, 35.45185],
      [139.64039, 35.45376], // Return NB under Circle Walk
      [139.63624, 35.45670],
      [139.63308, 35.46299],
      [139.6272, 35.4612],
      [139.6246, 35.4650],
    ],
    "BAYSIDE_SPINE",
  );

  const AKAI_KUTSU_LOOP = routeStopsOnRoadGraph(
    cam,
    osm,
    roadGraph,
    [
      [139.63522, 35.44653], // Bashamichi South
      [139.63902, 35.45188], // Bankokubashi Bridge
      [139.64120, 35.45469], // Hammerhead Entrance
      [139.64342, 35.45194], // Red Brick Plaza
      [139.64475, 35.44774], // Osanbashi-dori
      [139.6498, 35.4449], // Yamashita Park
      [139.6458, 35.4430], // Chinatown North Gate
      [139.6401, 35.4450], // Yokohama Stadium N
      [139.63583, 35.44585], // Kannai-Odori
      [139.63522, 35.44653],
    ],
    "AKAI_KUTSU_LOOP",
  );

  const PIER_LINE_LOOP = routeStopsOnRoadGraph(
    cam,
    osm,
    roadGraph,
    [
      [139.6312, 35.4510], // Sakuragicho Station
      [139.63296, 35.45520], // Sakura-dori
      [139.63635, 35.45703], // Pacifico / Exhibition Hall
      [139.64060, 35.45401], // Circle Walk
      [139.64207, 35.45187],
      [139.63902, 35.45188], // Bankokubashi
      [139.63644, 35.45013], // Honcho
      [139.63365, 35.45164], // Minato Mirai Blvd
      [139.6312, 35.4510],
    ],
    "PIER_LINE_LOOP",
  );

  const CITY_26_CORRIDOR = routeStopsOnRoadGraph(
    cam,
    osm,
    roadGraph,
    [
      [139.6244, 35.4654], // Yokohama Sta.
      [139.6275, 35.4608],
      [139.6316, 35.4549], // Landmark Tower / Minato Mirai
      [139.63364, 35.45149], // Minato Mirai Blvd
      [139.63644, 35.45013], // Honcho
      [139.63939, 35.44854], // Honcho East
      [139.64250, 35.44858], // Kaigan-dori
      [139.6502, 35.4442], // Yamashita Park
    ],
    "CITY_26_CORRIDOR",
  );

  const CITY_8_58_CORRIDOR = routeStopsOnRoadGraph(
    cam,
    osm,
    roadGraph,
    [
      [139.6314, 35.4508], // Sakuragicho
      [139.63498, 35.44974], // Honcho W
      [139.63591, 35.44580], // Kannai Sta.
      [139.6401, 35.4436], // Yokohama Stadium
      [139.6458, 35.4432], // Chinatown
      [139.6502, 35.4418], // Motomachi
      [139.6458, 35.4468], // Yamashita Park
      [139.64250, 35.44858], // Kaigan-dori
      [139.63810, 35.45069], // Bankokubashi S
      [139.6314, 35.4508],
    ],
    "CITY_8_58_CORRIDOR",
  );

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

  // Build dense 58s OSM-routed keyframes for syn-bayside-blue-01 around Shinko / Circle Walk / Red Brick
  const rawBb01Kfs = buildClosedLoopKeyframes(cam, SHINKO_BB01_ROAD, 10.5, 0.0, {
    roadElevationM: 2.2,
    deckId: "ground-road",
    noteJa: "新港サークルウォーク・赤レンガ倉庫 周回運行",
    noteEn: "Shinko Circle Walk & Red Brick loop on OSM roads",
  });
  const bb01Dur = rawBb01Kfs[rawBb01Kfs.length - 1].timeSec || 58;
  const denseBb01Kfs = rawBb01Kfs.map((k) => ({
    ...k,
    timeSec: Number(((k.timeSec / bb01Dur) * 58).toFixed(2)),
  }));
  const synBb01 = {
    ...existingBb01,
    lon: denseBb01Kfs[0].lon,
    lat: denseBb01Kfs[0].lat,
    bearingDeg: denseBb01Kfs[0].bearingDeg,
    deckId: "ground-road",
    roadElevationM: 2.2,
  };

  const buildSnapshot = (mode) => {
    const vehicles = [];
    const keyframes = {};

    if (mode === "synthetic") {
      vehicles.push(synBb01);
      keyframes["syn-bayside-blue-01"] = denseBb01Kfs;
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

    // Also include 1 Circle-Walk bus in scheduled preset
    if (mode === "scheduled") {
      vehicles.unshift({
        ...synBb01,
        entityId: "sched-bayside-blue-102",
        mode: "scheduled",
        routeLabelJa: "ベイサイドブルー",
        routeLabelEn: "Bayside Blue",
        directionLabelJa: "横浜駅前 → 赤レンガ倉庫・山下ふ頭",
        directionLabelEn: "Yokohama Sta. -> Red Brick / Yamashita Pier",
        observedAt: null,
        statusNote: "Estimated from GTFS-JP stop_times",
      });
      keyframes["sched-bayside-blue-102"] = denseBb01Kfs;
    }

    // Validate EN cleanliness, dense road keyframe spacing (<= 65m), and inside-canvas bounds
    for (const v of vehicles) {
      if (HAS_JA(v.routeLabelEn) || HAS_JA(v.directionLabelEn)) {
        throw new Error(`JA leaked in vehicle EN: ${v.entityId}`);
      }
      const kfs = keyframes[v.entityId];
      for (let i = 0; i < kfs.length; i++) {
        const kf = kfs[i];
        if (HAS_JA(kf.noteEn)) {
          throw new Error(`JA leaked in kf noteEn: ${v.entityId}`);
        }
        const img = wgs84ToImage(cam, kf.lon, kf.lat, 0);
        if (
          img.px < 64 ||
          img.px > cam.imageWidthPx - 64 ||
          img.py < 64 ||
          img.py > cam.imageHeightPx - 64
        ) {
          throw new Error(`Bus ${v.entityId} kf ${i} out of bounds: (${img.px.toFixed(1)}, ${img.py.toFixed(1)})`);
        }
        if (i > 0) {
          const stepM = distMeters(cam, [kfs[i - 1].lon, kfs[i - 1].lat], [kf.lon, kf.lat]);
          if (stepM > 65) {
            throw new Error(`Bus ${v.entityId} step ${i} too long (${stepM.toFixed(1)}m > 65m)`);
          }
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
  const railBundle = buildYokohamaRailBundle(cam, osm);
  const streetlights = buildCityStreetlights(cam, osm, previewPng, scaleToPreview);
  const ambientTraffic = buildAmbientTraffic(cam, osm, previewPng, scaleToPreview);
  const pedestrians = buildPedestrians(
    cam,
    osm,
    depthTiles,
    roadClearance,
    previewPng,
    scaleToPreview,
  );

  // Hard self-audit: 0 pedestrians allowed on roadways, building interiors, or inside OSM road clearance
  for (let i = 0; i < pedestrians.points.length; i += 4) {
    const px = pedestrians.points[i];
    const py = pedestrians.points[i + 1];
    const k = depthTiles.sampleKind(px, py);
    if (k === SURFACE_KIND_MAP.ROAD || k === SURFACE_KIND_MAP.BUILDING) {
      throw new Error(`Pedestrian audit failed: forbidden surfaceKind=${k} at (${px}, ${py})`);
    }
    const allowDeck = k === SURFACE_KIND_MAP.BRIDGE_DECK || k === SURFACE_KIND_MAP.QUAY;
    if (depthTiles.hasForbiddenSurfaceNearby(px, py, allowDeck)) {
      throw new Error(`Pedestrian audit failed: nearby ROAD/WATER/BUILDING at (${px}, ${py})`);
    }
  }

  fs.writeFileSync(synPath, `${JSON.stringify(synOut, null, 2)}\n`, "utf8");
  fs.writeFileSync(schedPath, `${JSON.stringify(schedOut, null, 2)}\n`, "utf8");
  fs.writeFileSync(trainsPath, `${JSON.stringify(railBundle, null, 2)}\n`, "utf8");
  fs.writeFileSync(lightsPath, `${JSON.stringify(streetlights)}\n`, "utf8");
  fs.writeFileSync(trafficPath, `${JSON.stringify(ambientTraffic)}\n`, "utf8");
  fs.writeFileSync(pedsPath, `${JSON.stringify(pedestrians)}\n`, "utf8");
  console.log(
    `Generated Yokohama fleet fixtures cleanly: synthetic(${synOut.vehicles.length} buses, ${synOut.portCalls.length} ships), scheduled(${schedOut.vehicles.length} buses, ${schedOut.portCalls.length} ships), rail(${railBundle.lines.length} lines), streetlights(${streetlights.count}), traffic(${ambientTraffic.edgeCount} edges), pedestrians(${pedestrians.count})`,
  );
}

main();
