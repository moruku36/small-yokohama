import {
  wgs84ToLocal,
  localToImage,
  type CameraManifest,
  type GroundControlPoint,
  type VehicleRecord,
} from "@small-yokohama/core";
import type { ResolvedAirCabinGondola } from "../data/airCabinFeed.js";
import {
  AIR_CABIN_LATERAL_HALF_M,
  AIR_CABIN_PYLONS,
  AIR_CABIN_TERMINALS,
  sampleAirCabinCable,
} from "../data/airCabinFeed.js";
import {
  COSMO_CLOCK_ORIGIN,
  type CosmoClockVisualState,
} from "../data/cosmoClock.js";
import type { PlaneMeshKind, ResolvedPlane } from "../data/planeFeed.js";
import type { LoadedTilePixels } from "../data/releaseLoader.js";
import type { AmbientCarInstance } from "../data/trafficFeed.js";
import type { RailLineId, ResolvedTrain } from "../data/trainFeed.js";
import type {
  AnimatedPortCall,
  ResolvedVehicle,
  VesselKind,
} from "../data/vehicleFeed.js";
import {
  CARLIGHT_FRAG,
  CARLIGHT_VERT,
  CLOUD_FRAG,
  COSMO_FRAG,
  COSMO_VERT,
  FULLSCREEN_VERT,
  MARKER_FRAG,
  MARKER_VERT,
  OVERLAY_FRAG,
  PEDESTRIAN_FRAG,
  PEDESTRIAN_VERT,
  RAIN_FRAG,
  RAIN_VERT,
  STREETLAMP_FRAG,
  STREETLAMP_VERT,
  VEHICLE_FRAG,
  VEHICLE_VERT,
} from "./shaders.js";

function compileShader(gl: WebGL2RenderingContext, type: number, source: string): WebGLShader {
  const shader = gl.createShader(type);
  if (!shader) throw new Error("Failed to create WebGL shader");
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    const log = gl.getShaderInfoLog(shader) ?? "unknown";
    gl.deleteShader(shader);
    throw new Error(`Shader compile error: ${log}`);
  }
  return shader;
}

function linkProgram(gl: WebGL2RenderingContext, vertSrc: string, fragSrc: string): WebGLProgram {
  const vs = compileShader(gl, gl.VERTEX_SHADER, vertSrc);
  const fs = compileShader(gl, gl.FRAGMENT_SHADER, fragSrc);
  const prog = gl.createProgram();
  if (!prog) throw new Error("Failed to create WebGL program");
  gl.attachShader(prog, vs);
  gl.attachShader(prog, fs);
  gl.linkProgram(prog);
  gl.deleteShader(vs);
  gl.deleteShader(fs);
  if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
    const log = gl.getProgramInfoLog(prog) ?? "unknown";
    gl.deleteProgram(prog);
    throw new Error(`Program link error: ${log}`);
  }
  return prog;
}

function pushTri(
  verts: number[],
  p0: readonly [number, number, number],
  p1: readonly [number, number, number],
  p2: readonly [number, number, number],
  n: readonly [number, number, number],
  col: readonly [number, number, number],
): void {
  verts.push(
    p0[0], p0[1], p0[2], col[0], col[1], col[2], n[0], n[1], n[2],
    p1[0], p1[1], p1[2], col[0], col[1], col[2], n[0], n[1], n[2],
    p2[0], p2[1], p2[2], col[0], col[1], col[2], n[0], n[1], n[2],
  );
}

function pushQuad(
  verts: number[],
  a: readonly [number, number, number],
  b: readonly [number, number, number],
  c: readonly [number, number, number],
  d: readonly [number, number, number],
  n: readonly [number, number, number],
  col: readonly [number, number, number],
): void {
  pushTri(verts, a, b, c, n, col);
  pushTri(verts, a, c, d, n, col);
}

function pushBoxMesh(
  verts: number[],
  cx: number,
  cy: number,
  zMin: number,
  zMax: number,
  width: number,
  length: number,
  rgb: readonly [number, number, number],
  roofRgb?: readonly [number, number, number],
): void {
  const hx = width * 0.5;
  const hy = length * 0.5;
  const topCol = roofRgb ?? rgb;

  const b0 = [cx - hx, cy - hy, zMin] as const;
  const b1 = [cx + hx, cy - hy, zMin] as const;
  const b2 = [cx + hx, cy + hy, zMin] as const;
  const b3 = [cx - hx, cy + hy, zMin] as const;

  const t0 = [cx - hx, cy - hy, zMax] as const;
  const t1 = [cx + hx, cy - hy, zMax] as const;
  const t2 = [cx + hx, cy + hy, zMax] as const;
  const t3 = [cx - hx, cy + hy, zMax] as const;

  pushQuad(verts, t0, t1, t2, t3, [0, 0, 1], topCol);
  pushQuad(verts, b0, b1, t1, t0, [0, -1, 0], rgb);
  pushQuad(verts, b2, b3, t3, t2, [0, 1, 0], rgb);
  pushQuad(verts, b3, b0, t0, t3, [-1, 0, 0], rgb);
  pushQuad(verts, b1, b2, t2, t1, [1, 0, 0], rgb);
}

/** Tapered hull box whose front (y1) narrows smoothly to bowHalfW (0 = pointed bow). */
function pushHullTapering(
  verts: number[],
  y0: number,
  y1: number,
  zMin: number,
  zMax: number,
  aftHalfW: number,
  bowHalfW: number,
  sideRgb: readonly [number, number, number],
  deckRgb: readonly [number, number, number],
): void {
  const b0 = [-aftHalfW, y0, zMin] as const;
  const b1 = [aftHalfW, y0, zMin] as const;
  const b2 = [bowHalfW, y1, zMin] as const;
  const b3 = [-bowHalfW, y1, zMin] as const;

  const t0 = [-aftHalfW, y0, zMax] as const;
  const t1 = [aftHalfW, y0, zMax] as const;
  const t2 = [bowHalfW, y1, zMax] as const;
  const t3 = [-bowHalfW, y1, zMax] as const;

  pushQuad(verts, t0, t1, t2, t3, [0, 0, 1], deckRgb);
  pushQuad(verts, b0, b1, t1, t0, [0, -1, 0], sideRgb);
  pushQuad(verts, b2, b3, t3, t2, [0, 1, 0], sideRgb);
  pushQuad(verts, b3, b0, t0, t3, [-0.85, 0.52, 0], sideRgb);
  pushQuad(verts, b1, b2, t2, t1, [0.85, 0.52, 0], sideRgb);
}

interface MeshData {
  data: Float32Array;
  vertexCount: number;
}

function finalizeMesh(verts: number[]): MeshData {
  return { data: new Float32Array(verts), vertexCount: verts.length / 9 };
}

function buildArticulatedBusMesh(): MeshData {
  const verts: number[] = [];
  const baysideBlue = [0.06, 0.45, 0.72] as const;
  const baysideRoof = [0.88, 0.93, 0.97] as const;
  const windowTint = [0.1, 0.16, 0.24] as const;
  const bellowsDark = [0.18, 0.2, 0.24] as const;
  const wheelDark = [0.12, 0.13, 0.15] as const;
  const acPod = [0.76, 0.8, 0.85] as const;
  const headlight = [1.0, 0.95, 0.72] as const;

  pushBoxMesh(verts, 0, 4.8, 0.35, 3.15, 2.5, 8.4, baysideBlue, baysideRoof);
  pushBoxMesh(verts, 0, -0.15, 0.45, 3.05, 2.32, 1.5, bellowsDark, bellowsDark);
  pushBoxMesh(verts, 0, -4.95, 0.35, 3.15, 2.5, 8.1, baysideBlue, baysideRoof);

  pushBoxMesh(verts, 0, 4.9, 1.55, 2.55, 2.54, 8.1, windowTint, baysideRoof);
  pushBoxMesh(verts, 0, -4.95, 1.55, 2.55, 2.54, 7.6, windowTint, baysideRoof);

  pushBoxMesh(verts, 0, 4.5, 3.15, 3.38, 1.4, 2.8, acPod, acPod);
  pushBoxMesh(verts, 0, -5.0, 3.15, 3.38, 1.4, 2.6, acPod, acPod);
  pushBoxMesh(verts, 0, 5.2, 0.0, 0.42, 2.3, 1.2, wheelDark, wheelDark);
  pushBoxMesh(verts, 0, -5.5, 0.0, 0.42, 2.3, 1.2, wheelDark, wheelDark);
  pushBoxMesh(verts, 0, 9.02, 0.72, 0.96, 1.9, 0.12, headlight, headlight);

  return finalizeMesh(verts);
}

function buildRetroBusMesh(): MeshData {
  const verts: number[] = [];
  const crimson = [0.73, 0.17, 0.15] as const;
  const creamUpper = [0.96, 0.92, 0.84] as const;
  const roofGold = [0.85, 0.72, 0.42] as const;
  const windowTint = [0.12, 0.15, 0.2] as const;
  const wheelDark = [0.12, 0.13, 0.15] as const;
  const headlight = [1.0, 0.92, 0.68] as const;

  pushBoxMesh(verts, 0, 0, 0.32, 1.55, 2.3, 9.4, crimson, crimson);
  pushBoxMesh(verts, 0, -0.1, 1.55, 2.88, 2.26, 9.0, creamUpper, creamUpper);
  pushBoxMesh(verts, 0, -0.1, 1.68, 2.52, 2.3, 8.2, windowTint, creamUpper);
  pushBoxMesh(verts, 0, 0.2, 2.88, 3.06, 1.4, 4.6, roofGold, creamUpper);
  pushBoxMesh(verts, 0, 2.8, 0, 0.42, 2.1, 1.1, wheelDark, wheelDark);
  pushBoxMesh(verts, 0, -2.8, 0, 0.42, 2.1, 1.1, wheelDark, wheelDark);
  pushBoxMesh(verts, 0, 4.72, 0.68, 0.94, 1.7, 0.12, headlight, headlight);

  return finalizeMesh(verts);
}

function buildSingleDeckBusMesh(
  bodyRgb: readonly [number, number, number],
  stripeRgb: readonly [number, number, number],
): MeshData {
  const verts: number[] = [];
  const roofWhite = [0.94, 0.95, 0.96] as const;
  const windowTint = [0.11, 0.17, 0.24] as const;
  const wheelDark = [0.12, 0.13, 0.15] as const;
  const acPod = [0.76, 0.81, 0.86] as const;
  const headlight = [1.0, 0.95, 0.72] as const;

  pushBoxMesh(verts, 0, 0, 0.34, 1.55, 2.45, 11.2, bodyRgb, bodyRgb);
  pushBoxMesh(verts, 0, 0, 1.55, 2.95, 2.45, 11.0, stripeRgb, roofWhite);
  pushBoxMesh(verts, 0, 0.15, 1.65, 2.58, 2.49, 10.2, windowTint, roofWhite);
  pushBoxMesh(verts, 0, -0.4, 2.95, 3.18, 1.4, 3.2, acPod, acPod);
  pushBoxMesh(verts, 0, 3.4, 0, 0.42, 2.2, 1.2, wheelDark, wheelDark);
  pushBoxMesh(verts, 0, -3.5, 0, 0.42, 2.2, 1.2, wheelDark, wheelDark);
  pushBoxMesh(verts, 0, 5.62, 0.72, 0.96, 1.85, 0.12, headlight, headlight);

  return finalizeMesh(verts);
}

/** Unit-scaled 3D railcar mesh (scaled dynamically by carWidthM, carLengthM, carHeightM). */
function buildRailcarMesh(
  bodyRgb: readonly [number, number, number],
  stripeRgb: readonly [number, number, number],
  roofRgb: readonly [number, number, number],
): MeshData {
  const verts: number[] = [];
  const bogieDark = [0.15, 0.16, 0.19] as const;
  const windowLit = [0.96, 0.89, 0.66] as const;
  const acPod = [0.78, 0.81, 0.86] as const;
  const headlight = [1.0, 0.97, 0.78] as const;

  // Bogies / chassis
  pushBoxMesh(verts, 0, 0.3, 0.0, 0.16, 0.82, 0.24, bogieDark, bogieDark);
  pushBoxMesh(verts, 0, -0.3, 0.0, 0.16, 0.82, 0.24, bogieDark, bogieDark);
  // Main lower carbody
  pushBoxMesh(verts, 0, 0, 0.14, 0.90, 0.98, 0.98, bodyRgb, roofRgb);
  // Line color livery band
  pushBoxMesh(verts, 0, 0, 0.34, 0.50, 1.01, 0.96, stripeRgb, stripeRgb);
  // Warm illuminated passenger windows
  pushBoxMesh(verts, 0, 0, 0.54, 0.76, 1.01, 0.88, windowLit, roofRgb);
  // Roof & twin AC units
  pushBoxMesh(verts, 0, 0.22, 0.90, 1.0, 0.56, 0.22, acPod, acPod);
  pushBoxMesh(verts, 0, -0.22, 0.90, 1.0, 0.56, 0.22, acPod, acPod);
  // Front & rear marker/headlight lamps
  pushBoxMesh(verts, 0, 0.50, 0.22, 0.34, 0.76, 0.03, headlight, headlight);

  return finalizeMesh(verts);
}

function buildCruiseShipMesh(): MeshData {
  const verts: number[] = [];
  const navyHull = [0.11, 0.23, 0.39] as const;
  const whiteHull = [0.95, 0.96, 0.98] as const;
  const deckWood = [0.82, 0.76, 0.64] as const;
  const glass = [0.14, 0.24, 0.36] as const;
  const coralFunnel = [0.85, 0.27, 0.22] as const;

  pushHullTapering(verts, -0.46, 0.22, 0.02, 0.16, 0.48, 0.48, navyHull, whiteHull);
  pushHullTapering(verts, 0.22, 0.5, 0.02, 0.16, 0.48, 0.06, navyHull, whiteHull);

  pushHullTapering(verts, -0.45, 0.2, 0.16, 0.34, 0.49, 0.49, whiteHull, deckWood);
  pushHullTapering(verts, 0.2, 0.48, 0.16, 0.34, 0.49, 0.05, whiteHull, whiteHull);

  pushBoxMesh(verts, 0, -0.08, 0.34, 0.54, 0.84, 0.62, whiteHull, whiteHull);
  pushBoxMesh(verts, 0, -0.07, 0.4, 0.48, 0.86, 0.56, glass, whiteHull);
  pushBoxMesh(verts, 0, -0.09, 0.54, 0.72, 0.72, 0.52, whiteHull, deckWood);
  pushBoxMesh(verts, 0, 0.14, 0.72, 0.84, 0.76, 0.16, glass, whiteHull);
  pushBoxMesh(verts, 0, -0.18, 0.72, 1.0, 0.28, 0.12, coralFunnel, navyHull);

  return finalizeMesh(verts);
}

function buildCruiserMesh(): MeshData {
  const verts: number[] = [];
  const creamHull = [0.95, 0.92, 0.86] as const;
  const navyTrim = [0.12, 0.28, 0.46] as const;
  const teak = [0.64, 0.42, 0.24] as const;
  const glass = [0.14, 0.24, 0.35] as const;
  const goldAccent = [0.85, 0.62, 0.2] as const;

  pushHullTapering(verts, -0.45, 0.2, 0.02, 0.3, 0.48, 0.48, navyTrim, teak);
  pushHullTapering(verts, 0.2, 0.5, 0.02, 0.3, 0.48, 0.08, navyTrim, creamHull);
  pushBoxMesh(verts, 0, -0.08, 0.3, 0.6, 0.82, 0.58, creamHull, creamHull);
  pushBoxMesh(verts, 0, -0.04, 0.36, 0.52, 0.84, 0.48, glass, creamHull);
  pushBoxMesh(verts, 0, -0.06, 0.6, 0.82, 0.64, 0.38, creamHull, teak);
  pushBoxMesh(verts, 0, -0.18, 0.82, 1.0, 0.24, 0.1, goldAccent, navyTrim);

  return finalizeMesh(verts);
}

function buildWaterbusMesh(): MeshData {
  const verts: number[] = [];
  const seaBlue = [0.13, 0.42, 0.68] as const;
  const whiteHull = [0.96, 0.97, 0.99] as const;
  const glass = [0.14, 0.25, 0.38] as const;
  const roofSilver = [0.86, 0.9, 0.94] as const;

  pushHullTapering(verts, -0.45, 0.22, 0.02, 0.32, 0.48, 0.48, seaBlue, whiteHull);
  pushHullTapering(verts, 0.22, 0.5, 0.02, 0.32, 0.48, 0.14, whiteHull, whiteHull);
  pushHullTapering(verts, -0.32, 0.18, 0.32, 0.78, 0.82, 0.76, whiteHull, roofSilver);
  pushHullTapering(verts, 0.18, 0.36, 0.32, 0.78, 0.76, 0.48, glass, roofSilver);
  pushBoxMesh(verts, 0, -0.05, 0.42, 0.66, 0.84, 0.52, glass, roofSilver);
  pushBoxMesh(verts, 0, -0.14, 0.78, 0.98, 0.32, 0.26, seaBlue, whiteHull);

  return finalizeMesh(verts);
}

function buildTugMesh(): MeshData {
  const verts: number[] = [];
  const coralHull = [0.82, 0.3, 0.25] as const;
  const bumperDark = [0.15, 0.17, 0.2] as const;
  const whiteCabin = [0.95, 0.95, 0.94] as const;
  const bridgeGlass = [0.14, 0.22, 0.32] as const;

  pushHullTapering(verts, -0.44, 0.2, 0.04, 0.38, 0.49, 0.49, bumperDark, coralHull);
  pushHullTapering(verts, 0.2, 0.48, 0.04, 0.38, 0.49, 0.14, bumperDark, coralHull);
  pushBoxMesh(verts, 0, 0.02, 0.38, 0.78, 0.66, 0.42, whiteCabin, whiteCabin);
  pushBoxMesh(verts, 0, 0.08, 0.52, 0.7, 0.68, 0.28, bridgeGlass, whiteCabin);
  pushBoxMesh(verts, 0, -0.22, 0.5, 1.0, 0.22, 0.14, coralHull, bumperDark);

  return finalizeMesh(verts);
}

function buildWakeMesh(): MeshData {
  const verts: number[] = [];
  const foam = [0.94, 0.97, 1.0] as const;
  const n = [0, 0, 1] as const;
  pushQuad(
    verts,
    [-0.18, -0.4, 0.04],
    [0.02, -0.4, 0.04],
    [-0.65, -2.0, 0.04],
    [-1.08, -2.0, 0.04],
    n,
    foam,
  );
  pushQuad(
    verts,
    [-0.02, -0.4, 0.04],
    [0.18, -0.4, 0.04],
    [1.08, -2.0, 0.04],
    [0.65, -2.0, 0.04],
    n,
    foam,
  );
  pushQuad(
    verts,
    [-0.14, -0.45, 0.03],
    [0.14, -0.45, 0.03],
    [0.32, -1.65, 0.03],
    [-0.32, -1.65, 0.03],
    n,
    [0.86, 0.94, 0.99],
  );
  return finalizeMesh(verts);
}

function buildSedanMesh(bodyRgb: readonly [number, number, number]): MeshData {
  const verts: number[] = [];
  const glass = [0.14, 0.19, 0.26] as const;
  const wheelDark = [0.11, 0.12, 0.14] as const;
  const head = [1.0, 0.96, 0.78] as const;
  const tail = [0.92, 0.22, 0.18] as const;

  pushBoxMesh(verts, 0, 0, 0.24, 0.88, 1.78, 4.35, bodyRgb, bodyRgb);
  pushBoxMesh(verts, 0, -0.15, 0.88, 1.42, 1.56, 2.25, glass, bodyRgb);
  pushBoxMesh(verts, 0, 1.35, 0.0, 0.30, 1.72, 0.72, wheelDark, wheelDark);
  pushBoxMesh(verts, 0, -1.35, 0.0, 0.30, 1.72, 0.72, wheelDark, wheelDark);
  pushBoxMesh(verts, 0, 2.20, 0.44, 0.64, 1.42, 0.08, head, head);
  pushBoxMesh(verts, 0, -2.20, 0.44, 0.64, 1.42, 0.08, tail, tail);
  return finalizeMesh(verts);
}

function buildTaxiMesh(): MeshData {
  const verts: number[] = [];
  const taxiYellow = [0.95, 0.78, 0.22] as const;
  const roofCap = [0.99, 0.97, 0.88] as const;
  const glass = [0.13, 0.18, 0.25] as const;
  const wheelDark = [0.11, 0.12, 0.14] as const;
  const head = [1.0, 0.96, 0.78] as const;
  const tail = [0.94, 0.22, 0.18] as const;

  pushBoxMesh(verts, 0, 0, 0.24, 0.88, 1.78, 4.45, taxiYellow, taxiYellow);
  pushBoxMesh(verts, 0, -0.15, 0.88, 1.42, 1.56, 2.25, glass, taxiYellow);
  pushBoxMesh(verts, 0, 0.0, 1.42, 1.62, 0.56, 0.42, roofCap, roofCap);
  pushBoxMesh(verts, 0, 1.35, 0.0, 0.30, 1.72, 0.72, wheelDark, wheelDark);
  pushBoxMesh(verts, 0, -1.35, 0.0, 0.30, 1.72, 0.72, wheelDark, wheelDark);
  pushBoxMesh(verts, 0, 2.24, 0.44, 0.64, 1.42, 0.08, head, head);
  pushBoxMesh(verts, 0, -2.24, 0.44, 0.64, 1.42, 0.08, tail, tail);
  return finalizeMesh(verts);
}

function buildVanMesh(): MeshData {
  const verts: number[] = [];
  const vanWhite = [0.94, 0.95, 0.96] as const;
  const vanRoof = [0.97, 0.98, 0.99] as const;
  const glass = [0.13, 0.18, 0.24] as const;
  const wheelDark = [0.11, 0.12, 0.14] as const;
  const head = [1.0, 0.96, 0.78] as const;
  const tail = [0.92, 0.22, 0.18] as const;

  pushBoxMesh(verts, 0, 0, 0.28, 1.15, 1.88, 4.75, vanWhite, vanRoof);
  pushBoxMesh(verts, 0, 0.15, 1.15, 1.98, 1.82, 4.25, glass, vanRoof);
  pushBoxMesh(verts, 0, 1.55, 0.0, 0.34, 1.80, 0.76, wheelDark, wheelDark);
  pushBoxMesh(verts, 0, -1.55, 0.0, 0.34, 1.80, 0.76, wheelDark, wheelDark);
  pushBoxMesh(verts, 0, 2.40, 0.50, 0.72, 1.50, 0.08, head, head);
  pushBoxMesh(verts, 0, -2.40, 0.50, 0.72, 1.50, 0.08, tail, tail);
  return finalizeMesh(verts);
}

function buildBoxTruckMesh(): MeshData {
  const verts: number[] = [];
  const cabWhite = [0.90, 0.91, 0.93] as const;
  const boxWhite = [0.95, 0.95, 0.94] as const;
  const boxRoof = [0.98, 0.98, 0.97] as const;
  const glass = [0.13, 0.18, 0.25] as const;
  const wheelDark = [0.11, 0.12, 0.14] as const;
  const head = [1.0, 0.96, 0.78] as const;
  const tail = [0.92, 0.22, 0.18] as const;

  // Cab forward, crisp cargo box behind
  pushBoxMesh(verts, 0, 1.95, 0.32, 1.55, 2.02, 1.75, cabWhite, cabWhite);
  pushBoxMesh(verts, 0, 2.10, 1.55, 2.28, 1.92, 1.40, glass, cabWhite);
  pushBoxMesh(verts, 0, -0.90, 0.42, 2.75, 2.14, 3.85, boxWhite, boxRoof);
  pushBoxMesh(verts, 0, 1.95, 0.0, 0.36, 1.92, 0.80, wheelDark, wheelDark);
  pushBoxMesh(verts, 0, -1.65, 0.0, 0.36, 1.98, 0.85, wheelDark, wheelDark);
  pushBoxMesh(verts, 0, 2.84, 0.55, 0.78, 1.62, 0.08, head, head);
  pushBoxMesh(verts, 0, -2.84, 0.55, 0.78, 1.72, 0.08, tail, tail);
  return finalizeMesh(verts);
}

function buildPodCarMesh(): MeshData {
  const verts: number[] = [];
  const crispWhite = [0.96, 0.97, 0.98] as const;
  const podDark = [0.18, 0.20, 0.24] as const;
  const glass = [0.13, 0.18, 0.25] as const;
  const wheelDark = [0.11, 0.12, 0.14] as const;
  const head = [1.0, 0.96, 0.78] as const;
  const tail = [0.94, 0.22, 0.18] as const;

  pushBoxMesh(verts, 0, 0, 0.24, 0.90, 1.82, 4.45, crispWhite, crispWhite);
  pushBoxMesh(verts, 0, -0.14, 0.90, 1.44, 1.60, 2.30, glass, crispWhite);
  // Roof lidar sensor pod matching Small SF's iconic autonomous sedans
  pushBoxMesh(verts, 0, 0.05, 1.44, 1.70, 0.52, 0.52, podDark, podDark);
  pushBoxMesh(verts, 0, 1.35, 0.0, 0.30, 1.74, 0.72, wheelDark, wheelDark);
  pushBoxMesh(verts, 0, -1.35, 0.0, 0.30, 1.74, 0.72, wheelDark, wheelDark);
  pushBoxMesh(verts, 0, 2.24, 0.44, 0.64, 1.44, 0.08, head, head);
  pushBoxMesh(verts, 0, -2.24, 0.44, 0.64, 1.44, 0.08, tail, tail);
  return finalizeMesh(verts);
}

function pushSegmentBeam(
  verts: number[],
  a: readonly [number, number, number],
  b: readonly [number, number, number],
  px: number,
  py: number,
  hw: number,
  hh: number,
  rgb: readonly [number, number, number],
): void {
  const aTL: readonly [number, number, number] = [a[0] - px * hw, a[1] - py * hw, a[2] + hh];
  const aTR: readonly [number, number, number] = [a[0] + px * hw, a[1] + py * hw, a[2] + hh];
  const aBL: readonly [number, number, number] = [a[0] - px * hw, a[1] - py * hw, a[2] - hh];
  const aBR: readonly [number, number, number] = [a[0] + px * hw, a[1] + py * hw, a[2] - hh];
  const bTL: readonly [number, number, number] = [b[0] - px * hw, b[1] - py * hw, b[2] + hh];
  const bTR: readonly [number, number, number] = [b[0] + px * hw, b[1] + py * hw, b[2] + hh];
  const bBL: readonly [number, number, number] = [b[0] - px * hw, b[1] - py * hw, b[2] - hh];
  const bBR: readonly [number, number, number] = [b[0] + px * hw, b[1] + py * hw, b[2] - hh];
  pushQuad(verts, aTL, aTR, bTR, bTL, [0, 0, 1], rgb);
  pushQuad(verts, aBR, aBL, bBL, bBR, [0, 0, -1], rgb);
  pushQuad(verts, aBL, aTL, bTL, bBL, [-px, -py, 0], rgb);
  pushQuad(verts, aTR, aBR, bBR, bTR, [px, py, 0], rgb);
}

function pushSweptWingPair(
  verts: number[],
  yRootFront: number,
  yRootBack: number,
  xRoot: number,
  yTipFront: number,
  yTipBack: number,
  xTip: number,
  zBot: number,
  zTop: number,
  topRgb: readonly [number, number, number],
  sideRgb: readonly [number, number, number],
): void {
  for (const sign of [1, -1] as const) {
    const xr = xRoot * sign;
    const xt = xTip * sign;
    const rfTop: readonly [number, number, number] = [xr, yRootFront, zTop];
    const rbTop: readonly [number, number, number] = [xr, yRootBack, zTop];
    const tbTop: readonly [number, number, number] = [xt, yTipBack, zTop];
    const tfTop: readonly [number, number, number] = [xt, yTipFront, zTop];

    const rfBot: readonly [number, number, number] = [xr, yRootFront, zBot];
    const rbBot: readonly [number, number, number] = [xr, yRootBack, zBot];
    const tbBot: readonly [number, number, number] = [xt, yTipBack, zBot];
    const tfBot: readonly [number, number, number] = [xt, yTipFront, zBot];

    pushQuad(verts, rfTop, rbTop, tbTop, tfTop, [0, 0, 1], topRgb);
    pushQuad(verts, tfBot, tbBot, rbBot, rfBot, [0, 0, -1], sideRgb);
    pushQuad(verts, rfBot, tfBot, tfTop, rfTop, [0, 1, 0], sideRgb);
    pushQuad(verts, rbTop, tbTop, tbBot, rbBot, [0, -1, 0], sideRgb);
    pushQuad(verts, tfBot, tbBot, tbTop, tfTop, [sign, 0, 0], sideRgb);
  }
}

function buildAirCabinStructureMesh(camera: CameraManifest): {
  mesh: MeshData;
  originLocalM: readonly [number, number, number];
} {
  const s0 = AIR_CABIN_TERMINALS.sakuragicho;
  const s1 = AIR_CABIN_TERMINALS.ungapark;
  const originLocalM = wgs84ToLocal(camera, (s0.lon + s1.lon) * 0.5, (s0.lat + s1.lat) * 0.5, 0);
  const p0 = wgs84ToLocal(camera, s0.lon, s0.lat, 0);
  const p1 = wgs84ToLocal(camera, s1.lon, s1.lat, 0);
  const dx = p1[0] - p0[0];
  const dy = p1[1] - p0[1];
  const len = Math.max(1, Math.hypot(dx, dy));
  const ax = dx / len;
  const ay = dy / len;
  const px = ay;
  const py = -ax;

  const toRel = (lon: number, lat: number, elevM: number): readonly [number, number, number] => {
    const loc = wgs84ToLocal(camera, lon, lat, elevM);
    return [loc[0] - originLocalM[0], loc[1] - originLocalM[1], loc[2] - originLocalM[2]];
  };

  const verts: number[] = [];
  const towerWhite = [0.91, 0.93, 0.96] as const;
  const plinthGray = [0.46, 0.49, 0.54] as const;
  const crossSilver = [0.76, 0.80, 0.85] as const;
  const sheaveDark = [0.18, 0.21, 0.26] as const;
  const cableSteel = [0.15, 0.18, 0.23] as const;

  for (const pylon of AIR_CABIN_PYLONS) {
    const c = toRel(pylon.lon, pylon.lat, 0);
    // Pedestal + vertical steel support mast
    pushBoxMesh(verts, c[0], c[1], 1.5, 4.0, 2.0, 2.0, plinthGray, plinthGray);
    pushBoxMesh(verts, c[0], c[1], 4.0, pylon.saddleElevM - 0.55, 1.15, 1.15, towerWhite, towerWhite);

    // Overhead crossarm perpendicular to the ropeway axis
    const armHalfSpan = 3.9;
    const armA: readonly [number, number, number] = [
      c[0] - px * armHalfSpan,
      c[1] - py * armHalfSpan,
      pylon.saddleElevM - 0.25,
    ];
    const armB: readonly [number, number, number] = [
      c[0] + px * armHalfSpan,
      c[1] + py * armHalfSpan,
      pylon.saddleElevM - 0.25,
    ];
    pushSegmentBeam(verts, armA, armB, ax, ay, 0.52, 0.42, crossSilver);

    // Dual pulley roller assemblies under each haul cable
    for (const side of [AIR_CABIN_LATERAL_HALF_M, -AIR_CABIN_LATERAL_HALF_M]) {
      const sx = c[0] + px * side;
      const sy = c[1] + py * side;
      pushBoxMesh(
        verts,
        sx,
        sy,
        pylon.saddleElevM - 0.15,
        pylon.saddleElevM + 0.55,
        0.75,
        2.1,
        sheaveDark,
        sheaveDark,
      );
    }
  }

  // Dual continuous haul cables running 630 m from Sakuragicho to Unga Park
  const segCount = 28;
  for (const lateralM of [AIR_CABIN_LATERAL_HALF_M, -AIR_CABIN_LATERAL_HALF_M]) {
    const pts: Array<readonly [number, number, number]> = [];
    for (let i = 0; i <= segCount; i++) {
      const sample = sampleAirCabinCable(i / segCount, lateralM);
      pts.push(toRel(sample.lon, sample.lat, sample.cableElevM));
    }
    for (let i = 0; i < segCount; i++) {
      pushSegmentBeam(verts, pts[i]!, pts[i + 1]!, px, py, 0.24, 0.24, cableSteel);
    }
  }

  return { mesh: finalizeMesh(verts), originLocalM };
}

function buildAirCabinGondolaMesh(nightLit: boolean): MeshData {
  const verts: number[] = [];
  const gripDark = [0.22, 0.24, 0.29] as const;
  const steelArm = [0.76, 0.80, 0.86] as const;
  const roofSilver = [0.95, 0.96, 0.98] as const;
  const trimCoral = [0.92, 0.36, 0.28] as const;
  const shellWhite = [0.94, 0.95, 0.97] as const;
  const glassRgb = nightLit
    ? ([1.0, 0.85, 0.46] as const)
    : ([0.20, 0.44, 0.62] as const);

  // Cable grip clamp & vertical hanger stem (anchored to z=0 cable point)
  pushBoxMesh(verts, 0, 0, -0.15, 0.28, 0.65, 0.85, gripDark, gripDark);
  pushBoxMesh(verts, 0, 0, -1.35, -0.15, 0.30, 0.30, steelArm, steelArm);
  // Curved silver roof dome & air vents
  pushBoxMesh(verts, 0, 0, -1.68, -1.25, 2.7, 3.3, roofSilver, roofSilver);
  // Panoramic illuminated/sky glass cabin enclosure
  pushBoxMesh(verts, 0, 0, -3.30, -1.68, 2.95, 3.55, glassRgb, roofSilver);
  // Lower white/coral cabin shell
  pushBoxMesh(verts, 0, 0, -3.65, -3.30, 2.88, 3.48, trimCoral, shellWhite);
  pushBoxMesh(verts, 0, 0, -4.15, -3.65, 2.75, 3.35, shellWhite, shellWhite);

  return finalizeMesh(verts);
}

function buildPlaneMesh(kind: PlaneMeshKind): MeshData {
  const verts: number[] = [];
  const whiteFuse = [0.97, 0.98, 0.99] as const;
  const wingSilver = [0.88, 0.90, 0.94] as const;
  const wingUnder = [0.64, 0.68, 0.75] as const;
  const cockpitGlass = [0.10, 0.16, 0.25] as const;
  const engineNacelle = [0.80, 0.83, 0.88] as const;
  const portRed = [0.95, 0.20, 0.18] as const;
  const starGreen = [0.16, 0.86, 0.38] as const;

  if (kind === "heli") {
    const rescueWhite = [0.97, 0.97, 0.98] as const;
    const coralStripe = [0.90, 0.32, 0.24] as const;
    const skidDark = [0.18, 0.20, 0.24] as const;
    const rotorDark = [0.22, 0.24, 0.28] as const;

    pushBoxMesh(verts, 0, 0.6, 0.7, 2.8, 2.4, 5.8, rescueWhite, rescueWhite);
    pushBoxMesh(verts, 0, 0.7, 1.35, 1.85, 2.48, 5.2, coralStripe, coralStripe);
    pushBoxMesh(verts, 0, 2.8, 1.1, 2.55, 2.1, 1.8, cockpitGlass, rescueWhite);
    pushBoxMesh(verts, 0, -4.5, 1.65, 2.35, 0.65, 5.6, rescueWhite, rescueWhite);
    pushBoxMesh(verts, 0, -7.1, 1.7, 3.7, 0.32, 1.5, coralStripe, coralStripe);
    // Landing skids & cross-tubes
    pushBoxMesh(verts, -1.25, 0.4, 0.0, 0.25, 0.25, 4.6, skidDark, skidDark);
    pushBoxMesh(verts, 1.25, 0.4, 0.0, 0.25, 0.25, 4.6, skidDark, skidDark);
    // Rotor hub & wide 4-blade main rotor cross
    pushBoxMesh(verts, 0, 0.3, 2.8, 3.35, 0.45, 0.45, skidDark, skidDark);
    pushBoxMesh(verts, 0, 0.3, 3.25, 3.42, 11.8, 0.52, rotorDark, rotorDark);
    pushBoxMesh(verts, 0, 0.3, 3.25, 3.42, 0.52, 11.8, rotorDark, rotorDark);
    return finalizeMesh(verts);
  }

  const s = kind === "heavyJet" ? 1.0 : 0.76;
  const tailRgb = kind === "heavyJet" ? ([0.08, 0.36, 0.72] as const) : ([0.86, 0.24, 0.24] as const);
  const wingSpan = 21.0 * s;
  const fuseLen = 17.0 * s;
  const fuseW = 4.6 * s;

  // Tapered nose cone & main fuselage
  pushHullTapering(verts, 12.5 * s, 21.5 * s, 1.1 * s, 4.2 * s, fuseW * 0.5, 0.25 * s, whiteFuse, whiteFuse);
  pushBoxMesh(verts, 0, -1.5 * s, 0.9 * s, 4.7 * s, fuseW, fuseLen * 1.65, whiteFuse, whiteFuse);
  pushBoxMesh(verts, 0, -1.5 * s, 2.5 * s, 3.05 * s, fuseW * 1.02, fuseLen * 1.60, tailRgb, tailRgb);
  pushBoxMesh(verts, 0, 15.6 * s, 2.75 * s, 3.6 * s, fuseW * 0.62, 2.4 * s, cockpitGlass, whiteFuse);
  // Tapered tail cone
  pushHullTapering(verts, -15.5 * s, -21.0 * s, 1.5 * s, 3.8 * s, 0.4 * s, fuseW * 0.48, whiteFuse, whiteFuse);

  // Swept main wings + wingtip navigation lights
  pushSweptWingPair(
    verts,
    5.5 * s,
    -3.5 * s,
    2.0 * s,
    -8.4 * s,
    -11.2 * s,
    wingSpan,
    1.6 * s,
    2.25 * s,
    wingSilver,
    wingUnder,
  );
  pushBoxMesh(verts, -wingSpan + 0.4 * s, -9.8 * s, 1.9 * s, 2.5 * s, 0.9 * s, 1.6 * s, portRed, portRed);
  pushBoxMesh(verts, wingSpan - 0.4 * s, -9.8 * s, 1.9 * s, 2.5 * s, 0.9 * s, 1.6 * s, starGreen, starGreen);

  // Twin underwing turbofans
  pushBoxMesh(verts, -7.8 * s, 1.8 * s, 0.15 * s, 1.9 * s, 2.2 * s, 4.4 * s, engineNacelle, engineNacelle);
  pushBoxMesh(verts, 7.8 * s, 1.8 * s, 0.15 * s, 1.9 * s, 2.2 * s, 4.4 * s, engineNacelle, engineNacelle);

  // Horizontal stabilizers & tall vertical tailfin
  pushSweptWingPair(
    verts,
    -14.5 * s,
    -18.2 * s,
    0.7 * s,
    -18.5 * s,
    -20.4 * s,
    7.6 * s,
    2.5 * s,
    2.95 * s,
    wingSilver,
    wingUnder,
  );
  pushBoxMesh(verts, 0, -17.6 * s, 4.2 * s, 11.4 * s, 0.72 * s, 5.2 * s, tailRgb, tailRgb);

  return finalizeMesh(verts);
}

function buildPlaneShadowMesh(kind: PlaneMeshKind): MeshData {
  const verts: number[] = [];
  const shadowDark = [0.06, 0.08, 0.12] as const;

  if (kind === "heli") {
    pushBoxMesh(verts, 0, 0, 0, 0.12, 2.2, 8.2, shadowDark, shadowDark);
    pushBoxMesh(verts, 0, 0.3, 0, 0.12, 10.6, 0.85, shadowDark, shadowDark);
    pushBoxMesh(verts, 0, 0.3, 0, 0.12, 0.85, 10.6, shadowDark, shadowDark);
    return finalizeMesh(verts);
  }

  const s = kind === "heavyJet" ? 1.0 : 0.76;
  pushBoxMesh(verts, 0, -1.0 * s, 0, 0.12, 4.2 * s, 35.0 * s, shadowDark, shadowDark);
  pushSweptWingPair(
    verts,
    5.2 * s,
    -3.4 * s,
    1.8 * s,
    -8.4 * s,
    -11.0 * s,
    20.5 * s,
    0,
    0.12,
    shadowDark,
    shadowDark,
  );
  pushSweptWingPair(
    verts,
    -14.5 * s,
    -18.0 * s,
    0.6 * s,
    -18.5 * s,
    -20.3 * s,
    7.4 * s,
    0,
    0.12,
    shadowDark,
    shadowDark,
  );
  return finalizeMesh(verts);
}

function createStaticMeshVao(
  gl: WebGL2RenderingContext,
  mesh: MeshData,
): { vao: WebGLVertexArrayObject; count: number } {
  const vao = gl.createVertexArray();
  const buf = gl.createBuffer();
  if (!vao || !buf) throw new Error("Failed to create static mesh buffer");
  gl.bindVertexArray(vao);
  gl.bindBuffer(gl.ARRAY_BUFFER, buf);
  gl.bufferData(gl.ARRAY_BUFFER, mesh.data, gl.STATIC_DRAW);
  const stride = 9 * 4;
  gl.enableVertexAttribArray(0);
  gl.vertexAttribPointer(0, 3, gl.FLOAT, false, stride, 0);
  gl.enableVertexAttribArray(1);
  gl.vertexAttribPointer(1, 3, gl.FLOAT, false, stride, 3 * 4);
  gl.enableVertexAttribArray(2);
  gl.vertexAttribPointer(2, 3, gl.FLOAT, false, stride, 6 * 4);
  gl.bindVertexArray(null);
  return { vao, count: mesh.vertexCount };
}

export interface OverlayRenderOptions {
  viewTopLeftImgPx: { x: number; y: number };
  viewBottomRightImgPx: { x: number; y: number };
  viewportCssWidth: number;
  viewportCssHeight: number;
  glowTintRgba: readonly [number, number, number, number];
  skyTintRgb: readonly [number, number, number];
  cloudShadowRgb: readonly [number, number, number];
  cloudBaseRgb: readonly [number, number, number];
  cloudHighlightRgb: readonly [number, number, number];
  nightIntensity: number;
  vehicleBrightness: number;
  simTimeSec: number;
  showDepthMap: boolean;
  xrayOcclusion: boolean;
  showTileGrid: boolean;
  showGcps: boolean;
  showDeckTestPoint: boolean;
  vehicles: readonly ResolvedVehicle[];
  trains: readonly ResolvedTrain[];
  ambientCars: readonly AmbientCarInstance[];
  carAlpha: number;
  pedAlpha: number;
  rainIntensity: number;
  windSlope: number;
  sunAltitudeDeg?: number;
  cloudCover?: number;
  mistIntensity?: number;
  windSpeedKmh?: number;
  reducedMotion: boolean;
  selectedVehicleId: string | null;
  selectedTrainId: string | null;
  selectedPlaneId?: string | null;
  selectedAirCabinId?: string | null;
  selectedRideCarId?: number | null;
  selectedPortCallId: string | null;
  gcps: readonly GroundControlPoint[];
  deckTestPoint: { lon: number; lat: number; elevationM: number };
  portCalls: readonly AnimatedPortCall[];
  planes?: readonly ResolvedPlane[];
  airCabins?: readonly ResolvedAirCabinGondola[];
  showAirCabin?: boolean;
  cosmoClock?: CosmoClockVisualState | null;
  showCosmoClock?: boolean;
}

export class WebGLOverlay {
  private readonly gl: WebGL2RenderingContext;
  private readonly overlayProg: WebGLProgram;
  private readonly pedProg: WebGLProgram;
  private readonly lampProg: WebGLProgram;
  private readonly carLightProg: WebGLProgram;
  private readonly vehicleProg: WebGLProgram;
  private readonly cosmoProg: WebGLProgram;
  private readonly cloudProg: WebGLProgram;
  private readonly markerProg: WebGLProgram;
  private readonly rainProg: WebGLProgram;
  private readonly depthArrayTex: WebGLTexture;
  private readonly emptyVao: WebGLVertexArrayObject;
  private readonly cosmoVao: WebGLVertexArrayObject;
  private readonly pedVao: WebGLVertexArrayObject;
  private readonly pedInstanceBuf: WebGLBuffer;
  private pedCount = 0;
  private readonly lampVao: WebGLVertexArrayObject;
  private readonly lampInstanceBuf: WebGLBuffer;
  private lampCount = 0;
  private readonly carLightVao: WebGLVertexArrayObject;
  private readonly carLightInstanceBuf: WebGLBuffer;
  private readonly rainVao: WebGLVertexArrayObject;
  private readonly busMeshes: {
    articulated: { vao: WebGLVertexArrayObject; count: number };
    retro: { vao: WebGLVertexArrayObject; count: number };
    pierLine: { vao: WebGLVertexArrayObject; count: number };
    cityBus: { vao: WebGLVertexArrayObject; count: number };
  };
  private readonly sedanMeshes: ReadonlyArray<{ vao: WebGLVertexArrayObject; count: number }>;
  private readonly taxiMesh: { vao: WebGLVertexArrayObject; count: number };
  private readonly vanMesh: { vao: WebGLVertexArrayObject; count: number };
  private readonly truckMesh: { vao: WebGLVertexArrayObject; count: number };
  private readonly podCarMesh: { vao: WebGLVertexArrayObject; count: number };
  private readonly railMeshes: Record<
    RailLineId,
    { vao: WebGLVertexArrayObject; count: number }
  >;
  private readonly boatMeshes: Record<
    VesselKind,
    { vao: WebGLVertexArrayObject; count: number }
  >;
  private readonly airCabinOriginLocalM: readonly [number, number, number];
  private readonly airCabinStructureMesh: { vao: WebGLVertexArrayObject; count: number };
  private readonly airCabinGondolaMeshes: {
    day: { vao: WebGLVertexArrayObject; count: number };
    night: { vao: WebGLVertexArrayObject; count: number };
  };
  private readonly planeMeshes: Record<
    PlaneMeshKind,
    { vao: WebGLVertexArrayObject; count: number }
  >;
  private readonly planeShadowMeshes: Record<
    PlaneMeshKind,
    { vao: WebGLVertexArrayObject; count: number }
  >;
  private readonly wakeMesh: { vao: WebGLVertexArrayObject; count: number };
  private readonly markerVao: WebGLVertexArrayObject;
  private readonly camera: CameraManifest;

  constructor(
    private readonly canvas: HTMLCanvasElement,
    camera: CameraManifest,
    depthTiles: readonly LoadedTilePixels[],
  ) {
    this.camera = camera;
    const gl = canvas.getContext("webgl2", {
      alpha: true,
      depth: true,
      antialias: true,
      premultipliedAlpha: true,
    });
    if (!gl) {
      throw new Error("WebGL2 is required for depth-occluded vehicle rendering");
    }
    this.gl = gl;

    this.overlayProg = linkProgram(gl, FULLSCREEN_VERT, OVERLAY_FRAG);
    this.pedProg = linkProgram(gl, PEDESTRIAN_VERT, PEDESTRIAN_FRAG);
    this.lampProg = linkProgram(gl, STREETLAMP_VERT, STREETLAMP_FRAG);
    this.carLightProg = linkProgram(gl, CARLIGHT_VERT, CARLIGHT_FRAG);
    this.vehicleProg = linkProgram(gl, VEHICLE_VERT, VEHICLE_FRAG);
    this.cosmoProg = linkProgram(gl, COSMO_VERT, COSMO_FRAG);
    this.cloudProg = linkProgram(gl, FULLSCREEN_VERT, CLOUD_FRAG);
    this.markerProg = linkProgram(gl, MARKER_VERT, MARKER_FRAG);
    this.rainProg = linkProgram(gl, RAIN_VERT, RAIN_FRAG);

    const tex = gl.createTexture();
    if (!tex) throw new Error("Failed to allocate depth texture array");
    this.depthArrayTex = tex;

    const { tileSizePx, cols, rows } = camera.dataTileGrid;
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D_ARRAY, tex);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
    gl.pixelStorei(gl.UNPACK_COLORSPACE_CONVERSION_WEBGL, gl.NONE);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);

    gl.texImage3D(
      gl.TEXTURE_2D_ARRAY,
      0,
      gl.RGBA8,
      tileSizePx,
      tileSizePx,
      cols * rows,
      0,
      gl.RGBA,
      gl.UNSIGNED_BYTE,
      null,
    );

    for (const tile of depthTiles) {
      const layer = tile.row * cols + tile.col;
      const source = tile.bitmap ?? tile.rgba;
      gl.texSubImage3D(
        gl.TEXTURE_2D_ARRAY,
        0,
        0,
        0,
        layer,
        tile.width,
        tile.height,
        1,
        gl.RGBA,
        gl.UNSIGNED_BYTE,
        source as TexImageSource,
      );
      if (tile.bitmap) {
        tile.bitmap.close();
        tile.bitmap = null;
      }
    }

    gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);

    const vao = gl.createVertexArray();
    if (!vao) throw new Error("Failed to create empty VAO");
    this.emptyVao = vao;

    // Instanced city-wide streetlamp glow quad VAO
    const lVao = gl.createVertexArray();
    const lCornerBuf = gl.createBuffer();
    const lInstBuf = gl.createBuffer();
    if (!lVao || !lCornerBuf || !lInstBuf) throw new Error("Failed to create lamp buffers");
    this.lampVao = lVao;
    this.lampInstanceBuf = lInstBuf;
    gl.bindVertexArray(lVao);
    gl.bindBuffer(gl.ARRAY_BUFFER, lCornerBuf);
    gl.bufferData(
      gl.ARRAY_BUFFER,
      new Float32Array([-1, -1, 1, -1, -1, 1, -1, 1, 1, -1, 1, 1]),
      gl.STATIC_DRAW,
    );
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    gl.vertexAttribDivisor(0, 0);

    gl.bindBuffer(gl.ARRAY_BUFFER, lInstBuf);
    gl.bufferData(gl.ARRAY_BUFFER, 0, gl.STATIC_DRAW);
    gl.enableVertexAttribArray(1);
    gl.vertexAttribPointer(1, 4, gl.FLOAT, false, 16, 0);
    gl.vertexAttribDivisor(1, 1);

    // Instanced illustrated pedestrian quad VAO
    const pVao = gl.createVertexArray();
    const pCornerBuf = gl.createBuffer();
    const pInstBuf = gl.createBuffer();
    if (!pVao || !pCornerBuf || !pInstBuf) throw new Error("Failed to create pedestrian buffers");
    this.pedVao = pVao;
    this.pedInstanceBuf = pInstBuf;
    gl.bindVertexArray(pVao);
    gl.bindBuffer(gl.ARRAY_BUFFER, pCornerBuf);
    gl.bufferData(
      gl.ARRAY_BUFFER,
      new Float32Array([-1, -1, 1, -1, -1, 1, -1, 1, 1, -1, 1, 1]),
      gl.STATIC_DRAW,
    );
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    gl.vertexAttribDivisor(0, 0);

    gl.bindBuffer(gl.ARRAY_BUFFER, pInstBuf);
    gl.bufferData(gl.ARRAY_BUFFER, 0, gl.STATIC_DRAW);
    gl.enableVertexAttribArray(1);
    gl.vertexAttribPointer(1, 4, gl.FLOAT, false, 16, 0);
    gl.vertexAttribDivisor(1, 1);

    // Instanced Gaussian headlight cones & brake/taillight halos
    const clVao = gl.createVertexArray();
    const clCornerBuf = gl.createBuffer();
    const clInstBuf = gl.createBuffer();
    if (!clVao || !clCornerBuf || !clInstBuf) throw new Error("Failed to create car light buffers");
    this.carLightVao = clVao;
    this.carLightInstanceBuf = clInstBuf;
    gl.bindVertexArray(clVao);
    gl.bindBuffer(gl.ARRAY_BUFFER, clCornerBuf);
    gl.bufferData(
      gl.ARRAY_BUFFER,
      new Float32Array([-1, -1, 1, -1, -1, 1, -1, 1, 1, -1, 1, 1]),
      gl.STATIC_DRAW,
    );
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    gl.vertexAttribDivisor(0, 0);

    gl.bindBuffer(gl.ARRAY_BUFFER, clInstBuf);
    gl.bufferData(gl.ARRAY_BUFFER, 0, gl.DYNAMIC_DRAW);
    gl.enableVertexAttribArray(1);
    gl.vertexAttribPointer(1, 4, gl.FLOAT, false, 32, 0);
    gl.vertexAttribDivisor(1, 1);
    gl.enableVertexAttribArray(2);
    gl.vertexAttribPointer(2, 4, gl.FLOAT, false, 32, 16);
    gl.vertexAttribDivisor(2, 1);

    // Instanced screen-space falling rain quad VAO
    const rVao = gl.createVertexArray();
    const rBuf = gl.createBuffer();
    if (!rVao || !rBuf) throw new Error("Failed to create rain VAO");
    this.rainVao = rVao;
    gl.bindVertexArray(rVao);
    gl.bindBuffer(gl.ARRAY_BUFFER, rBuf);
    gl.bufferData(
      gl.ARRAY_BUFFER,
      new Float32Array([-1, -1, 1, -1, -1, 1, -1, 1, 1, -1, 1, 1]),
      gl.STATIC_DRAW,
    );
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);

    this.sedanMeshes = (
      [
        [0.95, 0.96, 0.97], // crisp pearl white
        [0.92, 0.93, 0.95], // white x2 weight matching Small SF
        [0.72, 0.75, 0.80], // metallic silver
        [0.94, 0.89, 0.78], // warm cream
        [0.19, 0.21, 0.25], // obsidian black
        [0.24, 0.37, 0.55], // steel blue
        [0.72, 0.22, 0.20], // crimson
        [0.38, 0.50, 0.41], // sage green
        [0.91, 0.58, 0.16], // warm amber
      ] as const
    ).map((rgb) => createStaticMeshVao(gl, buildSedanMesh(rgb)));
    this.taxiMesh = createStaticMeshVao(gl, buildTaxiMesh());
    this.vanMesh = createStaticMeshVao(gl, buildVanMesh());
    this.truckMesh = createStaticMeshVao(gl, buildBoxTruckMesh());
    this.podCarMesh = createStaticMeshVao(gl, buildPodCarMesh());

    this.busMeshes = {
      articulated: createStaticMeshVao(gl, buildArticulatedBusMesh()),
      retro: createStaticMeshVao(gl, buildRetroBusMesh()),
      pierLine: createStaticMeshVao(
        gl,
        buildSingleDeckBusMesh([0.08, 0.5, 0.53], [0.92, 0.94, 0.92]),
      ),
      cityBus: createStaticMeshVao(
        gl,
        buildSingleDeckBusMesh([0.15, 0.36, 0.6], [0.93, 0.93, 0.9]),
      ),
    };

    this.railMeshes = {
      "jr-keihin-tohoku": createStaticMeshVao(
        gl,
        buildRailcarMesh([0.86, 0.89, 0.92], [0.02, 0.72, 0.92], [0.76, 0.79, 0.84]),
      ),
      "jr-tokaido": createStaticMeshVao(
        gl,
        buildRailcarMesh([0.86, 0.89, 0.92], [0.94, 0.52, 0.10], [0.76, 0.79, 0.84]),
      ),
      "jr-yokosuka": createStaticMeshVao(
        gl,
        buildRailcarMesh([0.89, 0.90, 0.88], [0.06, 0.38, 0.76], [0.75, 0.78, 0.82]),
      ),
      "keikyu-main": createStaticMeshVao(
        gl,
        buildRailcarMesh([0.85, 0.15, 0.20], [0.97, 0.95, 0.90], [0.80, 0.80, 0.82]),
      ),
      "sotetsu-main": createStaticMeshVao(
        gl,
        buildRailcarMesh([0.12, 0.24, 0.50], [0.18, 0.34, 0.68], [0.24, 0.28, 0.36]),
      ),
    };

    this.boatMeshes = {
      cruise: createStaticMeshVao(gl, buildCruiseShipMesh()),
      cruiser: createStaticMeshVao(gl, buildCruiserMesh()),
      waterbus: createStaticMeshVao(gl, buildWaterbusMesh()),
      tug: createStaticMeshVao(gl, buildTugMesh()),
    };

    this.wakeMesh = createStaticMeshVao(gl, buildWakeMesh());

    const cabinBuilt = buildAirCabinStructureMesh(camera);
    this.airCabinOriginLocalM = cabinBuilt.originLocalM;
    this.airCabinStructureMesh = createStaticMeshVao(gl, cabinBuilt.mesh);
    this.airCabinGondolaMeshes = {
      day: createStaticMeshVao(gl, buildAirCabinGondolaMesh(false)),
      night: createStaticMeshVao(gl, buildAirCabinGondolaMesh(true)),
    };

    this.planeMeshes = {
      heavyJet: createStaticMeshVao(gl, buildPlaneMesh("heavyJet")),
      narrowJet: createStaticMeshVao(gl, buildPlaneMesh("narrowJet")),
      heli: createStaticMeshVao(gl, buildPlaneMesh("heli")),
    };
    this.planeShadowMeshes = {
      heavyJet: createStaticMeshVao(gl, buildPlaneShadowMesh("heavyJet")),
      narrowJet: createStaticMeshVao(gl, buildPlaneShadowMesh("narrowJet")),
      heli: createStaticMeshVao(gl, buildPlaneShadowMesh("heli")),
    };

    const mVao = gl.createVertexArray();
    const mBuf = gl.createBuffer();
    if (!mVao || !mBuf) throw new Error("Failed to create marker buffer");
    gl.bindVertexArray(mVao);
    gl.bindBuffer(gl.ARRAY_BUFFER, mBuf);
    gl.bufferData(
      gl.ARRAY_BUFFER,
      new Float32Array([-1, -1, 1, -1, -1, 1, -1, 1, 1, -1, 1, 1]),
      gl.STATIC_DRAW,
    );
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);

    // Cosmo Clock 21 vertical billboard quad VAO (-1..1 UV)
    const cVao = gl.createVertexArray();
    const cBuf = gl.createBuffer();
    if (!cVao || !cBuf) throw new Error("Failed to create Cosmo Clock VAO");
    this.cosmoVao = cVao;
    gl.bindVertexArray(cVao);
    gl.bindBuffer(gl.ARRAY_BUFFER, cBuf);
    gl.bufferData(
      gl.ARRAY_BUFFER,
      new Float32Array([-1, -1, 1, -1, -1, 1, -1, 1, 1, -1, 1, 1]),
      gl.STATIC_DRAW,
    );
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    this.markerVao = mVao;

    gl.bindVertexArray(null);
  }

  setStreetlights(points: Float32Array | null): void {
    const gl = this.gl;
    if (!points || points.length < 4) {
      this.lampCount = 0;
      return;
    }
    this.lampCount = Math.floor(points.length / 4);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.lampInstanceBuf);
    gl.bufferData(gl.ARRAY_BUFFER, points.subarray(0, this.lampCount * 4), gl.STATIC_DRAW);
    gl.bindBuffer(gl.ARRAY_BUFFER, null);
  }

  setPedestrians(points: Float32Array | null): void {
    const gl = this.gl;
    if (!points || points.length < 4) {
      this.pedCount = 0;
      return;
    }
    this.pedCount = Math.floor(points.length / 4);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.pedInstanceBuf);
    gl.bufferData(gl.ARRAY_BUFFER, points.subarray(0, this.pedCount * 4), gl.STATIC_DRAW);
    gl.bindBuffer(gl.ARRAY_BUFFER, null);
  }

  private bindCommonDepthUniforms(prog: WebGLProgram): void {
    const gl = this.gl;
    const c = this.camera;
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D_ARRAY, this.depthArrayTex);
    gl.uniform1i(gl.getUniformLocation(prog, "u_depthTiles"), 0);
    gl.uniform1i(gl.getUniformLocation(prog, "u_imageWidth"), c.imageWidthPx);
    gl.uniform1i(gl.getUniformLocation(prog, "u_imageHeight"), c.imageHeightPx);
    gl.uniform1i(gl.getUniformLocation(prog, "u_dataTileSize"), c.dataTileGrid.tileSizePx);
    gl.uniform1i(gl.getUniformLocation(prog, "u_cols"), c.dataTileGrid.cols);
    gl.uniform1i(gl.getUniformLocation(prog, "u_rows"), c.dataTileGrid.rows);
    gl.uniform1f(gl.getUniformLocation(prog, "u_nearM"), c.nearM);
    gl.uniform1f(gl.getUniformLocation(prog, "u_farM"), c.farM);
    gl.uniform1f(gl.getUniformLocation(prog, "u_dataScale"), c.dataTileGrid.scale ?? 1.0);
  }

  render(opts: OverlayRenderOptions): void {
    const gl = this.gl;
    const dpr = Math.min(2.5, window.devicePixelRatio || 1);
    const targetW = Math.max(1, Math.round(opts.viewportCssWidth * dpr));
    const targetH = Math.max(1, Math.round(opts.viewportCssHeight * dpr));
    if (this.canvas.width !== targetW || this.canvas.height !== targetH) {
      this.canvas.width = targetW;
      this.canvas.height = targetH;
    }

    gl.viewport(0, 0, targetW, targetH);
    gl.clearColor(0, 0, 0, 0);
    gl.clearDepth(1.0);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);

    gl.enable(gl.BLEND);
    gl.blendFuncSeparate(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA, gl.ONE, gl.ONE_MINUS_SRC_ALPHA);

    // 1. Fullscreen overlay (horizon glow, road and quay light pools, depth/grid QA)
    gl.disable(gl.DEPTH_TEST);
    gl.useProgram(this.overlayProg);
    this.bindCommonDepthUniforms(this.overlayProg);
    gl.uniform2f(
      gl.getUniformLocation(this.overlayProg, "u_viewTopLeftPx"),
      opts.viewTopLeftImgPx.x,
      opts.viewTopLeftImgPx.y,
    );
    gl.uniform2f(
      gl.getUniformLocation(this.overlayProg, "u_viewBottomRightPx"),
      opts.viewBottomRightImgPx.x,
      opts.viewBottomRightImgPx.y,
    );
    gl.uniform4f(
      gl.getUniformLocation(this.overlayProg, "u_glowTint"),
      opts.glowTintRgba[0],
      opts.glowTintRgba[1],
      opts.glowTintRgba[2],
      opts.glowTintRgba[3],
    );
    gl.uniform1f(gl.getUniformLocation(this.overlayProg, "u_nightIntensity"), opts.nightIntensity);
    gl.uniform1f(gl.getUniformLocation(this.overlayProg, "u_showDepth"), opts.showDepthMap ? 1 : 0);
    gl.uniform1f(gl.getUniformLocation(this.overlayProg, "u_showTileGrid"), opts.showTileGrid ? 1 : 0);
    gl.uniform1i(
      gl.getUniformLocation(this.overlayProg, "u_workingTileSize"),
      this.camera.workingGrid.tileSizePx,
    );
    gl.uniform1i(
      gl.getUniformLocation(this.overlayProg, "u_workingOverlap"),
      this.camera.workingGrid.overlapPx,
    );
    gl.uniform1f(gl.getUniformLocation(this.overlayProg, "u_simTimeSec"), opts.simTimeSec);
    gl.uniform1f(
      gl.getUniformLocation(this.overlayProg, "u_sunAltitudeDeg"),
      opts.sunAltitudeDeg ?? 28,
    );
    gl.uniform1f(
      gl.getUniformLocation(this.overlayProg, "u_reducedMotion"),
      opts.reducedMotion ? 1 : 0,
    );
    gl.uniform1f(
      gl.getUniformLocation(this.overlayProg, "u_cloudCover"),
      opts.cloudCover ?? 0.2,
    );
    gl.uniform1f(
      gl.getUniformLocation(this.overlayProg, "u_mistIntensity"),
      opts.mistIntensity ?? 0,
    );
    gl.uniform1f(
      gl.getUniformLocation(this.overlayProg, "u_windSpeed"),
      opts.windSpeedKmh ?? 10,
    );

    gl.bindVertexArray(this.emptyVao);
    gl.drawArrays(gl.TRIANGLES, 0, 6);

    // 1a. Illustrated miniature pedestrians along sidewalks, plazas & piers (strolling & rain umbrellas)
    if (this.pedCount > 0 && opts.pedAlpha > 0.01) {
      gl.useProgram(this.pedProg);
      this.bindCommonDepthUniforms(this.pedProg);
      gl.uniform2f(
        gl.getUniformLocation(this.pedProg, "u_viewTopLeftPx"),
        opts.viewTopLeftImgPx.x,
        opts.viewTopLeftImgPx.y,
      );
      gl.uniform2f(
        gl.getUniformLocation(this.pedProg, "u_viewBottomRightPx"),
        opts.viewBottomRightImgPx.x,
        opts.viewBottomRightImgPx.y,
      );
      gl.uniform1f(gl.getUniformLocation(this.pedProg, "u_pedAlpha"), opts.pedAlpha);
      gl.uniform1f(gl.getUniformLocation(this.pedProg, "u_simTimeSec"), opts.simTimeSec);
      gl.uniform1f(gl.getUniformLocation(this.pedProg, "u_rainIntensity"), opts.rainIntensity);
      gl.uniform1f(
        gl.getUniformLocation(this.pedProg, "u_reducedMotion"),
        opts.reducedMotion ? 1 : 0,
      );
      gl.uniform3f(
        gl.getUniformLocation(this.pedProg, "u_skyTintRgb"),
        opts.skyTintRgb[0],
        opts.skyTintRgb[1],
        opts.skyTintRgb[2],
      );
      gl.bindVertexArray(this.pedVao);
      gl.drawArraysInstanced(gl.TRIANGLES, 0, 6, this.pedCount);
    }

    // 1b. City-wide OSM streetlamps along all Yokohama roads & plazas at dusk/night
    if (this.lampCount > 0 && opts.nightIntensity > 0.05) {
      gl.useProgram(this.lampProg);
      this.bindCommonDepthUniforms(this.lampProg);
      gl.uniform2f(
        gl.getUniformLocation(this.lampProg, "u_viewTopLeftPx"),
        opts.viewTopLeftImgPx.x,
        opts.viewTopLeftImgPx.y,
      );
      gl.uniform2f(
        gl.getUniformLocation(this.lampProg, "u_viewBottomRightPx"),
        opts.viewBottomRightImgPx.x,
        opts.viewBottomRightImgPx.y,
      );
      gl.uniform1f(gl.getUniformLocation(this.lampProg, "u_nightIntensity"), opts.nightIntensity);
      gl.bindVertexArray(this.lampVao);
      gl.drawArraysInstanced(gl.TRIANGLES, 0, 6, this.lampCount);
    }

    // 1c. Ground-projected Gaussian car headlights & red brake/taillight halos (drawn before 3D cars)
    const hasAmbientCars =
      opts.ambientCars.length > 0 && (opts.carAlpha > 0.01 || opts.selectedRideCarId != null);
    const imgPxPerCssPx =
      (opts.viewBottomRightImgPx.x - opts.viewTopLeftImgPx.x) / Math.max(1, opts.viewportCssWidth);
    const beamHeadIntensity =
      opts.carAlpha * Math.max(opts.nightIntensity * 0.94, opts.rainIntensity * 0.48);

    if (hasAmbientCars && (beamHeadIntensity > 0.03 || opts.nightIntensity > 0.08 || opts.ambientCars.some((x) => x.braking))) {
      const c = this.camera;
      const lightFloats: number[] = [];
      for (const ac of opts.ambientCars) {
        const originLocal = wgs84ToLocal(c, ac.lon, ac.lat, ac.elevM + 0.35);
        const rad = (ac.bearingDeg * Math.PI) / 180;
        const aheadLocal = [
          originLocal[0] + Math.sin(rad),
          originLocal[1] + Math.cos(rad),
          originLocal[2],
        ] as const;
        const p0 = localToImage(c, originLocal);
        const p1 = localToImage(c, aheadLocal);
        const dx = p1.px - p0.px;
        const dy = p1.py - p0.py;
        const pxPerM = Math.hypot(dx, dy) || 1;
        const dirX = dx / pxPerM;
        const dirY = dy / pxPerM;

        if (beamHeadIntensity > 0.03) {
          lightFloats.push(
            p0.px + dirX * (2.15 * pxPerM),
            p0.py + dirY * (2.15 * pxPerM),
            p0.depthM,
            beamHeadIntensity,
            dirX,
            dirY,
            pxPerM,
            0,
          );
        }
        const tailIntensity =
          opts.carAlpha * Math.max(opts.nightIntensity * 0.68, ac.braking ? 0.80 : 0);
        if (tailIntensity > 0.03) {
          lightFloats.push(
            p0.px - dirX * (2.20 * pxPerM),
            p0.py - dirY * (2.20 * pxPerM),
            p0.depthM,
            tailIntensity,
            dirX,
            dirY,
            pxPerM,
            1,
          );
        }
      }

      if (lightFloats.length >= 8) {
        gl.useProgram(this.carLightProg);
        this.bindCommonDepthUniforms(this.carLightProg);
        gl.uniform2f(
          gl.getUniformLocation(this.carLightProg, "u_viewTopLeftPx"),
          opts.viewTopLeftImgPx.x,
          opts.viewTopLeftImgPx.y,
        );
        gl.uniform2f(
          gl.getUniformLocation(this.carLightProg, "u_viewBottomRightPx"),
          opts.viewBottomRightImgPx.x,
          opts.viewBottomRightImgPx.y,
        );
        gl.bindVertexArray(this.carLightVao);
        gl.bindBuffer(gl.ARRAY_BUFFER, this.carLightInstanceBuf);
        gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(lightFloats), gl.DYNAMIC_DRAW);
        gl.drawArraysInstanced(gl.TRIANGLES, 0, 6, lightFloats.length / 8);
      }
    }

    // 2. 3D Depth-Occluded Wakes, Ships, Multi-Livery Buses, Multi-Car Trains, Air Cabin, Shadows & Ambient Cars
    const planes = opts.planes ?? [];
    const airCabins = opts.airCabins ?? [];
    const showAirCabin = Boolean(opts.showAirCabin);
    const hasMovingObjects =
      opts.vehicles.length > 0 ||
      opts.portCalls.length > 0 ||
      opts.trains.length > 0 ||
      showAirCabin ||
      planes.length > 0 ||
      hasAmbientCars;
    if (hasMovingObjects) {
      gl.enable(gl.DEPTH_TEST);
      gl.depthFunc(gl.LEQUAL);
      gl.useProgram(this.vehicleProg);
      this.bindCommonDepthUniforms(this.vehicleProg);

      const c = this.camera;
      gl.uniform3fv(
        gl.getUniformLocation(this.vehicleProg, "u_cameraOriginLocalM"),
        c.cameraOriginLocalM,
      );
      gl.uniform3fv(gl.getUniformLocation(this.vehicleProg, "u_camRight"), c.basis.right);
      gl.uniform3fv(gl.getUniformLocation(this.vehicleProg, "u_camUp"), c.basis.up);
      gl.uniform3fv(gl.getUniformLocation(this.vehicleProg, "u_camForward"), c.basis.forward);
      gl.uniform2f(
        gl.getUniformLocation(this.vehicleProg, "u_imageOriginPx"),
        c.imageOriginPx.x,
        c.imageOriginPx.y,
      );
      gl.uniform1f(gl.getUniformLocation(this.vehicleProg, "u_metersPerPixel"), c.metersPerPixel);
      gl.uniform2f(
        gl.getUniformLocation(this.vehicleProg, "u_viewTopLeftPx"),
        opts.viewTopLeftImgPx.x,
        opts.viewTopLeftImgPx.y,
      );
      gl.uniform2f(
        gl.getUniformLocation(this.vehicleProg, "u_viewBottomRightPx"),
        opts.viewBottomRightImgPx.x,
        opts.viewBottomRightImgPx.y,
      );
      gl.uniform1f(gl.getUniformLocation(this.vehicleProg, "u_depthBiasM"), 0.14);
      gl.uniform1f(gl.getUniformLocation(this.vehicleProg, "u_xrayMode"), opts.xrayOcclusion ? 1 : 0);

      const uOriginLoc = gl.getUniformLocation(this.vehicleProg, "u_vehicleOriginLocalM");
      const uHeadingLoc = gl.getUniformLocation(this.vehicleProg, "u_headingRad");
      const uScaleLoc = gl.getUniformLocation(this.vehicleProg, "u_meshScale");
      const uTintLoc = gl.getUniformLocation(this.vehicleProg, "u_tint");
      const uSelectedLoc = gl.getUniformLocation(this.vehicleProg, "u_isSelected");
      const uGhostLoc = gl.getUniformLocation(this.vehicleProg, "u_occludedGhostAlpha");
      const uOutlineExpandLoc = gl.getUniformLocation(this.vehicleProg, "u_outlineExpandM");
      const uIsOutlineLoc = gl.getUniformLocation(this.vehicleProg, "u_isOutline");
      const uAlphaLoc = gl.getUniformLocation(this.vehicleProg, "u_alpha");
      const vBri = Math.max(0.84, opts.vehicleBrightness);

      gl.uniform1f(uGhostLoc, 0);
      gl.uniform1f(uOutlineExpandLoc, 0);
      gl.uniform1f(uIsOutlineLoc, 0);

      // 2a. Soft white foam wakes behind moving boats
      if (opts.portCalls.length > 0 && !opts.xrayOcclusion) {
        gl.depthMask(false);
        gl.bindVertexArray(this.wakeMesh.vao);
        for (let i = 0; i < opts.portCalls.length; i++) {
          const pc = opts.portCalls[i]!;
          if (pc.moving === false) continue;
          const localPos = wgs84ToLocal(c, pc.lon, pc.lat, 0.08);
          const headingRad = ((pc.bearingDeg ?? 45) * Math.PI) / 180;
          const w = pc.widthM ?? 8;
          const len = pc.lengthM ?? 30;
          const pulse = 0.88 + 0.12 * Math.sin(opts.simTimeSec * 2.4 + i * 1.1);
          gl.uniform3f(uOriginLoc, localPos[0], localPos[1], localPos[2]);
          gl.uniform1f(uHeadingLoc, headingRad);
          gl.uniform3f(uScaleLoc, w * pulse, len * (0.72 + 0.28 * pulse), 1);
          gl.uniform3f(uTintLoc, Math.max(0.74, vBri), Math.max(0.78, vBri), Math.max(0.86, vBri));
          gl.uniform1f(uSelectedLoc, 0);
          gl.uniform1f(uAlphaLoc, 0.42);
          gl.drawArrays(gl.TRIANGLES, 0, this.wakeMesh.count);
        }
        gl.depthMask(true);
      }

      // 2b. 3D Miniature Yokohama Ships & Water Buses
      for (const pc of opts.portCalls) {
        const kind: VesselKind = pc.vesselKind ?? "cruise";
        const mesh = this.boatMeshes[kind];
        const localPos = wgs84ToLocal(c, pc.lon, pc.lat, 0.15);
        const isSelected = opts.selectedPortCallId === pc.id;
        gl.bindVertexArray(mesh.vao);
        gl.uniform3f(uOriginLoc, localPos[0], localPos[1], localPos[2]);
        gl.uniform1f(uHeadingLoc, ((pc.bearingDeg ?? 45) * Math.PI) / 180);
        gl.uniform3f(uScaleLoc, pc.widthM ?? 10, pc.lengthM ?? 42, pc.heightM ?? 10);
        const sTint = isSelected ? 1.2 : 1.0;
        gl.uniform3f(uTintLoc, sTint * vBri, sTint * vBri, sTint * vBri);
        gl.uniform1f(uSelectedLoc, isSelected ? 1 : 0);
        gl.uniform1f(uAlphaLoc, 1.0);
        gl.drawArrays(gl.TRIANGLES, 0, mesh.count);
      }

      // 2c. Multi-Livery Yokohama Buses
      gl.uniform3f(uScaleLoc, 1, 1, 1);
      gl.uniform1f(uAlphaLoc, 1.0);
      for (const rv of opts.vehicles) {
        const v: VehicleRecord = rv.record;
        const mesh = v.articulated
          ? this.busMeshes.articulated
          : v.routeId === "akai-kutsu"
            ? this.busMeshes.retro
            : v.routeId === "pier-line"
              ? this.busMeshes.pierLine
              : this.busMeshes.cityBus;
        gl.bindVertexArray(mesh.vao);

        const localPos = wgs84ToLocal(c, v.lon, v.lat, v.roadElevationM);
        gl.uniform3f(uOriginLoc, localPos[0], localPos[1], localPos[2]);
        gl.uniform1f(uHeadingLoc, (v.bearingDeg * Math.PI) / 180);

        let tint: [number, number, number] = [1, 1, 1];
        if (rv.displayMode === "stale") tint = [0.95, 0.78, 0.35];
        else if (rv.displayMode === "scheduled") tint = [0.94, 0.98, 1.02];
        if (opts.selectedVehicleId === v.entityId) {
          tint = [1.24, 1.24, 1.08];
        }
        gl.uniform3f(uTintLoc, tint[0] * vBri, tint[1] * vBri, tint[2] * vBri);
        const isSel = opts.selectedVehicleId === v.entityId;
        gl.uniform1f(uSelectedLoc, isSel ? 1 : 0);
        gl.uniform1f(uGhostLoc, isSel ? 0.36 : 0.22);
        gl.drawArrays(gl.TRIANGLES, 0, mesh.count);
      }

      // 2d. Multi-Car Real-Track Yokohama Trains (JR, Keikyu, Sotetsu)
      for (const tr of opts.trains) {
        const mesh = this.railMeshes[tr.lineId];
        gl.bindVertexArray(mesh.vao);
        const isSelected = opts.selectedTrainId === tr.id;
        const sTint = isSelected ? 1.22 : 1.0;
        const nightPop = 1.0 + opts.nightIntensity * 0.16;
        gl.uniform3f(uScaleLoc, tr.carWidthM, tr.carLengthM, tr.carHeightM);
        gl.uniform3f(uTintLoc, sTint * vBri * nightPop, sTint * vBri * nightPop, sTint * vBri * nightPop);
        gl.uniform1f(uSelectedLoc, isSelected ? 1 : 0);
        gl.uniform1f(uGhostLoc, isSelected ? 0.36 : 0.22);
        gl.uniform1f(uAlphaLoc, 1.0);
        for (const car of tr.cars) {
          const localPos = wgs84ToLocal(c, car.lon, car.lat, car.elevM);
          gl.uniform3f(uOriginLoc, localPos[0], localPos[1], localPos[2]);
          gl.uniform1f(uHeadingLoc, (car.bearingDeg * Math.PI) / 180);
          gl.drawArrays(gl.TRIANGLES, 0, mesh.count);
        }
      }

      // 2e. Ambient zoom-in Yokohama street cars + Ride Along autonomous pod highlight
      if (hasAmbientCars) {
        const drawAmbientFleet = (outlinesOnly: boolean) => {
          for (const ac of opts.ambientCars) {
            const isSelRide =
              opts.selectedRideCarId !== null &&
              opts.selectedRideCarId !== undefined &&
              ac.carId === opts.selectedRideCarId;
            if (!isSelRide && outlinesOnly && (imgPxPerCssPx >= 1.8 || opts.carAlpha <= 0.5)) {
              continue;
            }
            const mesh =
              ac.kind === 1
                ? this.taxiMesh
                : ac.kind === 2
                  ? this.vanMesh
                  : ac.kind === 3
                    ? this.truckMesh
                    : ac.kind === 4
                      ? this.podCarMesh
                      : this.sedanMeshes[ac.colorIdx % this.sedanMeshes.length]!;
            gl.bindVertexArray(mesh.vao);
            const localPos = wgs84ToLocal(c, ac.lon, ac.lat, ac.elevM);
            gl.uniform3f(uOriginLoc, localPos[0], localPos[1], localPos[2]);
            gl.uniform1f(uHeadingLoc, (ac.bearingDeg * Math.PI) / 180);
            if (!outlinesOnly) {
              if (isSelRide) {
                gl.uniform3f(uTintLoc, 1.15 * vBri, 1.32 * vBri, 1.38 * vBri);
                gl.uniform1f(uSelectedLoc, 1);
                gl.uniform1f(uGhostLoc, 0.36);
                gl.uniform1f(uAlphaLoc, 1.0);
              } else {
                gl.uniform3f(uTintLoc, vBri, vBri, vBri);
                gl.uniform1f(uSelectedLoc, 0);
                gl.uniform1f(uGhostLoc, 0);
                gl.uniform1f(uAlphaLoc, opts.carAlpha);
              }
            }
            gl.drawArrays(gl.TRIANGLES, 0, mesh.count);
          }
        };

        gl.uniform3f(uScaleLoc, 1, 1, 1);
        gl.uniform1f(uOutlineExpandLoc, 0);
        gl.uniform1f(uIsOutlineLoc, 0);
        drawAmbientFleet(false);

        if ((imgPxPerCssPx < 1.8 && opts.carAlpha > 0.5) || opts.selectedRideCarId != null) {
          gl.uniform1f(uOutlineExpandLoc, 0.14);
          gl.uniform1f(uIsOutlineLoc, 1);
          drawAmbientFleet(true);
          gl.uniform1f(uOutlineExpandLoc, 0);
          gl.uniform1f(uIsOutlineLoc, 0);
        }
      }

      // 2f. YOKOHAMA AIR CABIN support pylons, haul cables & 16 circulating glass gondolas
      if (showAirCabin) {
        gl.bindVertexArray(this.airCabinStructureMesh.vao);
        gl.uniform3f(
          uOriginLoc,
          this.airCabinOriginLocalM[0],
          this.airCabinOriginLocalM[1],
          this.airCabinOriginLocalM[2],
        );
        gl.uniform1f(uHeadingLoc, 0);
        gl.uniform3f(uScaleLoc, 1, 1, 1);
        gl.uniform3f(uTintLoc, vBri, vBri, vBri);
        gl.uniform1f(uSelectedLoc, 0);
        gl.uniform1f(uGhostLoc, 0);
        gl.uniform1f(uAlphaLoc, 1.0);
        gl.drawArrays(gl.TRIANGLES, 0, this.airCabinStructureMesh.count);

        const gondolaMesh =
          opts.nightIntensity > 0.35
            ? this.airCabinGondolaMeshes.night
            : this.airCabinGondolaMeshes.day;
        gl.bindVertexArray(gondolaMesh.vao);
        const gondolaNightGlow = opts.nightIntensity > 0.35 ? 1.0 + opts.nightIntensity * 0.25 : 1.0;

        for (const cabin of airCabins) {
          const isSelected = opts.selectedAirCabinId === cabin.id;
          const sTint = isSelected ? 1.24 : 1.0;
          const localPos = wgs84ToLocal(c, cabin.lon, cabin.lat, cabin.cableElevM);
          gl.uniform3f(uOriginLoc, localPos[0], localPos[1], localPos[2]);
          gl.uniform1f(uHeadingLoc, (cabin.bearingDeg * Math.PI) / 180);
          gl.uniform3f(uScaleLoc, 1, 1, 1);
          gl.uniform3f(
            uTintLoc,
            sTint * vBri * gondolaNightGlow,
            sTint * vBri * gondolaNightGlow,
            sTint * vBri * gondolaNightGlow,
          );
          gl.uniform1f(uSelectedLoc, isSelected ? 1 : 0);
          gl.uniform1f(uGhostLoc, isSelected ? 0.35 : 0.14);
          gl.uniform1f(uAlphaLoc, 1.0);
          gl.drawArrays(gl.TRIANGLES, 0, gondolaMesh.count);

          if (imgPxPerCssPx < 2.6) {
            gl.uniform1f(uOutlineExpandLoc, 0.12);
            gl.uniform1f(uIsOutlineLoc, 1);
            gl.drawArrays(gl.TRIANGLES, 0, gondolaMesh.count);
            gl.uniform1f(uOutlineExpandLoc, 0);
            gl.uniform1f(uIsOutlineLoc, 0);
          }
        }
      }

      // 2g. Projected soft ground shadows under live ADS-B / harbor aircraft
      const planeScale = Math.min(2.15, Math.max(0.95, 0.85 + imgPxPerCssPx * 0.14));
      if (planes.length > 0 && !opts.xrayOcclusion) {
        gl.depthMask(false);
        gl.uniform1f(gl.getUniformLocation(this.vehicleProg, "u_depthBiasM"), 3.0);
        gl.uniform1f(uSelectedLoc, 0);
        gl.uniform1f(uGhostLoc, 0);
        gl.uniform1f(uAlphaLoc, Math.max(0.05, 0.22 * (1.0 - opts.nightIntensity * 0.72)));
        gl.uniform3f(uTintLoc, 1, 1, 1);

        for (const p of planes) {
          const sMesh = this.planeShadowMeshes[p.meshKind];
          gl.bindVertexArray(sMesh.vao);
          const localPos = wgs84ToLocal(c, p.lon, p.lat, 2.0);
          gl.uniform3f(uOriginLoc, localPos[0] + 28, localPos[1] + 18, localPos[2]);
          gl.uniform1f(uHeadingLoc, (p.trackDeg * Math.PI) / 180);
          gl.uniform3f(uScaleLoc, planeScale, planeScale, 1);
          gl.drawArrays(gl.TRIANGLES, 0, sMesh.count);
        }
        gl.depthMask(true);
        gl.uniform1f(gl.getUniformLocation(this.vehicleProg, "u_depthBiasM"), 0.14);
      }
    }

    // 2h. Cosmo Clock 21 animated 3D Ferris wheel + night LED illumination + live JST clock
    if (opts.showCosmoClock !== false && opts.cosmoClock) {
      const c = this.camera;
      const cosmo = opts.cosmoClock;
      const rawHub = wgs84ToLocal(
        c,
        COSMO_CLOCK_ORIGIN.lon,
        COSMO_CLOCK_ORIGIN.lat,
        COSMO_CLOCK_ORIGIN.hubElevM,
      );
      // Offset 14m toward camera along -forward so the wheel stands clean against skyline/sky
      const hubPos: readonly [number, number, number] = [
        rawHub[0] - c.basis.forward[0] * 14,
        rawHub[1] - c.basis.forward[1] * 14,
        rawHub[2] - c.basis.forward[2] * 14,
      ];
      const az = (COSMO_CLOCK_ORIGIN.planeAzimuthDeg * Math.PI) / 180;

      gl.disable(gl.DEPTH_TEST);
      gl.useProgram(this.cosmoProg);
      this.bindCommonDepthUniforms(this.cosmoProg);
      gl.uniform3fv(
        gl.getUniformLocation(this.cosmoProg, "u_cameraOriginLocalM"),
        c.cameraOriginLocalM,
      );
      gl.uniform3fv(gl.getUniformLocation(this.cosmoProg, "u_camRight"), c.basis.right);
      gl.uniform3fv(gl.getUniformLocation(this.cosmoProg, "u_camUp"), c.basis.up);
      gl.uniform3fv(gl.getUniformLocation(this.cosmoProg, "u_camForward"), c.basis.forward);
      gl.uniform2f(
        gl.getUniformLocation(this.cosmoProg, "u_imageOriginPx"),
        c.imageOriginPx.x,
        c.imageOriginPx.y,
      );
      gl.uniform1f(gl.getUniformLocation(this.cosmoProg, "u_metersPerPixel"), c.metersPerPixel);
      gl.uniform2f(
        gl.getUniformLocation(this.cosmoProg, "u_viewTopLeftPx"),
        opts.viewTopLeftImgPx.x,
        opts.viewTopLeftImgPx.y,
      );
      gl.uniform2f(
        gl.getUniformLocation(this.cosmoProg, "u_viewBottomRightPx"),
        opts.viewBottomRightImgPx.x,
        opts.viewBottomRightImgPx.y,
      );
      gl.uniform3f(
        gl.getUniformLocation(this.cosmoProg, "u_centerLocalM"),
        hubPos[0],
        hubPos[1],
        hubPos[2],
      );
      gl.uniform3f(
        gl.getUniformLocation(this.cosmoProg, "u_wheelRightLocal"),
        Math.sin(az),
        Math.cos(az),
        0,
      );
      gl.uniform1f(
        gl.getUniformLocation(this.cosmoProg, "u_radiusM"),
        COSMO_CLOCK_ORIGIN.wheelRadiusM,
      );
      gl.uniform1f(gl.getUniformLocation(this.cosmoProg, "u_nightIntensity"), opts.nightIntensity);
      gl.uniform1f(gl.getUniformLocation(this.cosmoProg, "u_xrayMode"), opts.xrayOcclusion ? 1 : 0);
      gl.uniform1f(gl.getUniformLocation(this.cosmoProg, "u_simTimeSec"), opts.simTimeSec);
      gl.uniform1f(gl.getUniformLocation(this.cosmoProg, "u_wheelAngleRad"), cosmo.wheelAngleRad);
      gl.uniform1f(gl.getUniformLocation(this.cosmoProg, "u_showMode"), cosmo.showMode);
      gl.uniform4i(
        gl.getUniformLocation(this.cosmoProg, "u_clockDigits"),
        cosmo.digits[0],
        cosmo.digits[1],
        cosmo.digits[2],
        cosmo.digits[3],
      );
      gl.uniform1f(gl.getUniformLocation(this.cosmoProg, "u_colonOn"), cosmo.colonOn ? 1 : 0);

      gl.bindVertexArray(this.cosmoVao);
      gl.drawArrays(gl.TRIANGLES, 0, 6);
    }

    // 2b. Fluffy Zoomed-Out Cumulus Clouds framing outer areas & canvas sky edge
    gl.disable(gl.DEPTH_TEST);
    gl.useProgram(this.cloudProg);
    gl.uniform2f(
      gl.getUniformLocation(this.cloudProg, "u_viewTopLeftPx"),
      opts.viewTopLeftImgPx.x,
      opts.viewTopLeftImgPx.y,
    );
    gl.uniform2f(
      gl.getUniformLocation(this.cloudProg, "u_viewBottomRightPx"),
      opts.viewBottomRightImgPx.x,
      opts.viewBottomRightImgPx.y,
    );
    gl.uniform1i(gl.getUniformLocation(this.cloudProg, "u_imageWidth"), this.camera.imageWidthPx);
    gl.uniform1i(gl.getUniformLocation(this.cloudProg, "u_imageHeight"), this.camera.imageHeightPx);
    gl.uniform1f(gl.getUniformLocation(this.cloudProg, "u_imgPxPerCssPx"), imgPxPerCssPx);
    gl.uniform1f(gl.getUniformLocation(this.cloudProg, "u_simTimeSec"), opts.simTimeSec);
    gl.uniform1f(gl.getUniformLocation(this.cloudProg, "u_cloudCover"), opts.cloudCover ?? 0.25);
    gl.uniform1f(gl.getUniformLocation(this.cloudProg, "u_reducedMotion"), opts.reducedMotion ? 1 : 0);
    gl.uniform3f(
      gl.getUniformLocation(this.cloudProg, "u_cloudShadowRgb"),
      opts.cloudShadowRgb[0],
      opts.cloudShadowRgb[1],
      opts.cloudShadowRgb[2],
    );
    gl.uniform3f(
      gl.getUniformLocation(this.cloudProg, "u_cloudBaseRgb"),
      opts.cloudBaseRgb[0],
      opts.cloudBaseRgb[1],
      opts.cloudBaseRgb[2],
    );
    gl.uniform3f(
      gl.getUniformLocation(this.cloudProg, "u_cloudHighlightRgb"),
      opts.cloudHighlightRgb[0],
      opts.cloudHighlightRgb[1],
      opts.cloudHighlightRgb[2],
    );
    gl.bindVertexArray(this.emptyVao);
    gl.drawArrays(gl.TRIANGLES, 0, 6);

    // 2c. High-altitude 3D ADS-B & Haneda/Bay Aircraft rendered above clouds and skyscrapers
    if (planes.length > 0) {
      gl.enable(gl.DEPTH_TEST);
      gl.depthFunc(gl.LEQUAL);
      gl.useProgram(this.vehicleProg);
      this.bindCommonDepthUniforms(this.vehicleProg);

      const c = this.camera;
      gl.uniform3fv(
        gl.getUniformLocation(this.vehicleProg, "u_cameraOriginLocalM"),
        c.cameraOriginLocalM,
      );
      gl.uniform3fv(gl.getUniformLocation(this.vehicleProg, "u_camRight"), c.basis.right);
      gl.uniform3fv(gl.getUniformLocation(this.vehicleProg, "u_camUp"), c.basis.up);
      gl.uniform3fv(gl.getUniformLocation(this.vehicleProg, "u_camForward"), c.basis.forward);
      gl.uniform2f(
        gl.getUniformLocation(this.vehicleProg, "u_imageOriginPx"),
        c.imageOriginPx.x,
        c.imageOriginPx.y,
      );
      gl.uniform1f(gl.getUniformLocation(this.vehicleProg, "u_metersPerPixel"), c.metersPerPixel);
      gl.uniform2f(
        gl.getUniformLocation(this.vehicleProg, "u_viewTopLeftPx"),
        opts.viewTopLeftImgPx.x,
        opts.viewTopLeftImgPx.y,
      );
      gl.uniform2f(
        gl.getUniformLocation(this.vehicleProg, "u_viewBottomRightPx"),
        opts.viewBottomRightImgPx.x,
        opts.viewBottomRightImgPx.y,
      );
      gl.uniform1f(gl.getUniformLocation(this.vehicleProg, "u_depthBiasM"), 500.0);
      gl.uniform1f(gl.getUniformLocation(this.vehicleProg, "u_xrayMode"), opts.xrayOcclusion ? 1 : 0);

      const uOriginLoc = gl.getUniformLocation(this.vehicleProg, "u_vehicleOriginLocalM");
      const uHeadingLoc = gl.getUniformLocation(this.vehicleProg, "u_headingRad");
      const uScaleLoc = gl.getUniformLocation(this.vehicleProg, "u_meshScale");
      const uTintLoc = gl.getUniformLocation(this.vehicleProg, "u_tint");
      const uSelectedLoc = gl.getUniformLocation(this.vehicleProg, "u_isSelected");
      const uGhostLoc = gl.getUniformLocation(this.vehicleProg, "u_occludedGhostAlpha");
      const uOutlineExpandLoc = gl.getUniformLocation(this.vehicleProg, "u_outlineExpandM");
      const uIsOutlineLoc = gl.getUniformLocation(this.vehicleProg, "u_isOutline");
      const uAlphaLoc = gl.getUniformLocation(this.vehicleProg, "u_alpha");

      const planeScale = Math.min(2.15, Math.max(0.95, 0.85 + imgPxPerCssPx * 0.14));
      const vBri = Math.max(0.90, opts.vehicleBrightness) * (1.0 + opts.nightIntensity * 0.22);

      for (const p of planes) {
        const mesh = this.planeMeshes[p.meshKind];
        gl.bindVertexArray(mesh.vao);
        const isSelected = opts.selectedPlaneId === p.id;
        const sTint = isSelected ? 1.2 : 1.0;
        const localPos = wgs84ToLocal(c, p.lon, p.lat, p.displayElevM);

        gl.uniform3f(uOriginLoc, localPos[0], localPos[1], localPos[2]);
        gl.uniform1f(uHeadingLoc, (p.trackDeg * Math.PI) / 180);
        gl.uniform3f(uScaleLoc, planeScale, planeScale, planeScale);
        gl.uniform3f(uTintLoc, sTint * vBri, sTint * vBri, sTint * vBri);
        gl.uniform1f(uSelectedLoc, isSelected ? 1 : 0);
        gl.uniform1f(uGhostLoc, 0.35);
        gl.uniform1f(uOutlineExpandLoc, 0);
        gl.uniform1f(uIsOutlineLoc, 0);
        gl.uniform1f(uAlphaLoc, 1.0);
        gl.drawArrays(gl.TRIANGLES, 0, mesh.count);

        if (imgPxPerCssPx < 4.5) {
          gl.uniform1f(uOutlineExpandLoc, 0.24);
          gl.uniform1f(uIsOutlineLoc, 1);
          gl.drawArrays(gl.TRIANGLES, 0, mesh.count);
          gl.uniform1f(uOutlineExpandLoc, 0);
          gl.uniform1f(uIsOutlineLoc, 0);
        }
      }

      gl.disable(gl.DEPTH_TEST);
    }

    // 3. Synchronized Verification Point Markers (Deck point, GCPs)
    gl.useProgram(this.markerProg);
    this.bindCommonDepthUniforms(this.markerProg);
    gl.uniform2f(
      gl.getUniformLocation(this.markerProg, "u_viewTopLeftPx"),
      opts.viewTopLeftImgPx.x,
      opts.viewTopLeftImgPx.y,
    );
    gl.uniform2f(
      gl.getUniformLocation(this.markerProg, "u_viewBottomRightPx"),
      opts.viewBottomRightImgPx.x,
      opts.viewBottomRightImgPx.y,
    );
    gl.uniform2f(
      gl.getUniformLocation(this.markerProg, "u_viewportCssSize"),
      opts.viewportCssWidth,
      opts.viewportCssHeight,
    );
    gl.bindVertexArray(this.markerVao);

    const drawMarker = (
      lon: number,
      lat: number,
      elevM: number,
      radiusCssPx: number,
      checkDepth: boolean,
      fill: readonly [number, number, number, number],
      ring: readonly [number, number, number, number],
    ) => {
      const img = localToImage(this.camera, wgs84ToLocal(this.camera, lon, lat, elevM));
      gl.uniform2f(gl.getUniformLocation(this.markerProg, "u_anchorImgPx"), img.px, img.py);
      gl.uniform1f(gl.getUniformLocation(this.markerProg, "u_anchorDepthM"), img.depthM);
      gl.uniform1f(gl.getUniformLocation(this.markerProg, "u_radiusCssPx"), radiusCssPx);
      gl.uniform1f(gl.getUniformLocation(this.markerProg, "u_checkDepth"), checkDepth ? 1 : 0);
      gl.uniform4fv(gl.getUniformLocation(this.markerProg, "u_fillColor"), fill);
      gl.uniform4fv(gl.getUniformLocation(this.markerProg, "u_ringColor"), ring);
      gl.drawArrays(gl.TRIANGLES, 0, 6);
    };

    if (opts.showDeckTestPoint) {
      drawMarker(
        opts.deckTestPoint.lon,
        opts.deckTestPoint.lat,
        opts.deckTestPoint.elevationM + 0.15,
        7.5,
        true,
        [0.18, 0.92, 0.56, 0.95],
        [1, 1, 1, 0.95],
      );
    }

    if (opts.showGcps) {
      for (const gcp of opts.gcps) {
        drawMarker(
          gcp.lon,
          gcp.lat,
          gcp.elevationM,
          6.0,
          false,
          [0.98, 0.84, 0.22, 0.95],
          [0.12, 0.12, 0.16, 0.95],
        );
      }
    }

    // 4. Falling diagonal rain streaks across the viewport on rainy days
    if (opts.rainIntensity > 0.05) {
      gl.useProgram(this.rainProg);
      gl.uniform2f(
        gl.getUniformLocation(this.rainProg, "u_viewportCssSize"),
        opts.viewportCssWidth,
        opts.viewportCssHeight,
      );
      gl.uniform1f(gl.getUniformLocation(this.rainProg, "u_simTimeSec"), opts.simTimeSec);
      gl.uniform1f(gl.getUniformLocation(this.rainProg, "u_rainIntensity"), opts.rainIntensity);
      gl.uniform1f(gl.getUniformLocation(this.rainProg, "u_windSlope"), opts.windSlope);
      gl.uniform1f(
        gl.getUniformLocation(this.rainProg, "u_reducedMotion"),
        opts.reducedMotion ? 1 : 0,
      );
      gl.bindVertexArray(this.rainVao);
      const streakCount = Math.round(90 + opts.rainIntensity * 90);
      gl.drawArraysInstanced(gl.TRIANGLES, 0, 6, streakCount);
    }

    gl.bindVertexArray(null);
  }
}
