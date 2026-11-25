import {
  localToImage,
  wgs84ToLocal,
  type CameraManifest,
  type GroundControlPoint,
  type VehicleRecord,
} from "@small-yokohama/core";
import type { LoadedTilePixels } from "../data/releaseLoader.js";
import type {
  AnimatedPortCall,
  ResolvedVehicle,
  VesselKind,
} from "../data/vehicleFeed.js";
import {
  FULLSCREEN_VERT,
  MARKER_FRAG,
  MARKER_VERT,
  OVERLAY_FRAG,
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

  // Classic Akai Kutsu two-tone short sightseeing body (9.5m)
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

function buildCruiseShipMesh(): MeshData {
  const verts: number[] = [];
  const navyHull = [0.11, 0.23, 0.39] as const;
  const whiteHull = [0.95, 0.96, 0.98] as const;
  const deckWood = [0.82, 0.76, 0.64] as const;
  const glass = [0.14, 0.24, 0.36] as const;
  const coralFunnel = [0.85, 0.27, 0.22] as const;

  // Waterline + main fuselage + sharp tapered bow (unit scale: width=1, length=1, height=1)
  pushHullTapering(verts, -0.46, 0.22, 0.02, 0.16, 0.48, 0.48, navyHull, whiteHull);
  pushHullTapering(verts, 0.22, 0.5, 0.02, 0.16, 0.48, 0.06, navyHull, whiteHull);

  pushHullTapering(verts, -0.45, 0.2, 0.16, 0.34, 0.49, 0.49, whiteHull, deckWood);
  pushHullTapering(verts, 0.2, 0.48, 0.16, 0.34, 0.49, 0.05, whiteHull, whiteHull);

  // Terraced passenger superstructure decks
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

  // Twin-hull Sea Bass profile
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
  // Twin V-ribbons trailing behind stern (y = -0.42 down to -2.1) at gentle water clearance z = 0.04
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
  nightIntensity: number;
  vehicleBrightness: number;
  simTimeSec: number;
  showDepthMap: boolean;
  xrayOcclusion: boolean;
  showTileGrid: boolean;
  showGcps: boolean;
  showDeckTestPoint: boolean;
  vehicles: readonly ResolvedVehicle[];
  selectedVehicleId: string | null;
  selectedPortCallId: string | null;
  gcps: readonly GroundControlPoint[];
  deckTestPoint: { lon: number; lat: number; elevationM: number };
  portCalls: readonly AnimatedPortCall[];
}

export class WebGLOverlay {
  private readonly gl: WebGL2RenderingContext;
  private readonly overlayProg: WebGLProgram;
  private readonly vehicleProg: WebGLProgram;
  private readonly markerProg: WebGLProgram;
  private readonly depthArrayTex: WebGLTexture;
  private readonly emptyVao: WebGLVertexArrayObject;
  private readonly busMeshes: {
    articulated: { vao: WebGLVertexArrayObject; count: number };
    retro: { vao: WebGLVertexArrayObject; count: number };
    pierLine: { vao: WebGLVertexArrayObject; count: number };
    cityBus: { vao: WebGLVertexArrayObject; count: number };
  };
  private readonly boatMeshes: Record<
    VesselKind,
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
      premultipliedAlpha: false,
    });
    if (!gl) {
      throw new Error("WebGL2 is required for depth-occluded vehicle rendering");
    }
    this.gl = gl;

    this.overlayProg = linkProgram(gl, FULLSCREEN_VERT, OVERLAY_FRAG);
    this.vehicleProg = linkProgram(gl, VEHICLE_VERT, VEHICLE_FRAG);
    this.markerProg = linkProgram(gl, MARKER_VERT, MARKER_FRAG);

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
      if (!tile.bitmap) continue;
      const layer = tile.row * cols + tile.col;
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
        tile.bitmap,
      );
    }

    gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);

    const emptyVao = gl.createVertexArray();
    if (!emptyVao) throw new Error("Failed to create VAO");
    this.emptyVao = emptyVao;

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

    this.boatMeshes = {
      cruise: createStaticMeshVao(gl, buildCruiseShipMesh()),
      cruiser: createStaticMeshVao(gl, buildCruiserMesh()),
      waterbus: createStaticMeshVao(gl, buildWaterbusMesh()),
      tug: createStaticMeshVao(gl, buildTugMesh()),
    };

    this.wakeMesh = createStaticMeshVao(gl, buildWakeMesh());

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
    this.markerVao = mVao;

    gl.bindVertexArray(null);
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

    // 1. Fullscreen overlay (glow horizon, warm night windows & streetlights, depth/grid QA)
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

    gl.bindVertexArray(this.emptyVao);
    gl.drawArrays(gl.TRIANGLES, 0, 6);

    // 2. 3D Depth-Occluded Wakes, Ships & Multi-Livery Buses
    const hasMovingObjects = opts.vehicles.length > 0 || opts.portCalls.length > 0;
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
      const uAlphaLoc = gl.getUniformLocation(this.vehicleProg, "u_alpha");
      const vBri = Math.max(0.78, opts.vehicleBrightness);

      // 2a. Soft white foam wakes behind moving boats (depth-tested so they tuck behind piers)
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
          gl.uniform3f(uTintLoc, Math.max(0.7, vBri), Math.max(0.75, vBri), Math.max(0.84, vBri));
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

      // 2c. Multi-Livery Yokohama Buses (Bayside Blue, Akai Kutsu, Pier Line, Municipal Bus)
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
        gl.uniform1f(uSelectedLoc, opts.selectedVehicleId === v.entityId ? 1 : 0);
        gl.drawArrays(gl.TRIANGLES, 0, mesh.count);
      }
    }

    // 3. Synchronized Verification Point Markers (Deck point, GCPs)
    gl.disable(gl.DEPTH_TEST);
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

    gl.bindVertexArray(null);
  }
}
