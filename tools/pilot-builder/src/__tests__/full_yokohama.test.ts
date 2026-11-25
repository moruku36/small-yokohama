import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  createFullYokohamaCamera,
  createShinkoPilotCamera,
  wgs84ToImage,
  type CameraManifest,
  type Landmark,
  type QaReport,
  type ReleaseManifest,
  type ReleasePointer,
} from "@small-yokohama/core";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, "..", "..", "..", "..");
const RELEASE_DIR = join(REPO_ROOT, "viewer", "public", "releases", "full-yokohama-v1");
const CURRENT_PTR = join(REPO_ROOT, "viewer", "public", "releases", "current.json");
const DOCS_IMAGES_DIR = join(REPO_ROOT, "docs", "images");

describe("Full Yokohama 23-tile release acceptance", () => {
  it("writes complete full-yokohama-v1 release, DZI pyramids, and half-res data tiles", () => {
    expect(existsSync(join(RELEASE_DIR, "release.json"))).toBe(true);
    expect(existsSync(join(RELEASE_DIR, "camera.json"))).toBe(true);
    expect(existsSync(join(RELEASE_DIR, "qa-report.json"))).toBe(true);
    expect(existsSync(join(RELEASE_DIR, "illustrated.dzi"))).toBe(true);
    expect(existsSync(join(RELEASE_DIR, "plain.dzi"))).toBe(true);
    expect(existsSync(join(RELEASE_DIR, "illustrated_files"))).toBe(true);
    expect(existsSync(join(RELEASE_DIR, "plain_files"))).toBe(true);
    expect(existsSync(CURRENT_PTR)).toBe(true);

    const ptr = JSON.parse(readFileSync(CURRENT_PTR, "utf8")) as ReleasePointer;
    expect(ptr.releaseId).toBe("full-yokohama-v1");

    const release = JSON.parse(
      readFileSync(join(RELEASE_DIR, "release.json"), "utf8"),
    ) as ReleaseManifest;
    expect(release.releaseId).toBe("full-yokohama-v1");

    const cam = JSON.parse(readFileSync(join(RELEASE_DIR, "camera.json"), "utf8")) as CameraManifest;
    const expectedCam = createFullYokohamaCamera();
    expect(cam.imageWidthPx).toBe(15488);
    expect(cam.imageHeightPx).toBe(5888);
    expect(cam.imageOriginPx).toEqual(expectedCam.imageOriginPx);
    expect(cam.workingGrid.cols).toBe(8);
    expect(cam.workingGrid.rows).toBe(3);
    expect(cam.workingGrid.colOffset).toBe(-2);
    expect(cam.workingGrid.rowOffset).toBe(-1);
    expect(cam.dataTileGrid.scale).toBe(0.5);

    for (let row = 0; row < cam.dataTileGrid.rows; row++) {
      for (let col = 0; col < cam.dataTileGrid.cols; col++) {
        expect(existsSync(join(RELEASE_DIR, "depth", `tile_${col}_${row}.png`))).toBe(true);
        expect(existsSync(join(RELEASE_DIR, "surface-id", `tile_${col}_${row}.png`))).toBe(true);
        expect(
          existsSync(join(RELEASE_DIR, "road-elevation", `ground-road_tile_${col}_${row}.png`)),
        ).toBe(true);
      }
    }
  });

  it("passes all 23 DP seam checks, GCP accuracy (<= 8 px), and zero-void water integrity", () => {
    const qa = JSON.parse(readFileSync(join(RELEASE_DIR, "qa-report.json"), "utf8")) as QaReport;
    expect(qa.passed).toBe(true);
    expect(qa.metrics.tileCount).toBe(23);
    expect(qa.seamChecks).toHaveLength(23);
    for (const s of qa.seamChecks) {
      expect(s.passed).toBe(true);
      expect(s.meanColorDiff).toBeLessThanOrEqual(48.0);
    }
    expect(qa.gcpChecks.length).toBeGreaterThanOrEqual(8);
    expect(qa.maxGcpDisplacementPx).toBeLessThanOrEqual(8.0);
    expect(qa.waterIntegrity.voidPixels).toBe(0);
    expect(qa.waterIntegrity.inventedBuildingPixels).toBe(0);
    expect(qa.waterIntegrity.passed).toBe(true);
  });

  it("projects all curated Yokohama landmarks inside 15488x5888 and writes docs preview images", () => {
    const pilotCam = createShinkoPilotCamera();
    const fullCam = createFullYokohamaCamera();
    const pilotRedBrick = wgs84ToImage(pilotCam, 139.6429, 35.4526, 18);
    const fullRedBrick = wgs84ToImage(fullCam, 139.6429, 35.4526, 18);
    expect(fullRedBrick.px - pilotRedBrick.px).toBeCloseTo(3840, 8);
    expect(fullRedBrick.py - pilotRedBrick.py).toBeCloseTo(1920, 8);

    const payload = JSON.parse(readFileSync(join(RELEASE_DIR, "landmarks.json"), "utf8")) as {
      landmarks: Landmark[];
    };
    expect(payload.landmarks.length).toBeGreaterThanOrEqual(15);
    const ids = new Set(payload.landmarks.map((l) => l.id));
    expect(ids.has("lm-yokohama-station")).toBe(true);
    expect(ids.has("lm-landmark-tower")).toBe(true);
    expect(ids.has("lm-yamashita-park")).toBe(true);
    expect(ids.has("lm-chinatown")).toBe(true);
    expect(ids.has("lm-noge")).toBe(true);

    for (const lm of payload.landmarks) {
      const pt = wgs84ToImage(fullCam, lm.lon, lm.lat, lm.elevationM);
      expect(pt.px).toBeGreaterThanOrEqual(0);
      expect(pt.px).toBeLessThan(fullCam.imageWidthPx);
      expect(pt.py).toBeGreaterThanOrEqual(0);
      expect(pt.py).toBeLessThan(fullCam.imageHeightPx);
    }

    for (const imgName of [
      "full-yokohama-23tiles-preview.png",
      "full-seam-yokohama-station.png",
      "full-seam-minatomirai.png",
      "full-seam-yamashita-chinatown.png",
      "full-seam-kannai-noge.png",
    ]) {
      expect(existsSync(join(DOCS_IMAGES_DIR, imgName))).toBe(true);
    }
  });
});
