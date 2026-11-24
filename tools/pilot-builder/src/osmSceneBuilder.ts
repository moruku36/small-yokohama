import { readFileSync } from "node:fs";
import {
  FEATURE_IDS,
  SHINKO_FEATURES,
  SURFACE_KIND,
  addExtrudedPrism,
  addGabledBuilding,
  addRoadMarkings,
  addRoadStrip,
  addSailboat,
  addShip,
  createShinkoPilotCamera,
  earClipOrFanPolygon,
  localToWgs84,
  orientedRectXY,
  pushQuad,
  pushTri,
  wgs84ToLocal,
  type GroundControlPoint,
  type Landmark,
  type PoiRecord,
  type PortCallRecord,
  type Rgb,
  type SceneFeatureRecord,
  type SceneTriangle,
  type ShinkoSceneBundle,
  type SurfaceKind,
  type Vec3,
  type VehicleKeyframe,
} from "@small-yokohama/core";
import type { OsmBuildingRecord, OsmShinkoDataset } from "./fetchOsm.js";

function decimatePolyline(
  pts: ReadonlyArray<readonly [number, number]>,
  minStepM: number,
): Array<[number, number]> {
  if (pts.length <= 2) return pts.map((p) => [p[0], p[1]]);
  const out: Array<[number, number]> = [[pts[0]![0], pts[0]![1]]];
  for (let i = 1; i < pts.length - 1; i++) {
    const prev = out[out.length - 1]!;
    const cur = pts[i]!;
    if (Math.hypot(cur[0] - prev[0], cur[1] - prev[1]) >= minStepM) {
      out.push([cur[0], cur[1]]);
    }
  }
  const last = pts[pts.length - 1]!;
  out.push([last[0], last[1]]);
  return out;
}

function fitOrientedBox(pts: ReadonlyArray<readonly [number, number]>): {
  cx: number;
  cy: number;
  lengthM: number;
  widthM: number;
  angleRad: number;
} {
  let sx = 0;
  let sy = 0;
  for (const [x, y] of pts) {
    sx += x;
    sy += y;
  }
  const cx = sx / pts.length;
  const cy = sy / pts.length;

  let bestLen = 0;
  let bestAngle = 0;
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i]!;
    const b = pts[(i + 1) % pts.length]!;
    const dx = b[0] - a[0];
    const dy = b[1] - a[1];
    const d = Math.hypot(dx, dy);
    if (d > bestLen) {
      bestLen = d;
      bestAngle = Math.atan2(dy, dx);
    }
  }

  const cos = Math.cos(-bestAngle);
  const sin = Math.sin(-bestAngle);
  let minU = Infinity;
  let maxU = -Infinity;
  let minV = Infinity;
  let maxV = -Infinity;
  for (const [x, y] of pts) {
    const rx = x - cx;
    const ry = y - cy;
    const u = rx * cos - ry * sin;
    const v = rx * sin + ry * cos;
    if (u < minU) minU = u;
    if (u > maxU) maxU = u;
    if (v < minV) minV = v;
    if (v > maxV) maxV = v;
  }

  return {
    cx,
    cy,
    lengthM: Math.max(4, maxU - minU),
    widthM: Math.max(4, maxV - minV),
    angleRad: bestAngle,
  };
}

function pointInRing(x: number, y: number, poly: ReadonlyArray<readonly [number, number]>): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const xi = poly[i]![0];
    const yi = poly[i]![1];
    const xj = poly[j]![0];
    const yj = poly[j]![1];
    const intersect = yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi + 1e-12) + xi;
    if (intersect) inside = !inside;
  }
  return inside;
}

function dedupeAndWind(
  ringXY: ReadonlyArray<readonly [number, number]>,
  wantCcw: boolean,
): Array<[number, number]> {
  const pts: Array<[number, number]> = [];
  for (const p of ringXY) {
    const prev = pts[pts.length - 1];
    if (!prev || Math.hypot(p[0] - prev[0], p[1] - prev[1]) > 1e-4) {
      pts.push([p[0], p[1]]);
    }
  }
  if (pts.length >= 2 && Math.hypot(pts[0]![0] - pts[pts.length - 1]![0], pts[0]![1] - pts[pts.length - 1]![1]) <= 1e-4) {
    pts.pop();
  }
  if (pts.length < 3) return pts;
  let area2 = 0;
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i]!;
    const q = pts[(i + 1) % pts.length]!;
    area2 += p[0] * q[1] - q[0] * p[1];
  }
  if ((wantCcw && area2 < 0) || (!wantCcw && area2 > 0)) {
    pts.reverse();
  }
  return pts;
}

/**
 * Eberly rightmost-vertex bridge splice joining inner courtyard holes into a single CCW boundary ring.
 */
function mergeHolesIntoOuterRing(
  outerRaw: ReadonlyArray<readonly [number, number]>,
  holesRaw: ReadonlyArray<ReadonlyArray<readonly [number, number]>>,
): Array<[number, number]> {
  let merged = dedupeAndWind(outerRaw, true);
  if (merged.length < 3 || holesRaw.length === 0) return merged;

  const holes = holesRaw
    .map((h) => dedupeAndWind(h, false))
    .filter((h) => h.length >= 3)
    .map((h) => {
      let maxIdx = 0;
      for (let i = 1; i < h.length; i++) {
        if (h[i]![0] > h[maxIdx]![0]) maxIdx = i;
      }
      return { ring: h, hIdx: maxIdx, maxX: h[maxIdx]![0] };
    })
    .sort((a, b) => b.maxX - a.maxX);

  const cross2 = (ax: number, ay: number, bx: number, by: number, cx: number, cy: number) =>
    (bx - ax) * (cy - ay) - (by - ay) * (cx - ax);
  const inTri = (
    px: number,
    py: number,
    ax: number,
    ay: number,
    bx: number,
    by: number,
    cx: number,
    cy: number,
  ) => {
    const s1 = cross2(ax, ay, bx, by, px, py);
    const s2 = cross2(bx, by, cx, cy, px, py);
    const s3 = cross2(cx, cy, ax, ay, px, py);
    return (s1 >= -1e-6 && s2 >= -1e-6 && s3 >= -1e-6) || (s1 <= 1e-6 && s2 <= 1e-6 && s3 <= 1e-6);
  };

  for (const holeInfo of holes) {
    const h = holeInfo.ring;
    const hPt = h[holeInfo.hIdx]!;
    const hx = hPt[0];
    const hy = hPt[1];

    let bestDistX = Infinity;
    let bestEdgeIdx = -1;
    let bestPIdx = 0;

    for (let i = 0; i < merged.length; i++) {
      const i2 = (i + 1) % merged.length;
      const a = merged[i]!;
      const b = merged[i2]!;
      // Edge must cross horizontal ray y = hy rightward
      const crosses = (a[1] <= hy && b[1] > hy) || (b[1] <= hy && a[1] > hy);
      if (!crosses) continue;
      const ix = a[0] + ((hy - a[1]) / (b[1] - a[1])) * (b[0] - a[0]);
      if (ix >= hx - 1e-6 && ix - hx < bestDistX) {
        bestDistX = ix - hx;
        bestEdgeIdx = i;
        bestPIdx = a[0] >= b[0] ? i : i2;
      }
    }

    if (bestEdgeIdx === -1) {
      // Fallback to nearest outer vertex strictly to the right
      let bestD = Infinity;
      for (let i = 0; i < merged.length; i++) {
        const pt = merged[i]!;
        const d = Math.hypot(pt[0] - hx, pt[1] - hy);
        if (pt[0] >= hx && d < bestD) {
          bestD = d;
          bestPIdx = i;
        }
      }
    } else {
      const ix = hx + bestDistX;
      const pPt = merged[bestPIdx]!;
      let chosenIdx = bestPIdx;
      let bestAngle = Infinity;
      for (let i = 0; i < merged.length; i++) {
        if (i === bestPIdx) continue;
        const prev = merged[(i + merged.length - 1) % merged.length]!;
        const cur = merged[i]!;
        const next = merged[(i + 1) % merged.length]!;
        // Only reflex vertices inside (M, I, P) can block segment H -> P
        if (cross2(prev[0], prev[1], cur[0], cur[1], next[0], next[1]) >= 0) continue;
        if (inTri(cur[0], cur[1], hx, hy, ix, hy, pPt[0], pPt[1])) {
          const ang = Math.atan2(Math.abs(cur[1] - hy), Math.max(1e-6, cur[0] - hx));
          if (ang < bestAngle) {
            bestAngle = ang;
            chosenIdx = i;
          }
        }
      }
      bestPIdx = chosenIdx;
    }

    const rotatedHole: Array<[number, number]> = [];
    for (let k = 0; k < h.length; k++) {
      rotatedHole.push(h[(holeInfo.hIdx + k) % h.length]!);
    }
    const bridgeTarget = merged[bestPIdx]!;
    merged = [
      ...merged.slice(0, bestPIdx + 1),
      ...rotatedHole,
      hPt,
      bridgeTarget,
      ...merged.slice(bestPIdx + 1),
    ];
  }

  return merged;
}

function earClipRingSafe(
  out: SceneTriangle[],
  pts: ReadonlyArray<readonly [number, number]>,
  z: number,
  featureId: number,
  surfaceKind: SurfaceKind,
  plainRgb: Rgb,
  illustratedRgb: Rgb,
  materialTag?: SceneTriangle["materialTag"],
): void {
  if (pts.length < 3) return;
  const indices = pts.map((_, i) => i);
  const cross2 = (ax: number, ay: number, bx: number, by: number, cx: number, cy: number) =>
    (bx - ax) * (cy - ay) - (by - ay) * (cx - ax);
  const pointInTri = (
    px: number,
    py: number,
    ax: number,
    ay: number,
    bx: number,
    by: number,
    cx: number,
    cy: number,
  ) => {
    const c1 = cross2(ax, ay, bx, by, px, py);
    const c2 = cross2(bx, by, cx, cy, px, py);
    const c3 = cross2(cx, cy, ax, ay, px, py);
    return c1 >= -1e-6 && c2 >= -1e-6 && c3 >= -1e-6;
  };
  const samePt = (px: number, py: number, ax: number, ay: number) =>
    Math.abs(px - ax) < 1e-6 && Math.abs(py - ay) < 1e-6;

  let guard = 0;
  while (indices.length > 3 && guard < 10000) {
    guard++;
    let clipped = false;
    for (let i = 0; i < indices.length; i++) {
      const iPrev = indices[(i + indices.length - 1) % indices.length]!;
      const iCurr = indices[i]!;
      const iNext = indices[(i + 1) % indices.length]!;
      const a = pts[iPrev]!;
      const b = pts[iCurr]!;
      const c = pts[iNext]!;
      if (cross2(a[0], a[1], b[0], b[1], c[0], c[1]) <= 1e-6) continue;

      let containsOther = false;
      for (let j = 0; j < indices.length; j++) {
        const idx = indices[j]!;
        if (idx === iPrev || idx === iCurr || idx === iNext) continue;
        const p = pts[idx]!;
        if (samePt(p[0], p[1], a[0], a[1]) || samePt(p[0], p[1], b[0], b[1]) || samePt(p[0], p[1], c[0], c[1])) {
          continue;
        }
        if (pointInTri(p[0], p[1], a[0], a[1], b[0], b[1], c[0], c[1])) {
          containsOther = true;
          break;
        }
      }
      if (!containsOther) {
        pushTri(
          out,
          [a[0], a[1], z],
          [b[0], b[1], z],
          [c[0], c[1], z],
          featureId,
          surfaceKind,
          plainRgb,
          illustratedRgb,
          undefined,
          materialTag,
        );
        indices.splice(i, 1);
        clipped = true;
        break;
      }
    }
    if (!clipped) break;
  }

  if (indices.length === 3) {
    const a = pts[indices[0]!]!;
    const b = pts[indices[1]!]!;
    const c = pts[indices[2]!]!;
    pushTri(
      out,
      [a[0], a[1], z],
      [b[0], b[1], z],
      [c[0], c[1], z],
      featureId,
      surfaceKind,
      plainRgb,
      illustratedRgb,
      undefined,
      materialTag,
    );
  }
}

function addExtrudedBuildingWithHoles(
  out: SceneTriangle[],
  outerRaw: ReadonlyArray<readonly [number, number]>,
  holesRaw: ReadonlyArray<ReadonlyArray<readonly [number, number]>>,
  zBot: number,
  zTop: number,
  featureId: number,
  style: {
    wallPlain: Rgb;
    wallIllus: Rgb;
    roofPlain: Rgb;
    roofIllus: Rgb;
    wallTag: SceneTriangle["materialTag"];
    roofTag: SceneTriangle["materialTag"];
  },
): void {
  const outer = dedupeAndWind(outerRaw, true);
  const holes = holesRaw.map((h) => dedupeAndWind(h, false)).filter((h) => h.length >= 3);
  const merged = mergeHolesIntoOuterRing(outer, holes);
  earClipRingSafe(
    out,
    merged,
    zTop,
    featureId,
    SURFACE_KIND.BUILDING,
    style.roofPlain,
    style.roofIllus,
    style.roofTag,
  );

  // Outer perimeter walls (CCW -> outward normals)
  for (let i = 0; i < outer.length; i++) {
    const p0 = outer[i]!;
    const p1 = outer[(i + 1) % outer.length]!;
    pushQuad(
      out,
      [p0[0], p0[1], zBot],
      [p1[0], p1[1], zBot],
      [p1[0], p1[1], zTop],
      [p0[0], p0[1], zTop],
      featureId,
      SURFACE_KIND.BUILDING,
      style.wallPlain,
      style.wallIllus,
      undefined,
      style.wallTag,
    );
  }

  // Courtyard inner walls (CW -> inward courtyard normals) + courtyard boardwalk deck
  for (const h of holes) {
    for (let i = 0; i < h.length; i++) {
      const p0 = h[i]!;
      const p1 = h[(i + 1) % h.length]!;
      pushQuad(
        out,
        [p0[0], p0[1], zBot],
        [p1[0], p1[1], zBot],
        [p1[0], p1[1], zTop],
        [p0[0], p0[1], zTop],
        featureId,
        SURFACE_KIND.BUILDING,
        style.wallPlain,
        style.wallIllus,
        undefined,
        style.wallTag,
      );
    }
    earClipOrFanPolygon(
      out,
      h,
      zBot + 0.14,
      featureId,
      SURFACE_KIND.QUAY,
      [194, 188, 178],
      [196, 162, 122],
      undefined,
      "wood",
    );
  }
}

function isOnAnyLand(
  x: number,
  y: number,
  landPolygons: ReadonlyArray<ReadonlyArray<readonly [number, number]>>,
): boolean {
  for (const poly of landPolygons) {
    if (pointInRing(x, y, poly)) return true;
  }
  return false;
}

function isStrictlyOnLand(
  x: number,
  y: number,
  landPolygons: ReadonlyArray<ReadonlyArray<readonly [number, number]>>,
  marginM = 2.5,
): boolean {
  return (
    isOnAnyLand(x, y, landPolygons) &&
    isOnAnyLand(x + marginM, y + marginM, landPolygons) &&
    isOnAnyLand(x - marginM, y + marginM, landPolygons) &&
    isOnAnyLand(x + marginM, y - marginM, landPolygons) &&
    isOnAnyLand(x - marginM, y - marginM, landPolygons)
  );
}

function isInsideAnyBuilding(
  x: number,
  y: number,
  bldgRings: ReadonlyArray<ReadonlyArray<readonly [number, number]>>,
): boolean {
  for (const poly of bldgRings) {
    if (pointInRing(x, y, poly)) return true;
  }
  return false;
}

function placeVesselAlongsideQuay(
  triangles: SceneTriangle[],
  landPolygons: ReadonlyArray<ReadonlyArray<readonly [number, number]>>,
  quayA: readonly [number, number],
  quayB: readonly [number, number],
  lengthM: number,
  widthM: number,
  featureId: number,
  isCruise: boolean,
): [number, number] {
  const dx = quayB[0] - quayA[0];
  const dy = quayB[1] - quayA[1];
  const len = Math.hypot(dx, dy) || 1;
  const tx = dx / len;
  const ty = dy / len;
  const angleRad = Math.atan2(ty, tx);

  const midX = (quayA[0] + quayB[0]) * 0.5;
  const midY = (quayA[1] + quayB[1]) * 0.5;

  const n1x = -ty;
  const n1y = tx;
  const n2x = ty;
  const n2y = -tx;
  const n1Open = !isOnAnyLand(midX + n1x * 24, midY + n1y * 24, landPolygons);
  const nx = n1Open ? n1x : n2x;
  const ny = n1Open ? n1y : n2y;

  const padHalfL = lengthM * 0.5 + 2.5;
  const padHalfW = widthM * 0.5 + 2.5;
  let offsetM = widthM * 0.5 + 4.5;
  let bestX = midX + nx * offsetM;
  let bestY = midY + ny * offsetM;

  for (let step = 0; step < 18; step++) {
    const cx = midX + nx * offsetM;
    const cy = midY + ny * offsetM;
    const testOffsets: ReadonlyArray<readonly [number, number]> = [
      [-padHalfL, -padHalfW],
      [0, -padHalfW],
      [padHalfL, -padHalfW],
      [padHalfL, 0],
      [padHalfL, padHalfW],
      [0, padHalfW],
      [-padHalfL, padHalfW],
      [-padHalfL, 0],
    ];
    const allWater = testOffsets.every(([u, v]) => {
      const px = cx + tx * u + nx * v;
      const py = cy + ty * u + ny * v;
      return !isOnAnyLand(px, py, landPolygons);
    });
    if (allWater) {
      bestX = cx;
      bestY = cy;
      break;
    }
    offsetM += 2.0;
    bestX = cx;
    bestY = cy;
  }

  addShip(triangles, bestX, bestY, lengthM, widthM, angleRad, featureId, isCruise);
  return [bestX, bestY];
}

const GENERIC_PALETTES: ReadonlyArray<{
  wallPlain: Rgb;
  wallIllus: Rgb;
  roofPlain: Rgb;
  roofIllus: Rgb;
  wallTag: SceneTriangle["materialTag"];
}> = [
  {
    wallPlain: [176, 172, 164],
    wallIllus: [232, 224, 208], // warm cream stucco
    roofPlain: [192, 188, 182],
    roofIllus: [222, 214, 200],
    wallTag: "concrete",
  },
  {
    wallPlain: [178, 170, 158],
    wallIllus: [216, 198, 174], // warm sandstone
    roofPlain: [190, 184, 176],
    roofIllus: [204, 194, 180],
    wallTag: "concrete",
  },
  {
    wallPlain: [164, 174, 184],
    wallIllus: [184, 202, 218], // soft blue-gray glass
    roofPlain: [184, 190, 196],
    roofIllus: [208, 214, 222],
    wallTag: "glass",
  },
  {
    wallPlain: [172, 176, 166],
    wallIllus: [204, 208, 192], // pale olive-stone
    roofPlain: [186, 188, 180],
    roofIllus: [196, 200, 188],
    wallTag: "concrete",
  },
  {
    wallPlain: [180, 168, 158],
    wallIllus: [212, 182, 164], // muted terracotta-cream
    roofPlain: [194, 186, 178],
    roofIllus: [188, 164, 152],
    wallTag: "concrete",
  },
  {
    wallPlain: [168, 172, 176],
    wallIllus: [192, 198, 204], // slate concrete
    roofPlain: [182, 186, 190],
    roofIllus: [184, 190, 198],
    wallTag: "concrete",
  },
];

function chooseBuildingStyle(b: OsmBuildingRecord): {
  wallPlain: Rgb;
  wallIllus: Rgb;
  roofPlain: Rgb;
  roofIllus: Rgb;
  wallTag: SceneTriangle["materialTag"];
  roofTag: SceneTriangle["materialTag"];
} {
  const name = `${b.nameJa} ${b.nameEn}`.toLowerCase();
  if (b.osmId === 72998296 || b.osmId === 72998303 || /赤レンガ/.test(name)) {
    return {
      wallPlain: [166, 78, 58],
      wallIllus: [184, 78, 56],
      roofPlain: [100, 94, 92],
      roofIllus: [106, 90, 86],
      wallTag: "brick",
      roofTag: "roof",
    };
  }
  if (/marine|マリン/.test(name)) {
    return {
      wallPlain: [154, 84, 68],
      wallIllus: [164, 86, 68],
      roofPlain: [94, 98, 106],
      roofIllus: [86, 92, 102],
      wallTag: "brick",
      roofTag: "roof",
    };
  }
  if (/ハンマーヘッド|hammerhead|pier 8/.test(name)) {
    return {
      wallPlain: [204, 208, 214],
      wallIllus: [234, 236, 238],
      roofPlain: [208, 214, 220],
      roofIllus: [216, 222, 228],
      wallTag: "glass",
      roofTag: "concrete",
    };
  }
  if (b.osmId === 72970880 || /cupnoodles|カップヌードル|安藤百福/.test(name)) {
    return {
      wallPlain: [188, 174, 158],
      wallIllus: [212, 188, 162],
      roofPlain: [206, 200, 190],
      roofIllus: [224, 214, 198],
      wallTag: "concrete",
      roofTag: "concrete",
    };
  }
  if (b.osmId === 72666337 || /jica/.test(name)) {
    return {
      wallPlain: [186, 178, 164],
      wallIllus: [210, 198, 178],
      roofPlain: [204, 196, 184],
      roofIllus: [222, 212, 196],
      wallTag: "concrete",
      roofTag: "concrete",
    };
  }
  if (b.osmId === 72665070 || /ワールドポーターズ|world porters/.test(name)) {
    return {
      wallPlain: [184, 182, 178],
      wallIllus: [206, 202, 196],
      roofPlain: [188, 194, 200],
      roofIllus: [194, 206, 216],
      wallTag: "glass",
      roofTag: "concrete",
    };
  }
  if (/インターコンチ|intercontinental|会議センター/.test(name) || b.heightM >= 26) {
    return {
      wallPlain: [176, 184, 194],
      wallIllus: [196, 208, 222],
      roofPlain: [188, 194, 202],
      roofIllus: [216, 222, 230],
      wallTag: "glass",
      roofTag: "concrete",
    };
  }

  const pal = GENERIC_PALETTES[Math.abs(b.osmId) % GENERIC_PALETTES.length]!;
  return {
    wallPlain: pal.wallPlain,
    wallIllus: pal.wallIllus,
    roofPlain: pal.roofPlain,
    roofIllus: pal.roofIllus,
    wallTag: pal.wallTag,
    roofTag: "concrete",
  };
}

function addRooftopDetails(
  triangles: SceneTriangle[],
  ringXY: ReadonlyArray<readonly [number, number]>,
  zTop: number,
  featureId: number,
): void {
  const box = fitOrientedBox(ringXY);
  if (box.lengthM < 14 || box.widthM < 10) return;

  const cos = Math.cos(box.angleRad);
  const sin = Math.sin(box.angleRad);
  const toWorld = (u: number, v: number): [number, number] => [
    box.cx + u * cos - v * sin,
    box.cy + u * sin + v * cos,
  ];

  // Penthouse / HVAC equipment volume safely inside roof polygon
  const hvLen = Math.min(8.5, box.lengthM * 0.24);
  const hvWid = Math.min(5.2, box.widthM * 0.24);
  const [hx, hy] = toWorld(box.lengthM * 0.18, -box.widthM * 0.14);
  const hvacRect = orientedRectXY(hx, hy, hvLen, hvWid, box.angleRad);
  if (hvacRect.every(([px, py]) => pointInRing(px, py, ringXY))) {
    addExtrudedPrism(
      triangles,
      hvacRect,
      zTop,
      zTop + 2.1,
      featureId,
      SURFACE_KIND.BUILDING,
      SURFACE_KIND.BUILDING,
      [172, 176, 182],
      [194, 198, 204],
      [148, 152, 158],
      [164, 170, 178],
      undefined,
      "concrete",
      "concrete",
    );
  }

  // Secondary vent box + slim solar/skylight array
  if (box.lengthM >= 24 && box.widthM >= 14) {
    const [sx, sy] = toWorld(-box.lengthM * 0.18, box.widthM * 0.12);
    const solarRect = orientedRectXY(sx, sy, Math.min(10, box.lengthM * 0.26), Math.min(4.2, box.widthM * 0.22), box.angleRad);
    if (solarRect.every(([px, py]) => pointInRing(px, py, ringXY))) {
      addExtrudedPrism(
        triangles,
        solarRect,
        zTop,
        zTop + 0.35,
        featureId,
        SURFACE_KIND.BUILDING,
        SURFACE_KIND.BUILDING,
        [82, 102, 126],
        [68, 96, 128],
        [118, 124, 132],
        [124, 132, 142],
        undefined,
        "glass",
        "concrete",
      );
    }
  }
}

function addClusteredTree(
  triangles: SceneTriangle[],
  x: number,
  y: number,
  scale: number,
  featureId: number,
  seed: number,
): void {
  const trunk = orientedRectXY(x, y, 0.85 * scale, 0.85 * scale, 0.4);
  addExtrudedPrism(
    triangles,
    trunk,
    2.0,
    2.0 + 2.3 * scale,
    featureId,
    SURFACE_KIND.VEGETATION,
    SURFACE_KIND.VEGETATION,
    [104, 82, 62],
    [114, 84, 58],
    [94, 72, 54],
    [104, 76, 52],
    undefined,
    "wood",
    "wood",
  );

  const ring = (cx: number, cy: number, r: number, n: number, rot: number) =>
    Array.from({ length: n }, (_, i) => {
      const a = rot + (i / n) * Math.PI * 2;
      return [cx + r * Math.cos(a), cy + r * Math.sin(a)] as [number, number];
    });

  const shift = (seed % 5) * 3;
  // Base deep olive lobe
  addExtrudedPrism(
    triangles,
    ring(x - 0.55 * scale, y - 0.35 * scale, 3.2 * scale, 7, seed * 0.3),
    2.0 + 1.9 * scale,
    2.0 + 4.4 * scale,
    featureId,
    SURFACE_KIND.VEGETATION,
    SURFACE_KIND.VEGETATION,
    [76 + shift, 124 + shift, 68],
    [76 + shift, 124 + shift, 58],
    [66 + shift, 108 + shift, 54],
    [66 + shift, 108 + shift, 52],
    undefined,
    "park",
    "park",
  );
  // Mid green lobe
  addExtrudedPrism(
    triangles,
    ring(x + 0.65 * scale, y + 0.45 * scale, 2.7 * scale, 7, seed * 0.7 + 0.4),
    2.0 + 2.5 * scale,
    2.0 + 5.2 * scale,
    featureId,
    SURFACE_KIND.VEGETATION,
    SURFACE_KIND.VEGETATION,
    [98 + shift, 148 + shift, 84],
    [112 + shift, 164 + shift, 68],
    [78 + shift, 126 + shift, 64],
    [88 + shift, 134 + shift, 60],
    undefined,
    "park",
    "park",
  );
  // Sunlit crown lobe
  addExtrudedPrism(
    triangles,
    ring(x + 0.1 * scale, y - 0.1 * scale, 1.9 * scale, 6, seed * 1.1),
    2.0 + 4.4 * scale,
    2.0 + 6.4 * scale,
    featureId,
    SURFACE_KIND.VEGETATION,
    SURFACE_KIND.VEGETATION,
    [118 + shift, 168 + shift, 96],
    [150 + shift, 194 + shift, 76],
    [98 + shift, 148 + shift, 76],
    [114 + shift, 160 + shift, 68],
    undefined,
    "park",
    "park",
  );
}

function addParkedCar(
  triangles: SceneTriangle[],
  x: number,
  y: number,
  angleRad: number,
  colorRgb: Rgb,
): void {
  addExtrudedPrism(
    triangles,
    orientedRectXY(x, y, 4.3, 1.8, angleRad),
    2.18,
    3.05,
    FEATURE_IDS.SHINKO_ISLAND,
    SURFACE_KIND.QUAY,
    SURFACE_KIND.QUAY,
    colorRgb,
    colorRgb,
    [Math.max(20, colorRgb[0] - 24), Math.max(20, colorRgb[1] - 24), Math.max(20, colorRgb[2] - 24)],
    [Math.max(20, colorRgb[0] - 24), Math.max(20, colorRgb[1] - 24), Math.max(20, colorRgb[2] - 24)],
    undefined,
    "concrete",
    "concrete",
  );
  addExtrudedPrism(
    triangles,
    orientedRectXY(x, y, 2.2, 1.5, angleRad),
    3.05,
    3.55,
    FEATURE_IDS.SHINKO_ISLAND,
    SURFACE_KIND.QUAY,
    SURFACE_KIND.QUAY,
    [224, 228, 232],
    [232, 234, 236],
    [76, 88, 102],
    [70, 84, 98],
    undefined,
    "glass",
    "glass",
  );
}

function addClosedRibbonBridge(
  out: SceneTriangle[],
  ringXY: ReadonlyArray<readonly [number, number]>,
  widthM: number,
  zSoffit: number,
  zDeck: number,
  zRail: number,
  featureId: number,
  deckId: string,
): { cx: number; cy: number; radiusM: number } {
  const n = ringXY.length;
  let sx = 0;
  let sy = 0;
  for (const [x, y] of ringXY) {
    sx += x;
    sy += y;
  }
  const cx = sx / n;
  const cy = sy / n;

  const halfW = widthM * 0.5;
  const innerPts: Array<[number, number]> = [];
  const outerPts: Array<[number, number]> = [];
  let sumR = 0;

  for (const [x, y] of ringXY) {
    const dx = x - cx;
    const dy = y - cy;
    const r = Math.hypot(dx, dy) || 1;
    sumR += r;
    const ux = dx / r;
    const uy = dy / r;
    innerPts.push([cx + ux * (r - halfW), cy + uy * (r - halfW)]);
    outerPts.push([cx + ux * (r + halfW), cy + uy * (r + halfW)]);
  }

  const deckPlain: Rgb = [194, 198, 204];
  const deckIllus: Rgb = [228, 214, 194];
  const sidePlain: Rgb = [164, 168, 176];
  const sideIllus: Rgb = [192, 178, 160];
  const railPlain: Rgb = [132, 138, 148];
  const railIllus: Rgb = [96, 114, 130];

  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    const i0 = innerPts[i]!;
    const i1 = innerPts[j]!;
    const o0 = outerPts[i]!;
    const o1 = outerPts[j]!;

    pushQuad(
      out,
      [i0[0], i0[1], zDeck],
      [o0[0], o0[1], zDeck],
      [o1[0], o1[1], zDeck],
      [i1[0], i1[1], zDeck],
      featureId,
      SURFACE_KIND.BRIDGE_DECK,
      deckPlain,
      deckIllus,
      deckId,
      "deck",
    );
    pushQuad(
      out,
      [o0[0], o0[1], zSoffit],
      [i0[0], i0[1], zSoffit],
      [i1[0], i1[1], zSoffit],
      [o1[0], o1[1], zSoffit],
      featureId,
      SURFACE_KIND.BRIDGE_DECK,
      sidePlain,
      sideIllus,
      deckId,
      "deck",
    );
    pushQuad(
      out,
      [o0[0], o0[1], zSoffit],
      [o1[0], o1[1], zSoffit],
      [o1[0], o1[1], zDeck],
      [o0[0], o0[1], zDeck],
      featureId,
      SURFACE_KIND.BRIDGE_DECK,
      sidePlain,
      sideIllus,
      deckId,
      "deck",
    );
    pushQuad(
      out,
      [o0[0], o0[1], zDeck],
      [o1[0], o1[1], zDeck],
      [o1[0], o1[1], zRail],
      [o0[0], o0[1], zRail],
      featureId,
      SURFACE_KIND.BRIDGE_DECK,
      railPlain,
      railIllus,
      deckId,
      "deck",
    );
    pushQuad(
      out,
      [i1[0], i1[1], zSoffit],
      [i0[0], i0[1], zSoffit],
      [i0[0], i0[1], zDeck],
      [i1[0], i1[1], zDeck],
      featureId,
      SURFACE_KIND.BRIDGE_DECK,
      sidePlain,
      sideIllus,
      deckId,
      "deck",
    );
    pushQuad(
      out,
      [i1[0], i1[1], zDeck],
      [i0[0], i0[1], zDeck],
      [i0[0], i0[1], zRail],
      [i1[0], i1[1], zRail],
      featureId,
      SURFACE_KIND.BRIDGE_DECK,
      railPlain,
      railIllus,
      deckId,
      "deck",
    );
  }

  return { cx, cy, radiusM: sumR / n };
}

export function buildShinkoOsmScene(osmPath: string): ShinkoSceneBundle {
  const osm = JSON.parse(readFileSync(osmPath, "utf8")) as OsmShinkoDataset;
  const camera = createShinkoPilotCamera();
  const triangles: SceneTriangle[] = [];
  const toXY = (lon: number, lat: number): [number, number] => {
    const v = wgs84ToLocal(camera, lon, lat, 0);
    return [v[0], v[1]];
  };

  // 1. Wide harbor water base (+/- 2200m) -> zero VOID pixels
  const wSize = 2200;
  pushQuad(
    triangles,
    [-wSize, -wSize, 0],
    [wSize, -wSize, 0],
    [wSize, wSize, 0],
    [-wSize, wSize, 0],
    FEATURE_IDS.HARBOR_WATER,
    SURFACE_KIND.WATER,
    [68, 122, 160],
    [34, 98, 118],
    undefined,
    "water",
  );

  // 2. Real OSM Coastline -> Closed Land Polygon (OSM coastline has land on its LEFT)
  const landPolygonsLocal: Array<Array<[number, number]>> = [];
  const mainCoast = osm.coastlineChains[0];
  if (mainCoast && mainCoast.length >= 4) {
    const coastXY = decimatePolyline(mainCoast.map(([lon, lat]) => toXY(lon, lat)), 1.2);
    // Vertical seawalls along exact coastline
    for (let i = 0; i < coastXY.length - 1; i++) {
      const a = coastXY[i]!;
      const b = coastXY[i + 1]!;
      pushQuad(
        triangles,
        [a[0], a[1], 0],
        [b[0], b[1], 0],
        [b[0], b[1], 2.0],
        [a[0], a[1], 2.0],
        FEATURE_IDS.SHINKO_ISLAND,
        SURFACE_KIND.QUAY,
        [136, 132, 126],
        [120, 116, 110],
        undefined,
        "quay",
      );
    }

    // Close the inland side well outside the 3968x3968 camera frame (CCW: SE -> NW along coast, then NW -> SW -> SE back)
    const landRing: Array<[number, number]> = [
      ...coastXY,
      [-2300, 1800],
      [-2300, -2300],
      [1800, -2300],
    ];
    earClipOrFanPolygon(
      triangles,
      landRing,
      2.0,
      FEATURE_IDS.SHINKO_ISLAND,
      SURFACE_KIND.GROUND,
      [212, 206, 192],
      [228, 221, 206],
      "ground-road",
      "concrete",
    );
    landPolygonsLocal.push(landRing);
  }

  // 3. Real OSM Piers & Breakwaters (Osanbashi, Red Brick Pier, etc.)
  for (const pier of osm.piers) {
    const ringXY = pier.ring.map(([lon, lat]) => toXY(lon, lat));
    addExtrudedPrism(
      triangles,
      ringXY,
      0,
      2.2,
      FEATURE_IDS.OSANBASHI_APPROACH,
      SURFACE_KIND.QUAY,
      SURFACE_KIND.QUAY,
      [194, 188, 178],
      [194, 158, 118],
      [130, 126, 118],
      [122, 116, 108],
      "ground-road",
      "wood",
      "quay",
    );
    landPolygonsLocal.push(ringXY);
  }

  // 4. Inland Water Ponds / Basins
  for (const w of osm.waterPolygons) {
    const ringXY = w.ring.map(([lon, lat]) => toXY(lon, lat));
    earClipOrFanPolygon(
      triangles,
      ringXY,
      2.04,
      FEATURE_IDS.HARBOR_WATER,
      SURFACE_KIND.WATER,
      [68, 122, 160],
      [34, 98, 118],
      undefined,
      "water",
    );
  }

  // 5. Real OSM Parks & Greenery
  for (const park of osm.parks) {
    const ringXY = decimatePolyline(park.ring.map(([lon, lat]) => toXY(lon, lat)), 1.0);
    if (ringXY.length < 3) continue;
    earClipOrFanPolygon(
      triangles,
      ringXY,
      2.08,
      FEATURE_IDS.AKARENGA_PARK,
      SURFACE_KIND.VEGETATION,
      [120, 160, 108],
      [124, 178, 92],
      undefined,
      "park",
    );
  }

  // 6. Real OSM Roads, Sidewalks & Elevated Bridges
  let cwMetrics: { cx: number; cy: number; radiusM: number; ring: Array<[number, number]> } | null = null;
  let kokusaiUnit: [number, number] = [0.76, -0.65];

  for (const r of osm.roads) {
    if (r.highway === "steps" || r.highway === "elevator") continue;
    const pts = r.coords.map(([lon, lat]) => toXY(lon, lat));
    if (pts.length < 2) continue;

    // Shinko Circle Walk (way 72666339)
    if (r.osmId === 72666339 || /サークルウォーク/.test(r.nameJa)) {
      const closedRing = pts.slice(0, -1);
      if (closedRing.length >= 8) {
        const res = addClosedRibbonBridge(
          triangles,
          closedRing,
          5.8,
          5.8,
          6.9,
          8.0,
          FEATURE_IDS.CIRCLE_WALK,
          "circle-walk-deck",
        );
        cwMetrics = { ...res, ring: closedRing };
        // Four support piers placed off the road carriageways
        for (const ang of [0.35, 1.92, 3.49, 5.06]) {
          const px = cwMetrics.cx + (cwMetrics.radiusM + 1.8) * Math.cos(ang);
          const py = cwMetrics.cy + (cwMetrics.radiusM + 1.8) * Math.sin(ang);
          addExtrudedPrism(
            triangles,
            orientedRectXY(px, py, 2.0, 2.0, ang),
            2.0,
            5.8,
            FEATURE_IDS.CIRCLE_WALK,
            SURFACE_KIND.BRIDGE_SUPPORT,
            SURFACE_KIND.BRIDGE_SUPPORT,
            [152, 156, 162],
            [166, 158, 146],
            [142, 146, 152],
            [156, 148, 138],
            undefined,
            "concrete",
            "concrete",
          );
        }
      }
      continue;
    }

    // Elevated pedestrian bridges (Hammerhead Walk, Kishamichi, Goddess Bridge, etc.)
    if (r.bridge && r.layer >= 1) {
      const isKisha = /汽車道/.test(r.nameJa);
      const zSoffit = isKisha ? 2.4 : 5.2;
      const zDeck = isKisha ? 3.4 : 6.1;
      for (let i = 0; i < pts.length - 1; i++) {
        const a = pts[i]!;
        const b = pts[i + 1]!;
        const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
        if (len < 0.5) continue;
        const ang = Math.atan2(b[1] - a[1], b[0] - a[0]);
        addExtrudedPrism(
          triangles,
          orientedRectXY((a[0] + b[0]) * 0.5, (a[1] + b[1]) * 0.5, len + 0.6, Math.max(4.0, r.widthM), ang),
          zSoffit,
          zDeck,
          isKisha ? FEATURE_IDS.KISHAMICHI : FEATURE_IDS.CIRCLE_WALK,
          SURFACE_KIND.BRIDGE_DECK,
          SURFACE_KIND.BRIDGE_DECK,
          [184, 178, 168],
          isKisha ? [176, 136, 98] : [224, 212, 194],
          [148, 144, 138],
          [178, 166, 150],
          "pedestrian-promenade",
          isKisha ? "wood" : "deck",
          "concrete",
        );
      }
      continue;
    }

    const isWalk = r.highway === "footway" || r.highway === "pedestrian" || r.highway === "path" || r.highway === "cycleway";
    if (isWalk) {
      for (let i = 0; i < pts.length - 1; i++) {
        addRoadStrip(
          triangles,
          pts[i]!,
          pts[i + 1]!,
          r.widthM,
          2.11,
          FEATURE_IDS.SHINKO_ISLAND,
          [194, 188, 178],
          [224, 216, 200],
        );
      }
    } else {
      for (let i = 0; i < pts.length - 1; i++) {
        const a = pts[i]!;
        const b = pts[i + 1]!;
        addRoadStrip(
          triangles,
          a,
          b,
          r.widthM + 4.5,
          2.10,
          FEATURE_IDS.SHINKO_ISLAND,
          [194, 190, 182],
          [232, 225, 210],
        );
        addRoadStrip(
          triangles,
          a,
          b,
          r.widthM,
          2.16,
          FEATURE_IDS.KOKUSAI_ODORI,
          [88, 94, 102],
          [146, 142, 135],
        );
        if (r.widthM >= 10 && Math.hypot(b[0] - a[0], b[1] - a[1]) >= 18) {
          addRoadMarkings(triangles, a, b, r.widthM, 2.18, FEATURE_IDS.KOKUSAI_ODORI);
        }
      }
    }
  }

  // Derive Kokusai-Odori tangent directly through Circle Walk center from OSM Kokusai-Odori segments
  if (cwMetrics) {
    let bestDist = Infinity;
    for (const r of osm.roads) {
      if (!/国際大通り/.test(r.nameJa)) continue;
      const pts = r.coords.map(([lon, lat]) => toXY(lon, lat));
      for (let i = 0; i < pts.length - 1; i++) {
        const a = pts[i]!;
        const b = pts[i + 1]!;
        const mx = (a[0] + b[0]) * 0.5;
        const my = (a[1] + b[1]) * 0.5;
        const d = Math.hypot(mx - cwMetrics.cx, my - cwMetrics.cy);
        if (d < bestDist) {
          const dx = b[0] - a[0];
          const dy = b[1] - a[1];
          const len = Math.hypot(dx, dy);
          if (len > 4) {
            bestDist = d;
            // Normalize to point NW -> SE (+dx, -dy)
            kokusaiUnit = dx >= 0 ? [dx / len, dy / len] : [-dx / len, -dy / len];
          }
        }
      }
    }
  }

  // 8. Real OSM Buildings (281 buildings + multipolygons + 3D parts) & Feature Registry
  const features: SceneFeatureRecord[] = [...SHINKO_FEATURES];
  const buildingRingsLocal: Array<Array<[number, number]>> = [];
  let nextFeatureId = 100;
  let rb2Fit: ReturnType<typeof fitOrientedBox> | null = null;
  let rb1Fit: ReturnType<typeof fitOrientedBox> | null = null;
  let wpFit: ReturnType<typeof fitOrientedBox> | null = null;
  let cnFit: ReturnType<typeof fitOrientedBox> | null = null;
  let jicaFit: ReturnType<typeof fitOrientedBox> | null = null;
  let icFit: ReturnType<typeof fitOrientedBox> | null = null;
  let hhApprox: [number, number] | null = null;

  for (const b of osm.buildings) {
    const ringXY = decimatePolyline(b.ring.map(([lon, lat]) => toXY(lon, lat)), 0.5);
    if (ringXY.length < 3) continue;
    buildingRingsLocal.push(ringXY);

    let fid: number;
    if (b.osmId === 72998296) fid = FEATURE_IDS.RED_BRICK_2;
    else if (b.osmId === 72998303) fid = FEATURE_IDS.RED_BRICK_1;
    else if (b.osmId === 72665070) fid = FEATURE_IDS.WORLD_PORTERS;
    else if (b.osmId === 72970880) fid = FEATURE_IDS.CUPNOODLES_MUSEUM;
    else if (b.osmId === 72666337) fid = FEATURE_IDS.JICA_YOKOHAMA;
    else if (b.osmId === 11066652 || /横浜ハンマーヘッド|yokohama hammerhead/i.test(`${b.nameJa} ${b.nameEn}`)) {
      fid = FEATURE_IDS.HAMMERHEAD;
    } else {
      fid = nextFeatureId++;
      if (b.nameJa || b.nameEn) {
        features.push({
          featureId: fid,
          slug: `osm-bldg-${b.osmId}`,
          nameJa: b.nameJa || b.nameEn,
          nameEn: b.nameEn || b.nameJa,
          surfaceKind: SURFACE_KIND.BUILDING,
          heightM: b.heightM,
          source: "OpenStreetMap (ODbL)",
          notes: b.buildingType !== "yes" ? `building=${b.buildingType}` : "OpenStreetMap building footprint",
          osmId: b.osmId,
          levels: b.levels,
          address: b.address,
          googleMapsUrl: `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${b.nameJa || b.nameEn} 横浜`)}`,
          lon: b.center[0],
          lat: b.center[1],
        });
      }
    }

    const style = chooseBuildingStyle(b);
    const zBot = 2.0 + b.minHeightM;
    const zTop = Math.max(zBot + 2.5, 2.0 + b.heightM);

    // Gabled heritage architectural treatment for Red Brick Warehouses #1 & #2
    if (b.osmId === 72998296 || b.osmId === 72998303) {
      const box = fitOrientedBox(ringXY);
      if (b.osmId === 72998296) rb2Fit = box;
      else rb1Fit = box;
      const zEave = 14.8;
      const zRidge = 20.0;
      addGabledBuilding(
        triangles,
        box.cx,
        box.cy,
        box.lengthM,
        box.widthM,
        box.angleRad,
        2.0,
        zEave,
        zRidge,
        fid,
        style.wallPlain,
        style.wallIllus,
        style.roofPlain,
        style.roofIllus,
        "brick",
        "roof",
      );
      addExtrudedPrism(
        triangles,
        orientedRectXY(box.cx, box.cy, box.lengthM + 14, box.widthM + 12, box.angleRad),
        2.0,
        2.09,
        FEATURE_IDS.AKARENGA_PARK,
        SURFACE_KIND.QUAY,
        SURFACE_KIND.QUAY,
        [184, 152, 134],
        [198, 154, 128],
        [164, 136, 120],
        [176, 138, 114],
        undefined,
        "sidewalk",
        "sidewalk",
      );
      addExtrudedPrism(
        triangles,
        orientedRectXY(box.cx, box.cy, box.lengthM + 0.8, box.widthM + 0.8, box.angleRad),
        14.1,
        14.9,
        fid,
        SURFACE_KIND.BUILDING,
        SURFACE_KIND.BUILDING,
        [224, 218, 206],
        [238, 232, 220],
        [214, 208, 196],
        [228, 222, 208],
        undefined,
        "concrete",
        "concrete",
      );
      continue;
    }

    if (b.osmId === 72665070) wpFit = fitOrientedBox(ringXY);
    if (b.osmId === 72970880) cnFit = fitOrientedBox(ringXY);
    if (b.osmId === 72666337) jicaFit = fitOrientedBox(ringXY);
    if (b.osmId === 57932445) icFit = fitOrientedBox(ringXY);
    if (/ハンマーヘッド|hammerhead/i.test(`${b.nameJa} ${b.nameEn}`) && !hhApprox) {
      const fit = fitOrientedBox(ringXY);
      hhApprox = [fit.cx, fit.cy];
    }

    if (b.holes && b.holes.length > 0) {
      const holesXY = b.holes
        .map((h) => decimatePolyline(h.map(([lon, lat]) => toXY(lon, lat)), 0.5))
        .filter((h) => h.length >= 3);
      addExtrudedBuildingWithHoles(triangles, ringXY, holesXY, zBot, zTop, fid, style);
    } else {
      addExtrudedPrism(
        triangles,
        ringXY,
        zBot,
        zTop,
        fid,
        SURFACE_KIND.BUILDING,
        SURFACE_KIND.BUILDING,
        style.roofPlain,
        style.roofIllus,
        style.wallPlain,
        style.wallIllus,
        undefined,
        style.roofTag,
        style.wallTag,
      );
      if (b.heightM >= 6 && !b.isPart) {
        addRooftopDetails(triangles, ringXY, zTop, fid);
      }
    }
  }

  // 7b. Real OSM Trees + Promenade Trees strictly clipped to dry land & outside building footprints
  const treeStep = Math.max(1, Math.floor(osm.trees.length / 240));
  for (let i = 0; i < osm.trees.length; i += treeStep) {
    const [tlon, tlat] = osm.trees[i]!;
    const [tx, ty] = toXY(tlon, tlat);
    if (isStrictlyOnLand(tx, ty, landPolygonsLocal, 2.5) && !isInsideAnyBuilding(tx, ty, buildingRingsLocal)) {
      addClusteredTree(triangles, tx, ty, 0.9, FEATURE_IDS.AKARENGA_PARK, i);
    }
  }
  const curatedTreeCoords: ReadonlyArray<readonly [number, number]> = [
    [139.64015, 35.45435],
    [139.63992, 35.45452],
    [139.63970, 35.45468],
    [139.64148, 35.45505],
    [139.64168, 35.45522],
    [139.64262, 35.45582],
    [139.64292, 35.45562],
    [139.64132, 35.45352],
    [139.64155, 35.45334],
  ];
  curatedTreeCoords.forEach(([tlon, tlat], i) => {
    const [tx, ty] = toXY(tlon, tlat);
    if (isStrictlyOnLand(tx, ty, landPolygonsLocal, 2.5) && !isInsideAnyBuilding(tx, ty, buildingRingsLocal)) {
      addClusteredTree(triangles, tx, ty, 0.92, FEATURE_IDS.AKARENGA_PARK, 100 + i);
    }
  });

  // 9. Exact 1914 Hammerhead Crane (OSM node 9196914799) & Open-Water Ships + Harbor Sailboats
  const craneLonLat = osm.cranes?.[0]
    ? ([osm.cranes[0].lon, osm.cranes[0].lat] as const)
    : ([139.6426865, 35.45691] as const);
  const cranePos = toXY(craneLonLat[0], craneLonLat[1]);
  void hhApprox;
  addExtrudedPrism(
    triangles,
    orientedRectXY(cranePos[0], cranePos[1], 11, 11, -0.5),
    2.0,
    25.0,
    FEATURE_IDS.HAMMERHEAD,
    SURFACE_KIND.BUILDING,
    SURFACE_KIND.BUILDING,
    [194, 122, 68],
    [218, 126, 60],
    [172, 104, 56],
    [194, 112, 52],
    undefined,
    "crane",
    "crane",
  );
  addExtrudedPrism(
    triangles,
    orientedRectXY(cranePos[0] + 4, cranePos[1] + 5, 34, 6.0, 0.72),
    24.5,
    28.0,
    FEATURE_IDS.HAMMERHEAD,
    SURFACE_KIND.BUILDING,
    SURFACE_KIND.BUILDING,
    [202, 130, 74],
    [224, 134, 66],
    [176, 108, 58],
    [198, 116, 54],
    undefined,
    "crane",
    "crane",
  );

  // Berth vessels strictly in OPEN WATER (verified against landPolygonsLocal):
  // 1) Asuka II cruise liner alongside Hammerhead Berth 9 NW open quay
  const asukaCenterXY = placeVesselAlongsideQuay(
    triangles,
    landPolygonsLocal,
    toXY(139.64140, 35.45644),
    toXY(139.64208, 35.45734),
    112,
    18,
    FEATURE_IDS.CRUISE_SHIP_ASUKA,
    true,
  );
  const asukaWgs = localToWgs84(camera, [asukaCenterXY[0], asukaCenterXY[1], 3.5]);

  // 2) Coast Guard Patrol Vessel #1 alongside Coast Guard NW pier face (open basin)
  placeVesselAlongsideQuay(
    triangles,
    landPolygonsLocal,
    toXY(139.64445, 35.45621),
    toXY(139.64541, 35.45741),
    56,
    10,
    FEATURE_IDS.COAST_GUARD_VESSEL,
    false,
  );

  // 3) Coast Guard Patrol Vessel #2 alongside Coast Guard NE finger pier
  placeVesselAlongsideQuay(
    triangles,
    landPolygonsLocal,
    toXY(139.64552, 35.45734),
    toXY(139.64645, 35.45718),
    50,
    9.5,
    FEATURE_IDS.COAST_GUARD_VESSEL,
    false,
  );

  for (const [slon, slat, sAng] of [
    [139.6448, 35.4582, 0.7],
    [139.6416, 35.4584, 2.1],
  ] as const) {
    const sxy = toXY(slon, slat);
    if (!isOnAnyLand(sxy[0], sxy[1], landPolygonsLocal)) {
      addSailboat(triangles, sxy[0], sxy[1], sAng, FEATURE_IDS.HARBOR_WATER);
    }
  }

  // Tiny parked cars strictly on dry land & outside buildings/bus corridor
  const carColors: ReadonlyArray<Rgb> = [
    [232, 234, 236],
    [76, 84, 96],
    [168, 174, 182],
    [186, 72, 64],
    [78, 118, 162],
    [216, 176, 74],
  ];
  const parkedSpots: ReadonlyArray<readonly [number, number, number]> = [
    [139.64195, 35.45198, 0.2],
    [139.64205, 35.45192, 0.2],
    [139.64215, 35.45186, 0.2],
    [139.64225, 35.45180, 0.2],
    [139.64235, 35.45174, 0.2],
    [139.64245, 35.45168, 0.2],
    [139.64225, 35.45572, 0.95],
    [139.64235, 35.45564, 0.95],
    [139.64245, 35.45556, 0.95],
    [139.64015, 35.45478, -0.58],
    [139.64002, 35.45488, -0.58],
    [139.63989, 35.45498, -0.58],
    [139.63845, 35.45438, 0.95],
    [139.63834, 35.45428, 0.95],
    [139.63823, 35.45418, 0.95],
    [139.64112, 35.45295, 0.98],
    [139.64102, 35.45305, 0.98],
  ];
  parkedSpots.forEach(([clon, clat, ang], i) => {
    const [cx, cy] = toXY(clon, clat);
    if (isStrictlyOnLand(cx, cy, landPolygonsLocal, 2.5) && !isInsideAnyBuilding(cx, cy, buildingRingsLocal)) {
      addParkedCar(triangles, cx, cy, ang, carColors[i % carColors.length]!);
    }
  });

  // 10. Synthetic Bayside Blue Trajectory anchored strictly to real OSM Circle Walk & Red Brick #2
  const cw = cwMetrics ?? { cx: toXY(139.64052, 35.45382)[0], cy: toXY(139.64052, 35.45382)[1], radiusM: 29.0, ring: [] as Array<[number, number]> };
  const rb2 = rb2Fit ?? { cx: toXY(139.64273, 35.45258)[0], cy: toXY(139.64273, 35.45258)[1], lengthM: 145, widthM: 22, angleRad: 0.19 };
  const rb1 = rb1Fit ?? { cx: toXY(139.64341, 35.45214)[0], cy: toXY(139.64341, 35.45214)[1], lengthM: 76, widthM: 22, angleRad: 0.19 };

  // Compute exact distances along kokusaiUnit where the camera ray from bus roof (+5.4m) hits the Circle Walk ring (+6.9m)
  let sNwUnder = -28.0;
  let sSeUnder = 28.0;
  if (cw.ring.length >= 8) {
    // Ray from bus roof (z=5.4) to deck (z=6.9) offsets (+1.06, +1.06) in XY
    const rayOx = cw.cx + 1.06;
    const rayOy = cw.cy + 1.06;
    const hits: number[] = [];
    for (let i = 0; i < cw.ring.length; i++) {
      const p = cw.ring[i]!;
      const q = cw.ring[(i + 1) % cw.ring.length]!;
      const ex = q[0] - p[0];
      const ey = q[1] - p[1];
      const denom = kokusaiUnit[0] * ey - kokusaiUnit[1] * ex;
      if (Math.abs(denom) < 1e-6) continue;
      const dx = p[0] - rayOx;
      const dy = p[1] - rayOy;
      const s = (dx * ey - dy * ex) / denom;
      const u = (dx * kokusaiUnit[1] - dy * kokusaiUnit[0]) / denom;
      if (u >= 0 && u <= 1) hits.push(s);
    }
    const negHits = hits.filter((s) => s < -5);
    const posHits = hits.filter((s) => s > 5);
    if (negHits.length > 0) sNwUnder = negHits[0]!;
    if (posHits.length > 0) sSeUnder = posHits[0]!;
  }

  const bearingFromVec = (dx: number, dy: number) =>
    ((Math.atan2(dx, dy) * 180) / Math.PI + 360) % 360;
  const bKokusai = bearingFromVec(kokusaiUnit[0], kokusaiUnit[1]);
  const rbBehindX = rb2.cx - 8.0;
  const rbBehindY = rb2.cy - 15.5;
  const plazaVisX = (rb2.cx + rb1.cx) * 0.5 + 32;
  const plazaVisY = rb1.cy - 22;

  const turnPt: [number, number] = [cw.cx + kokusaiUnit[0] * 85, cw.cy + kokusaiUnit[1] * 85];
  const rbApproach: [number, number] = [rb2.cx - 88, rb2.cy - 28];

  const rawWaypoints = [
    {
      timeSec: 0,
      x: cw.cx - kokusaiUnit[0] * 64,
      y: cw.cy - kokusaiUnit[1] * 64,
      bearingDeg: bKokusai,
      noteJa: "国際大通りを北西から接近中（可視）",
      noteEn: "Approaching real Circle Walk from NW (visible)",
    },
    {
      timeSec: 6,
      x: cw.cx + kokusaiUnit[0] * sNwUnder,
      y: cw.cy + kokusaiUnit[1] * sNwUnder,
      bearingDeg: bKokusai,
      noteJa: "新港サークルウォーク北西デッキ直下（遮蔽）",
      noteEn: "Underneath Circle Walk NW ring (occluded)",
    },
    {
      timeSec: 10,
      x: cw.cx,
      y: cw.cy,
      bearingDeg: bKokusai,
      noteJa: "新港サークルウォーク中央吹き抜け（可視）",
      noteEn: "Inside Circle Walk open courtyard (visible)",
    },
    {
      timeSec: 14,
      x: cw.cx + kokusaiUnit[0] * sSeUnder,
      y: cw.cy + kokusaiUnit[1] * sSeUnder,
      bearingDeg: bKokusai,
      noteJa: "新港サークルウォーク南東デッキ直下（遮蔽）",
      noteEn: "Underneath Circle Walk SE ring (occluded)",
    },
    {
      timeSec: 20,
      x: cw.cx + kokusaiUnit[0] * 64,
      y: cw.cy + kokusaiUnit[1] * 64,
      bearingDeg: bKokusai,
      noteJa: "新港サークルウォーク通過後（可視）",
      noteEn: "Exited Circle Walk toward SE (visible)",
    },
    {
      timeSec: 28,
      x: turnPt[0],
      y: turnPt[1],
      bearingDeg: bearingFromVec(rbApproach[0] - turnPt[0], rbApproach[1] - turnPt[1]),
      noteJa: "赤レンガ倉庫方面へ左折",
      noteEn: "Turning toward Red Brick Warehouse",
    },
    {
      timeSec: 36,
      x: rbApproach[0],
      y: rbApproach[1],
      bearingDeg: bearingFromVec(rbBehindX - rbApproach[0], rbBehindY - rbApproach[1]),
      noteJa: "赤レンガパーク通りへ進入",
      noteEn: "Entering Red Brick Warehouse Street",
    },
    {
      timeSec: 46,
      x: rbBehindX,
      y: rbBehindY,
      bearingDeg: bearingFromVec(plazaVisX - rbBehindX, plazaVisY - rbBehindY),
      noteJa: "赤レンガ倉庫2号館の裏を通過中（建物により遮蔽）",
      noteEn: "Passing behind Red Brick Warehouse No. 2 (occluded)",
    },
    {
      timeSec: 56,
      x: plazaVisX,
      y: plazaVisY,
      bearingDeg: bearingFromVec(plazaVisX - rbBehindX, plazaVisY - rbBehindY),
      noteJa: "赤レンガ倉庫1号館前で再び可視",
      noteEn: "Emerging past Red Brick No. 2 into open plaza (visible)",
    },
  ];

  const syntheticKeyframes: VehicleKeyframe[] = rawWaypoints.map((w) => {
    const pt = localToWgs84(camera, [w.x, w.y, 2.2]);
    return {
      timeSec: w.timeSec,
      lon: pt.lon,
      lat: pt.lat,
      bearingDeg: w.bearingDeg,
      roadElevationM: 2.2,
      deckId: "ground-road",
      noteJa: w.noteJa,
      noteEn: w.noteEn,
    };
  });

  // 11. Deck verification point strictly on real OSM Circle Walk deck (+6.9m)
  const deckRingPt = cw.ring[0] ?? [cw.cx, cw.cy + cw.radiusM];
  const deckPtLocal: Vec3 = [deckRingPt[0], deckRingPt[1], 6.9];
  const deckPtWgs = localToWgs84(camera, deckPtLocal);

  // 12. 8 Ground Control Points strictly anchored to real OSM features
  // Ensure West/NW ridge end is strictly on the positive-px side (> 2048) and East/SE ridge end is on the negative-px side (< 1920)
  const rb2DirSign = Math.cos(rb2.angleRad) >= 0 ? 1 : -1;
  const rb2EastDx = rb2DirSign * Math.cos(rb2.angleRad);
  const rb2EastDy = rb2DirSign * Math.sin(rb2.angleRad);
  const cwRimA = cw.ring[0] ?? [cw.cx, cw.cy + cw.radiusM];
  const cwRimB = cw.ring[Math.floor(cw.ring.length / 2)] ?? [cw.cx, cw.cy - cw.radiusM];
  const gcpRaw: Array<{
    id: string;
    featureId: number;
    labelJa: string;
    labelEn: string;
    local: Vec3;
    kind: string;
  }> = [
    {
      id: "gcp-cw-north",
      featureId: FEATURE_IDS.CIRCLE_WALK,
      labelJa: "サークルウォーク北西デッキ上端",
      labelEn: "Circle Walk NW Deck Rim",
      local: [cwRimA[0], cwRimA[1], 6.9],
      kind: "bridge-deck",
    },
    {
      id: "gcp-cw-south",
      featureId: FEATURE_IDS.CIRCLE_WALK,
      labelJa: "サークルウォーク南東デッキ上端",
      labelEn: "Circle Walk SE Deck Rim",
      local: [cwRimB[0], cwRimB[1], 6.9],
      kind: "bridge-deck",
    },
    {
      id: "gcp-rb2-nw",
      featureId: FEATURE_IDS.RED_BRICK_2,
      labelJa: "赤レンガ倉庫2号館 西側棟頂",
      labelEn: "Red Brick Warehouse No. 2 West Ridge",
      local: [rb2.cx - rb2EastDx * 62, rb2.cy - rb2EastDy * 62, 20.0],
      kind: "building-ridge",
    },
    {
      id: "gcp-rb2-se",
      featureId: FEATURE_IDS.RED_BRICK_2,
      labelJa: "赤レンガ倉庫2号館 東側棟頂",
      labelEn: "Red Brick Warehouse No. 2 East Ridge",
      local: [rb2.cx + rb2EastDx * 62, rb2.cy + rb2EastDy * 62, 20.0],
      kind: "building-ridge",
    },
    {
      id: "gcp-rb1-center",
      featureId: FEATURE_IDS.RED_BRICK_1,
      labelJa: "赤レンガ倉庫1号館 棟頂中央",
      labelEn: "Red Brick Warehouse No. 1 Ridge Center",
      local: [rb1.cx, rb1.cy, 20.0],
      kind: "building-ridge",
    },
    {
      id: "gcp-world-porters",
      featureId: FEATURE_IDS.WORLD_PORTERS,
      labelJa: "ワールドポーターズ屋上中央",
      labelEn: "World Porters Roof Center",
      local: [wpFit ? wpFit.cx : cw.cx - 120, wpFit ? wpFit.cy : cw.cy, 24.8],
      kind: "building-roof",
    },
    {
      id: "gcp-cupnoodles",
      featureId: FEATURE_IDS.CUPNOODLES_MUSEUM,
      labelJa: "カップヌードルミュージアム屋上",
      labelEn: "Cup Noodles Museum Roof",
      local: [cnFit ? cnFit.cx : cw.cx - 160, cnFit ? cnFit.cy : cw.cy + 180, 21.0],
      kind: "building-roof",
    },
    {
      id: "gcp-jica",
      featureId: FEATURE_IDS.JICA_YOKOHAMA,
      labelJa: "JICA横浜屋上中央",
      labelEn: "JICA Yokohama Roof Center",
      local: [jicaFit ? jicaFit.cx : cw.cx, jicaFit ? jicaFit.cy : cw.cy + 75, 13.0],
      kind: "building-roof",
    },
  ];
  void icFit;

  const gcps: GroundControlPoint[] = gcpRaw.map((g) => {
    const wgs = localToWgs84(camera, g.local);
    return {
      id: g.id,
      featureId: g.featureId,
      labelJa: g.labelJa,
      labelEn: g.labelEn,
      lon: wgs.lon,
      lat: wgs.lat,
      elevationM: g.local[2],
      kind: g.kind,
    };
  });

  // 13. Landmarks extracted from Tier-1 OSM POIs + mapped feature IDs
  const landmarks: Landmark[] = osm.pois
    .filter((p) => p.tier === 1)
    .slice(0, 14)
    .map((p) => {
      const matchedFeat = features.find((f) => f.osmId === p.osmId);
      let cat: Landmark["category"] = "landmark";
      if (p.category === "bridge") cat = "bridge";
      else if (p.category === "pier") cat = "pier";
      else if (p.category === "park") cat = "park";
      return {
        id: p.id,
        featureId: matchedFeat?.featureId ?? FEATURE_IDS.SHINKO_ISLAND,
        nameJa: p.nameJa,
        nameEn: p.nameEn,
        category: cat,
        lon: p.lon,
        lat: p.lat,
        elevationM: p.elevationM,
        descriptionJa: p.descriptionJa,
        descriptionEn: p.descriptionEn,
        sourceKind: "osm-odbl",
        address: p.address,
        heightM: p.heightM,
        levels: p.levels,
        googleMapsUrl: p.googleMapsUrl,
        tier: p.tier,
      };
    });

  const portCalls: PortCallRecord[] = [
    {
      id: "portcall-shinko-berth9",
      vesselNameJa: "飛鳥Ⅱ（入港予定）",
      vesselNameEn: "Asuka II (Scheduled Call)",
      berthJa: "新港ふ頭9号岸壁（ハンマーヘッド）",
      berthEn: "Shinko Pier Berth 9 (Hammerhead)",
      lon: Number(asukaWgs.lon.toFixed(6)),
      lat: Number(asukaWgs.lat.toFixed(6)),
      arrivalTime: "2026-11-24T09:00:00+09:00",
      departureTime: "2026-11-24T17:00:00+09:00",
      mode: "scheduled",
      source: "Yokohama Port Scheduled Calls (Fixture)",
    },
  ];

  return {
    camera,
    triangles,
    landmarks,
    gcps,
    syntheticKeyframes,
    syntheticLoopDurationSec: 58,
    deckTestPoint: {
      lon: deckPtWgs.lon,
      lat: deckPtWgs.lat,
      elevationM: 6.9,
      deckId: "circle-walk-deck",
    },
    portCalls,
    landPolygonsLocal,
    features,
    pois: osm.pois,
    osmAttribution: osm.meta.attribution,
  };
}
