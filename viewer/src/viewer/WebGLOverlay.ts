import {
  localToImage,
  wgs84ToLocal,
  type CameraManifest,
  type GroundControlPoint,
  type PortCallRecord,
  type VehicleRecord,
} from "@small-yokohama/core";
import type { LoadedTilePixels } from "../data/releaseLoader.js";
import type { ResolvedVehicle } from "../data/vehicleFeed.js";
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

  const pushTri = (
    p0: readonly [number, number, number],
    p1: readonly [number, number, number],
    p2: readonly [number, number, number],
    n: readonly [number, number, number],
    col: readonly [number, number, number],
  ) => {
    verts.push(
      p0[0], p0[1], p0[2], col[0], col[1], col[2], n[0], n[1], n[2],
      p1[0], p1[1], p1[2], col[0], col[1], col[2], n[0], n[1], n[2],
      p2[0], p2[1], p2[2], col[0], col[1], col[2], n[0], n[1], n[2],
    );
  };

  const pushQuad = (
    a: readonly [number, number, number],
    b: readonly [number, number, number],
    c: readonly [number, number, number],
    d: readonly [number, number, number],
    n: readonly [number, number, number],
    col: readonly [number, number, number],
  ) => {
    pushTri(a, b, c, n, col);
    pushTri(a, c, d, n, col);
  };

  const b0 = [cx - hx, cy - hy, zMin] as const;
  const b1 = [cx + hx, cy - hy, zMin] as const;
  const b2 = [cx + hx, cy + hy, zMin] as const;
  const b3 = [cx - hx, cy + hy, zMin] as const;

  const t0 = [cx - hx, cy - hy, zMax] as const;
  const t1 = [cx + hx, cy - hy, zMax] as const;
  const t2 = [cx + hx, cy + hy, zMax] as const;
  const t3 = [cx - hx, cy + hy, zMax] as const;

  pushQuad(t0, t1, t2, t3, [0, 0, 1], topCol); // roof
  pushQuad(b0, b1, t1, t0, [0, -1, 0], rgb); // rear
  pushQuad(b2, b3, t3, t2, [0, 1, 0], rgb); // front
  pushQuad(b3, b0, t0, t3, [-1, 0, 0], rgb); // left
  pushQuad(b1, b2, t2, t1, [1, 0, 0], rgb); // right
}

function buildArticulatedBusMesh(): { data: Float32Array; vertexCount: number } {
  const verts: number[] = [];
  const baysideBlue = [0.06, 0.45, 0.72] as const;
  const baysideRoof = [0.88, 0.93, 0.97] as const;
  const windowTint = [0.10, 0.16, 0.24] as const;
  const bellowsDark = [0.18, 0.20, 0.24] as const;
  const wheelDark = [0.12, 0.13, 0.15] as const;
  const acPod = [0.76, 0.80, 0.85] as const;
  const headlight = [1.0, 0.95, 0.72] as const;

  // Front section (y: +0.6 to +9.0), Articulated bellows (y: -0.9 to +0.6), Rear section (y: -9.0 to -0.9)
  pushBoxMesh(verts, 0, 4.8, 0.35, 3.15, 2.5, 8.4, baysideBlue, baysideRoof);
  pushBoxMesh(verts, 0, -0.15, 0.45, 3.05, 2.32, 1.5, bellowsDark, bellowsDark);
  pushBoxMesh(verts, 0, -4.95, 0.35, 3.15, 2.5, 8.1, baysideBlue, baysideRoof);

  // Window bands on front & rear cabins
  pushBoxMesh(verts, 0, 4.9, 1.55, 2.55, 2.54, 8.1, windowTint, baysideRoof);
  pushBoxMesh(verts, 0, -4.95, 1.55, 2.55, 2.54, 7.6, windowTint, baysideRoof);

  // Roof AC pods & dark undercarriage wheels
  pushBoxMesh(verts, 0, 4.5, 3.15, 3.38, 1.4, 2.8, acPod, acPod);
  pushBoxMesh(verts, 0, -5.0, 3.15, 3.38, 1.4, 2.6, acPod, acPod);
  pushBoxMesh(verts, 0, 5.2, 0.0, 0.42, 2.3, 1.2, wheelDark, wheelDark);
  pushBoxMesh(verts, 0, -5.5, 0.0, 0.42, 2.3, 1.2, wheelDark, wheelDark);

  // Front destination LED & headlights
  pushBoxMesh(verts, 0, 9.02, 0.72, 0.96, 1.9, 0.12, headlight, headlight);

  return {
    data: new Float32Array(verts),
    vertexCount: verts.length / 9,
  };
}

export interface OverlayRenderOptions {
  viewTopLeftImgPx: { x: number; y: number };
  viewBottomRightImgPx: { x: number; y: number };
  viewportCssWidth: number;
  viewportCssHeight: number;
  sunTintRgba: readonly [number, number, number, number];
  showDepthMap: boolean;
  xrayOcclusion: boolean;
  showTileGrid: boolean;
  showGcps: boolean;
  showDeckTestPoint: boolean;
  vehicles: readonly ResolvedVehicle[];
  selectedVehicleId: string | null;
  gcps: readonly GroundControlPoint[];
  deckTestPoint: { lon: number; lat: number; elevationM: number };
  portCalls: readonly PortCallRecord[];
}

export class WebGLOverlay {
  private readonly gl: WebGL2RenderingContext;
  private readonly overlayProg: WebGLProgram;
  private readonly vehicleProg: WebGLProgram;
  private readonly markerProg: WebGLProgram;
  private readonly depthArrayTex: WebGLTexture;
  private readonly emptyVao: WebGLVertexArrayObject;
  private readonly vehicleVao: WebGLVertexArrayObject;
  private readonly vehicleVertexCount: number;
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

    // Upload 2x2 lossless depth PNG tiles into a single TEXTURE_2D_ARRAY
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

    // Vehicle VAO
    const bus = buildArticulatedBusMesh();
    this.vehicleVertexCount = bus.vertexCount;
    const vVao = gl.createVertexArray();
    const vBuf = gl.createBuffer();
    if (!vVao || !vBuf) throw new Error("Failed to create vehicle buffer");
    gl.bindVertexArray(vVao);
    gl.bindBuffer(gl.ARRAY_BUFFER, vBuf);
    gl.bufferData(gl.ARRAY_BUFFER, bus.data, gl.STATIC_DRAW);
    const stride = 9 * 4;
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 3, gl.FLOAT, false, stride, 0);
    gl.enableVertexAttribArray(1);
    gl.vertexAttribPointer(1, 3, gl.FLOAT, false, stride, 3 * 4);
    gl.enableVertexAttribArray(2);
    gl.vertexAttribPointer(2, 3, gl.FLOAT, false, stride, 6 * 4);
    this.vehicleVao = vVao;

    // Marker quad VAO
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

    // 1. Fullscreen overlay (Yokohama sun tint, depth inspector, 2x2 seam grid)
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
      gl.getUniformLocation(this.overlayProg, "u_sunTint"),
      opts.sunTintRgba[0] / 255,
      opts.sunTintRgba[1] / 255,
      opts.sunTintRgba[2] / 255,
      opts.sunTintRgba[3] / 255,
    );
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

    // 2. 3D Depth-Occluded Vehicles
    if (opts.vehicles.length > 0) {
      gl.enable(gl.DEPTH_TEST);
      gl.depthFunc(gl.LEQUAL);
      gl.useProgram(this.vehicleProg);
      this.bindCommonDepthUniforms(this.vehicleProg);

      const c = this.camera;
      gl.uniform3fv(gl.getUniformLocation(this.vehicleProg, "u_cameraOriginLocalM"), c.cameraOriginLocalM);
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

      gl.bindVertexArray(this.vehicleVao);

      for (const rv of opts.vehicles) {
        const v: VehicleRecord = rv.record;
        const localPos = wgs84ToLocal(c, v.lon, v.lat, v.roadElevationM);
        gl.uniform3f(
          gl.getUniformLocation(this.vehicleProg, "u_vehicleOriginLocalM"),
          localPos[0],
          localPos[1],
          localPos[2],
        );
        gl.uniform1f(
          gl.getUniformLocation(this.vehicleProg, "u_headingRad"),
          (v.bearingDeg * Math.PI) / 180,
        );

        let tint: [number, number, number] = [1, 1, 1];
        if (rv.displayMode === "stale") tint = [0.95, 0.78, 0.35];
        else if (rv.displayMode === "scheduled") tint = [0.65, 0.88, 1.0];
        if (opts.selectedVehicleId === v.entityId) {
          tint = [1.22, 1.22, 1.05];
        }
        gl.uniform3f(gl.getUniformLocation(this.vehicleProg, "u_tint"), tint[0], tint[1], tint[2]);
        gl.uniform1f(
          gl.getUniformLocation(this.vehicleProg, "u_isSelected"),
          opts.selectedVehicleId === v.entityId ? 1 : 0,
        );
        gl.drawArrays(gl.TRIANGLES, 0, this.vehicleVertexCount);
      }
    }

    // 3. Synchronized Point Markers (Deck verification point, GCPs, Port Call pin)
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

    for (const pc of opts.portCalls) {
      drawMarker(
        pc.lon,
        pc.lat,
        3.5,
        8.5,
        false,
        [0.18, 0.68, 0.96, 0.92],
        [1, 1, 1, 0.95],
      );
    }

    gl.bindVertexArray(null);
  }
}
