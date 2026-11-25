import {
  SURFACE_KIND,
  decodeFeatureIdFromRgba,
  wgs84ToImage,
  wgs84ToLocal,
  type CameraManifest,
  type GcpCheckResult,
  type QaReport,
  type SeamCheckResult,
  type ShinkoSceneBundle,
} from "@small-yokohama/core";
import type { StitchedPilotBuffers } from "./seam.js";

function pointInPolygon(x: number, y: number, poly: ReadonlyArray<readonly [number, number]>): boolean {
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

/**
 * Automated Step 1 acceptance verification:
 * - >= 6 independent GCPs checked on rendered featureId/depth buffers (<= 8 px displacement)
 * - Overlap seam color disagreement checks
 * - Open-water integrity check (0 invented building pixels in harbor water)
 */
export function runPilotQa(
  releaseId: string,
  scene: ShinkoSceneBundle,
  stitched: StitchedPilotBuffers,
  seamChecks: SeamCheckResult[],
  metrics: QaReport["metrics"],
  gcpThresholdPx = 8.0,
): QaReport {
  const { camera, gcps } = scene;
  const dataW = stitched.dataWidth ?? stitched.width;
  const dataH = stitched.dataHeight ?? stitched.height;
  const dataScale = stitched.dataScale ?? 1;
  const gcpChecks: GcpCheckResult[] = [];
  let maxGcpDisplacementPx = 0;

  for (const gcp of gcps) {
    const imgPt = wgs84ToImage(camera, gcp.lon, gcp.lat, gcp.elevationM);
    const expDataX = Math.round(imgPt.px * dataScale);
    const expDataY = Math.round(imgPt.py * dataScale);

    let bestDist = Number.POSITIVE_INFINITY;
    let obsX = imgPt.px;
    let obsY = imgPt.py;
    let matched = false;

    const searchR = Math.ceil(16 * dataScale);
    for (let dy = -searchR; dy <= searchR; dy++) {
      const py = expDataY + dy;
      if (py < 0 || py >= dataH) continue;
      for (let dx = -searchR; dx <= searchR; dx++) {
        const px = expDataX + dx;
        if (px < 0 || px >= dataW) continue;
        const o = (py * dataW + px) * 4;
        const fid = decodeFeatureIdFromRgba(
          stitched.surfaceIdRgba[o]!,
          stitched.surfaceIdRgba[o + 1]!,
          stitched.surfaceIdRgba[o + 2]!,
        );
        if (fid === gcp.featureId) {
          const fullPxX = (px + 0.5) / dataScale;
          const fullPxY = (py + 0.5) / dataScale;
          const dist = Math.hypot(fullPxX - imgPt.px, fullPxY - imgPt.py);
          if (dist < bestDist) {
            bestDist = dist;
            obsX = fullPxX;
            obsY = fullPxY;
            matched = true;
          }
        }
      }
    }

    const displacementPx = matched ? Number(bestDist.toFixed(3)) : 999;
    if (displacementPx > maxGcpDisplacementPx) {
      maxGcpDisplacementPx = displacementPx;
    }
    gcpChecks.push({
      id: gcp.id,
      labelJa: gcp.labelJa,
      labelEn: gcp.labelEn,
      expectedPx: Number(imgPt.px.toFixed(2)),
      expectedPy: Number(imgPt.py.toFixed(2)),
      observedPx: Number(obsX.toFixed(2)),
      observedPy: Number(obsY.toFixed(2)),
      displacementPx,
      featureId: gcp.featureId,
      matched,
      passed: matched && displacementPx <= gcpThresholdPx,
    });
  }

  // Open-water integrity scan across the offshore harbor basin
  // strictly outside land polygons and piers (>= 32 m offshore).
  let waterSamplePixels = 0;
  let inventedBuildingPixels = 0;

  for (let eastOffset = -450; eastOffset <= 680; eastOffset += 25) {
    for (let northOffset = -450; northOffset <= 680; northOffset += 25) {
      const inLand = scene.landPolygonsLocal.some((poly) =>
        pointInPolygon(eastOffset, northOffset, poly),
      );
      if (inLand) continue;

      const nearLand = scene.landPolygonsLocal.some((poly) =>
        poly.some(([vx, vy]) => Math.hypot(eastOffset - vx, northOffset - vy) < 35),
      );
      if (nearLand) continue;

      const localPt = [eastOffset, northOffset, 0] as const;
      const img = (() => {
        const d = [
          localPt[0] - camera.cameraOriginLocalM[0],
          localPt[1] - camera.cameraOriginLocalM[1],
          localPt[2] - camera.cameraOriginLocalM[2],
        ];
        const cx =
          d[0]! * camera.basis.right[0] +
          d[1]! * camera.basis.right[1] +
          d[2]! * camera.basis.right[2];
        const cy =
          d[0]! * camera.basis.up[0] +
          d[1]! * camera.basis.up[1] +
          d[2]! * camera.basis.up[2];
        return {
          px: Math.round(camera.imageOriginPx.x + cx / camera.metersPerPixel),
          py: Math.round(camera.imageOriginPx.y - cy / camera.metersPerPixel),
        };
      })();

      if (img.px < 0 || img.px >= stitched.width || img.py < 0 || img.py >= stitched.height) {
        continue;
      }

      const dpx = Math.min(dataW - 1, Math.max(0, Math.floor(img.px * dataScale)));
      const dpy = Math.min(dataH - 1, Math.max(0, Math.floor(img.py * dataScale)));
      waterSamplePixels++;
      const o = (dpy * dataW + dpx) * 4;
      const sk = stitched.depthRgba[o + 2]!;
      if (sk === SURFACE_KIND.BUILDING) {
        inventedBuildingPixels++;
      }
    }
  }

  // Scan entire stitched depth buffer to verify zero unpainted VOID pixels
  let voidPixels = 0;
  const totalPixels = dataW * dataH;
  for (let i = 0; i < totalPixels; i++) {
    if (stitched.depthRgba[i * 4 + 2] === SURFACE_KIND.VOID) {
      voidPixels++;
    }
  }

  const waterIntegrity = {
    waterSamplePixels,
    inventedBuildingPixels,
    voidPixels,
    passed: waterSamplePixels > 20 && inventedBuildingPixels === 0 && voidPixels === 0,
  };

  const passed =
    gcpChecks.length >= 6 &&
    gcpChecks.every((c) => c.passed) &&
    seamChecks.every((s) => s.passed) &&
    waterIntegrity.passed;

  return {
    schemaVersion: "1.0.0",
    releaseId,
    generatedAt: new Date().toISOString(),
    gcpThresholdPx,
    maxGcpDisplacementPx,
    gcpChecks,
    seamChecks,
    waterIntegrity,
    metrics,
    passed,
  };
}
