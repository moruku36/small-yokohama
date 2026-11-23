import type { SurfaceKind } from "./types.js";

export const SURFACE_KIND = {
  VOID: 0,
  WATER: 1,
  GROUND: 2,
  ROAD: 3,
  BUILDING: 4,
  BRIDGE_DECK: 5,
  BRIDGE_SUPPORT: 6,
  QUAY: 7,
  VEGETATION: 8,
} as const satisfies Record<string, SurfaceKind>;

export function encodeDepthRgba(
  depthM: number,
  nearM: number,
  farM: number,
  surfaceKind: SurfaceKind,
): [number, number, number, number] {
  const span = farM - nearM;
  const normalized = span <= 0 ? 0 : Math.min(1, Math.max(0, (depthM - nearM) / span));
  const q16 = Math.round(normalized * 65535);
  const r = (q16 >> 8) & 0xff;
  const g = q16 & 0xff;
  return [r, g, surfaceKind & 0xff, 255];
}

export function decodeDepthFromRgba(
  r: number,
  g: number,
  nearM: number,
  farM: number,
): number {
  const q16 = ((r & 0xff) << 8) | (g & 0xff);
  return nearM + (q16 / 65535) * (farM - nearM);
}

export function encodeElevationRgba(
  elevationM: number,
  minM: number,
  maxM: number,
  valid: boolean,
): [number, number, number, number] {
  if (!valid) {
    return [0, 0, 0, 255];
  }
  const span = maxM - minM;
  const normalized = span <= 0 ? 0 : Math.min(1, Math.max(0, (elevationM - minM) / span));
  const q16 = Math.round(normalized * 65535);
  return [(q16 >> 8) & 0xff, q16 & 0xff, 1, 255];
}

export function decodeElevationFromRgba(
  r: number,
  g: number,
  b: number,
  minM: number,
  maxM: number,
): number | null {
  if (b === 0) {
    return null;
  }
  const q16 = ((r & 0xff) << 8) | (g & 0xff);
  return minM + (q16 / 65535) * (maxM - minM);
}

export function encodeFeatureIdRgba(featureId: number): [number, number, number, number] {
  const id = Math.max(0, Math.min(0xffffff, Math.floor(featureId)));
  return [(id >> 16) & 0xff, (id >> 8) & 0xff, id & 0xff, 255];
}

export function decodeFeatureIdFromRgba(r: number, g: number, b: number): number {
  return ((r & 0xff) << 16) | ((g & 0xff) << 8) | (b & 0xff);
}
