import type { CameraManifest } from "@small-yokohama/core";

export const RED_BRICK_CENTER_IMG = { x: 5760, y: 4020 } as const;

/**
 * Widest zoom is framed on the waterfront, not the geometric centre of the
 * sheet. Red Brick sits low in the drawing, so a height-fit zoom still leaves
 * a cloud field under the harbour.
 */
const FOCUS_CENTER_IMG = RED_BRICK_CENTER_IMG;

/** At most this fraction of the viewport may fall outside the drawing. */
const MAX_CLOUD_MARGIN = 0.1;

export function isFullYokohamaCamera(camera: CameraManifest): boolean {
  return camera.imageWidthPx > 5000;
}

export function computeFullMapMinZoom(
  camera: CameraManifest,
  viewportW: number,
  viewportH: number,
): number {
  if (!isFullYokohamaCamera(camera)) {
    return 0.55;
  }
  const vw = Math.max(1, viewportW);
  const vh = Math.max(1, viewportH);
  const halfLimit = 0.5 - MAX_CLOUD_MARGIN;
  const maxVisibleW =
    Math.min(FOCUS_CENTER_IMG.x, camera.imageWidthPx - FOCUS_CENTER_IMG.x) / halfLimit;
  const maxVisibleH =
    Math.min(FOCUS_CENTER_IMG.y, camera.imageHeightPx - FOCUS_CENTER_IMG.y) / halfLimit;
  // OpenSeadragon zoom is image width divided by the visible image width.
  const zoomForWidth = camera.imageWidthPx / maxVisibleW;
  const zoomForHeight = camera.imageWidthPx / (maxVisibleH * (vw / vh));
  // Also cover the viewport, so panning off the focus point cannot open a sea of cloud.
  const fitHeightZoom = (camera.imageWidthPx / camera.imageHeightPx) * (vh / vw);
  return Math.max(zoomForWidth, zoomForHeight, 1, fitHeightZoom);
}

export function computeDefaultFullMapZoom(
  camera: CameraManifest,
  viewportW: number,
  viewportH: number,
): number {
  if (!isFullYokohamaCamera(camera)) {
    return 2.25;
  }
  const targetMeters =
    viewportW <= 700
      ? 540
      : Math.min(740, Math.max(620, viewportW * 0.5));
  const visibleImgW = targetMeters / camera.metersPerPixel;
  const desiredZoom = camera.imageWidthPx / visibleImgW;
  return Math.min(
    48,
    Math.max(computeFullMapMinZoom(camera, viewportW, viewportH) * 1.15, desiredZoom),
  );
}

export function computeLandmarkZoom(
  camera: CameraManifest,
  viewportW: number,
  viewportH: number,
): number {
  if (!isFullYokohamaCamera(camera)) {
    return 2.8;
  }
  const targetMeters =
    viewportW <= 700
      ? 400
      : Math.min(540, Math.max(440, viewportW * 0.38));
  const desiredZoom = camera.imageWidthPx / (targetMeters / camera.metersPerPixel);
  return Math.min(
    48,
    Math.max(computeFullMapMinZoom(camera, viewportW, viewportH) * 1.25, desiredZoom),
  );
}

export function computePinchZoom(
  currentZoom: number,
  prevDistPx: number,
  currDistPx: number,
  minZoom: number,
  maxZoom: number,
): number {
  if (prevDistPx <= 4 || currDistPx <= 4) {
    return currentZoom;
  }
  const ratio = Math.min(2.0, Math.max(0.5, currDistPx / prevDistPx));
  return Math.min(maxZoom, Math.max(minZoom, currentZoom * ratio));
}

export function computeFullMapMaxZoom(
  camera: CameraManifest,
  viewportW: number,
  viewportH: number,
): number {
  if (!isFullYokohamaCamera(camera)) {
    return 16;
  }
  const isMobile = viewportW <= 700;
  const maxPixelRatio = isMobile ? 4.2 : 5.2;
  const minVisibleMeters = isMobile ? 62 : 76;
  const byPixelRatio = (camera.imageWidthPx * maxPixelRatio) / Math.max(1, viewportW);
  const byMeters = camera.imageWidthPx / (minVisibleMeters / camera.metersPerPixel);
  const home = computeDefaultFullMapZoom(camera, viewportW, viewportH);
  return Math.max(home * 1.45, Math.min(byPixelRatio, byMeters));
}

export function computeWheelZoomFactor(
  deltaY: number,
  deltaMode: number,
  ctrlKey: boolean,
): number {
  const unit = deltaMode === 1 ? 16 : deltaMode === 2 ? 400 : 1;
  if (ctrlKey) {
    return Math.exp(-deltaY * unit * 0.011);
  }
  return Math.exp(-deltaY * unit * 0.0035);
}
