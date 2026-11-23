import { epsg6677ToWgs84, wgs84ToEpsg6677 } from "./epsg6677.js";
import type {
  CameraBasis,
  CameraManifest,
  DataTileGridSpec,
  DziSpec,
  Epsg6677Coord,
  ImagePoint,
  Vec3,
  WorkingGridSpec,
} from "./types.js";

const DEG_TO_RAD = Math.PI / 180.0;

export function dot3(a: Vec3, b: Vec3): number {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

export function sub3(a: Vec3, b: Vec3): Vec3 {
  return [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
}

export function add3(a: Vec3, b: Vec3): Vec3 {
  return [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
}

export function scale3(a: Vec3, s: number): Vec3 {
  return [a[0] * s, a[1] * s, a[2] * s];
}

export function normalize3(v: Vec3): Vec3 {
  const len = Math.hypot(v[0], v[1], v[2]);
  if (len === 0) {
    throw new Error("Cannot normalize zero vector");
  }
  return [v[0] / len, v[1] / len, v[2] / len];
}

export function cross3(a: Vec3, b: Vec3): Vec3 {
  return [
    a[1] * b[2] - a[2] * b[1],
    a[2] * b[0] - a[0] * b[2],
    a[0] * b[1] - a[1] * b[0],
  ];
}

/**
 * Compute camera orthonormal basis from azimuth (clockwise from North)
 * and depression angle below horizontal.
 *
 * At azimuth=225 deg (looking SW from offshore NE) and depression=45 deg:
 *   forward = (-0.5, -0.5, -sqrt(1/2))
 *   right   = (-sqrt(1/2), sqrt(1/2), 0)
 *   up      = (-0.5, -0.5, sqrt(1/2))
 */
export function computeCameraBasis(azimuthDeg: number, depressionDeg: number): CameraBasis {
  const az = azimuthDeg * DEG_TO_RAD;
  const dep = depressionDeg * DEG_TO_RAD;
  const cosDep = Math.cos(dep);
  const sinDep = Math.sin(dep);

  const forward = normalize3([
    cosDep * Math.sin(az),
    cosDep * Math.cos(az),
    -sinDep,
  ]);

  const worldUp: Vec3 = [0, 0, 1];
  const right = normalize3(cross3(forward, worldUp));
  const up = normalize3(cross3(right, forward));

  return { right, up, forward };
}

export interface CreateCameraParams {
  originEpsg6677: Epsg6677Coord;
  centerLocalM?: Vec3;
  azimuthDeg?: number;
  depressionDeg?: number;
  refDistanceM?: number;
  metersPerPixel: number;
  nearM?: number;
  farM?: number;
  workingGrid: WorkingGridSpec;
  dzi?: DziSpec;
}

export function createOrthographicCamera(params: CreateCameraParams): CameraManifest {
  const azimuthDeg = params.azimuthDeg ?? 225;
  const depressionDeg = params.depressionDeg ?? 45;
  const refDistanceM = params.refDistanceM ?? 1000.0;
  const centerLocalM: Vec3 = params.centerLocalM ?? [0, 0, 0];
  const nearM = params.nearM ?? 0;
  const farM = params.farM ?? 2500;
  const dzi: DziSpec = params.dzi ?? { tileSize: 256, overlap: 1, format: "png" };

  const basis = computeCameraBasis(azimuthDeg, depressionDeg);
  const cameraOriginLocalM = sub3(centerLocalM, scale3(basis.forward, refDistanceM));

  const { cols, rows, tileSizePx, overlapPx } = params.workingGrid;
  const imageWidthPx = cols * tileSizePx - (cols - 1) * overlapPx;
  const imageHeightPx = rows * tileSizePx - (rows - 1) * overlapPx;

  if (imageWidthPx % cols !== 0 || imageHeightPx % rows !== 0) {
    throw new Error(
      `Combined image dimensions (${imageWidthPx}x${imageHeightPx}) must divide evenly across ${cols}x${rows} data tiles`,
    );
  }

  const dataTileGrid: DataTileGridSpec = {
    tileSizePx: imageWidthPx / cols,
    cols,
    rows,
  };

  return {
    schemaVersion: "1.0.0",
    epsg: "EPSG:6677",
    axisOrder: "easting-northing",
    originEpsg6677: params.originEpsg6677,
    centerLocalM,
    azimuthDeg,
    depressionDeg,
    refDistanceM,
    cameraOriginLocalM,
    basis,
    metersPerPixel: params.metersPerPixel,
    nearM,
    farM,
    imageWidthPx,
    imageHeightPx,
    imageOriginPx: {
      x: imageWidthPx * 0.5,
      y: imageHeightPx * 0.5,
    },
    workingGrid: params.workingGrid,
    dzi,
    dataTileGrid,
  };
}

export function epsg6677ToLocal(
  camera: CameraManifest,
  coord: Epsg6677Coord,
  elevationM: number,
): Vec3 {
  return [
    coord.easting - camera.originEpsg6677.easting,
    coord.northing - camera.originEpsg6677.northing,
    elevationM,
  ];
}

export function wgs84ToLocal(
  camera: CameraManifest,
  lon: number,
  lat: number,
  elevationM: number,
): Vec3 {
  const projected = wgs84ToEpsg6677(lon, lat);
  return epsg6677ToLocal(camera, projected, elevationM);
}

export function localToWgs84(
  camera: CameraManifest,
  local: Vec3,
): { lon: number; lat: number; elevationM: number } {
  const wgs = epsg6677ToWgs84(
    local[0] + camera.originEpsg6677.easting,
    local[1] + camera.originEpsg6677.northing,
  );
  return { ...wgs, elevationM: local[2] };
}

export function localToImage(camera: CameraManifest, local: Vec3): ImagePoint {
  const d = sub3(local, camera.cameraOriginLocalM);
  const cx = dot3(d, camera.basis.right);
  const cy = dot3(d, camera.basis.up);
  const depthM = dot3(d, camera.basis.forward);

  return {
    px: camera.imageOriginPx.x + cx / camera.metersPerPixel,
    py: camera.imageOriginPx.y - cy / camera.metersPerPixel,
    depthM,
  };
}

export function wgs84ToImage(
  camera: CameraManifest,
  lon: number,
  lat: number,
  elevationM: number,
): ImagePoint {
  return localToImage(camera, wgs84ToLocal(camera, lon, lat, elevationM));
}

/**
 * Inverse orthographic projection from full-image pixel `(px, py)` onto a
 * horizontal plane `z = elevationM` in local metric coordinates.
 */
export function imageToLocalOnPlane(
  camera: CameraManifest,
  px: number,
  py: number,
  elevationM: number,
): Vec3 {
  const cx = (px - camera.imageOriginPx.x) * camera.metersPerPixel;
  const cy = (camera.imageOriginPx.y - py) * camera.metersPerPixel;

  const basePoint = add3(
    camera.cameraOriginLocalM,
    add3(scale3(camera.basis.right, cx), scale3(camera.basis.up, cy)),
  );

  const fz = camera.basis.forward[2];
  if (Math.abs(fz) < 1e-8) {
    throw new Error("Camera forward vector is parallel to horizontal plane");
  }
  const t = (elevationM - basePoint[2]) / fz;
  return add3(basePoint, scale3(camera.basis.forward, t));
}

export function imagePxToNdc(
  px: number,
  py: number,
  viewTopLeftImgPx: { x: number; y: number },
  viewBottomRightImgPx: { x: number; y: number },
): { x: number; y: number } {
  const spanX = viewBottomRightImgPx.x - viewTopLeftImgPx.x;
  const spanY = viewBottomRightImgPx.y - viewTopLeftImgPx.y;
  const u = (px - viewTopLeftImgPx.x) / spanX;
  const v = (py - viewTopLeftImgPx.y) / spanY;
  return {
    x: u * 2.0 - 1.0,
    y: 1.0 - v * 2.0,
  };
}
