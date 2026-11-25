import type { CameraManifest } from "@small-yokohama/core";

export const RED_BRICK_CENTER_IMG = { x: 5760, y: 4020 } as const;

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
  const mapAspect = camera.imageWidthPx / camera.imageHeightPx;
  const vpAspect = Math.max(0.25, viewportW / Math.max(1, viewportH));
  return Math.max(1.0, (mapAspect / vpAspect) * 0.96);
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
    viewportW <= 700 ? 285 : Math.min(520, Math.max(360, viewportW * 0.36));
  const visibleImgW = targetMeters / camera.metersPerPixel;
  const desiredZoom = camera.imageWidthPx / visibleImgW;
  return Math.min(
    48,
    Math.max(computeFullMapMinZoom(camera, viewportW, viewportH) * 1.18, desiredZoom),
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
    viewportW <= 700 ? 240 : Math.min(420, Math.max(320, viewportW * 0.3));
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
