import {
  imageToLocalOnPlane,
  localToImage,
  localToWgs84,
  wgs84ToLocal,
  type CameraManifest,
} from "@small-yokohama/core";

/**
 * Geographic view links in the Small SF style: `?at=lat,lon,<metres across>m`.
 *
 * The drawing is an orthographic projection, so the horizontal image axis is a
 * true ground distance: at OpenSeadragon zoom `z` the screen shows
 * `imageWidthPx / z` image pixels across, i.e. `imageWidthPx * metersPerPixel / z`
 * metres. Centres are measured on the ground plane (z = 0 m).
 */

export interface GeoView {
  lat: number;
  lon: number;
  metersAcross: number;
}

export const MIN_METERS_ACROSS = 20;
export const MAX_METERS_ACROSS = 20_000;

export function zoomToMetersAcross(camera: CameraManifest, zoom: number): number {
  return (camera.imageWidthPx * camera.metersPerPixel) / Math.max(1e-6, zoom);
}

export function metersAcrossToZoom(camera: CameraManifest, metersAcross: number): number {
  return (camera.imageWidthPx * camera.metersPerPixel) / Math.max(1e-6, metersAcross);
}

export function imagePxToLonLat(
  camera: CameraManifest,
  imgX: number,
  imgY: number,
): { lon: number; lat: number } {
  const local = imageToLocalOnPlane(camera, imgX, imgY, 0);
  const wgs = localToWgs84(camera, local);
  return { lon: wgs.lon, lat: wgs.lat };
}

export function lonLatToImagePx(
  camera: CameraManifest,
  lon: number,
  lat: number,
): { x: number; y: number } {
  const img = localToImage(camera, wgs84ToLocal(camera, lon, lat, 0));
  return { x: img.px, y: img.py };
}

const AT_RE = /^\s*(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)\s*(?:,\s*(\d+(?:\.\d+)?)\s*m?)?\s*$/i;

/** Parses `lat,lon[,metres[m]]`. Returns null for malformed input or places far from Yokohama. */
export function parseAtParam(raw: string | null | undefined): GeoView | null {
  if (!raw) return null;
  const m = AT_RE.exec(raw);
  if (!m) return null;
  const lat = Number(m[1]);
  const lon = Number(m[2]);
  // Yokohama only: a link to somewhere else would open on empty paper
  if (Math.abs(lat - 35.455) > 0.3 || Math.abs(lon - 139.635) > 0.3) return null;
  const metersAcross = m[3] === undefined ? 650 : Number(m[3]);
  return {
    lat,
    lon,
    metersAcross: Math.min(MAX_METERS_ACROSS, Math.max(MIN_METERS_ACROSS, metersAcross)),
  };
}

export function formatAtParam(view: GeoView): string {
  return `${view.lat.toFixed(5)},${view.lon.toFixed(5)},${Math.round(view.metersAcross)}m`;
}

export function cameraViewToGeoView(
  camera: CameraManifest,
  view: { centerImgX: number; centerImgY: number; zoom: number },
): GeoView {
  const { lon, lat } = imagePxToLonLat(camera, view.centerImgX, view.centerImgY);
  return { lat, lon, metersAcross: zoomToMetersAcross(camera, view.zoom) };
}

export function geoViewToCameraView(
  camera: CameraManifest,
  view: GeoView,
): { centerImgX: number; centerImgY: number; zoom: number } {
  const { x, y } = lonLatToImagePx(camera, view.lon, view.lat);
  return {
    centerImgX: Math.min(camera.imageWidthPx, Math.max(0, x)),
    centerImgY: Math.min(camera.imageHeightPx, Math.max(0, y)),
    zoom: metersAcrossToZoom(camera, view.metersAcross),
  };
}
