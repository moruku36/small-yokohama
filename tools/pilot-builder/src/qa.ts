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
  const gcpChecks: GcpCheckResult[] = [];
  let maxGcpDisplacementPx = 0;

  for (const gcp of gcps) {
    const imgPt = wgs84ToImage(camera, gcp.lon, gcp.lat, gcp.elevationM);
    const expX = Math.round(imgPt.px);
    const expY = Math.round(imgPt.py);

    let bestDist = Number.POSITIVE_INFINITY;
    let obsX = expX;
    let obsY = expY;
    let matched = false;

    const searchR = 16;
    for (let dy = -searchR; dy <= searchR; dy++) {
      const py = expY + dy;
      if (py < 0 || py >= stitched.height) continue;
      for (let dx = -searchR; dx <= searchR; dx++) {
        const px = expX + dx;
        if (px < 0 || px >= stitched.width) continue;
        const o = (py * stitched.width + px) * 4;
        const fid = decodeFeatureIdFromRgba(
          stitched.surfaceIdRgba[o]!,
          stitched.surfaceIdRgba[o + 1]!,
          stitched.surfaceIdRgba[o + 2]!,
        );
        if (fid === gcp.featureId) {
          const dist = Math.hypot(px + 0.5 - imgPt.px, py + 0.5 - imgPt.py);
          if (dist < bestDist) {
            bestDist = dist;
            obsX = px + 0.5;
            obsY = py + 0.5;
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

  // Open-water integrity scan: sample points across the offshore harbor basin
  // strictly outside land polygons and Kishamichi bridge bounds.
  let waterSamplePixels = 0;
  let inventedBuildingPixels = 0;

  for (let eastOffset = -350; eastOffset <= 450; eastOffset += 20) {
    for (let northOffset = -350; northOffset <= 450; northOffset += 20) {
      const inLand = scene.landPolygonsLocal.some((poly) =>
        pointInPolygon(eastOffset, northOffset, poly),
      );
      if (inLand) continue;

      // Exclude a generous buffer around land & Kishamichi so 45-deg tall building overhangs near quay walls
      // don't produce false positives; check genuine open harbor water (>= 35m offshore)
      const nearLand = scene.landPolygonsLocal.some((poly) =>
        poly.some(([vx, vy]) => Math.hypot(eastOffset - vx, northOffset - vy) < 35),
      );
      if (nearLand) continue;

      // Also check that the point is strictly offshore NE of Shinko Island (where camera looks from)
      const localPt = [eastOffset, northOffset, 0] as const;
      const wgs = wgs84ToLocal(camera, camera.originEpsg6677.easting, camera.originEpsg6677.northing, 0);
      void wgs;
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

      // Skip canal corridor where Kishamichi crosses
      if (eastOffset < -210 && northOffset < 0 && northOffset > -230) continue;

      waterSamplePixels++;
      const o = (img.py * stitched.width + img.px) * 4;
      const sk = stitched.depthRgba[o + 2]!;
      if (sk === SURFACE_KIND.BUILDING) {
        inventedBuildingPixels++;
      }
    }
  }

  const waterIntegrity = {
    waterSamplePixels,
    inventedBuildingPixels,
    passed: waterSamplePixels > 20 && inventedBuildingPixels === 0,
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
