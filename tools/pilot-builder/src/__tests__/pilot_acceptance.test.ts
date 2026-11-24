import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  decodeDepthFromRgba,
  decodeElevationFromRgba,
  interpolateTrackSample,
  wgs84ToImage,
  type CameraManifest,
  type QaReport,
  type VehicleSnapshot,
} from "@small-yokohama/core";
import { decodePngRgba } from "../png.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const RELEASE_DIR = resolve(__dirname, "..", "..", "..", "..", "viewer", "public", "releases", "pilot-shinko-v1");

function sampleTilePng(
  tiles: Array<{ col: number; row: number; width: number; height: number; data: Uint8Array }>,
  camera: CameraManifest,
  px: number,
  py: number,
): [number, number, number, number] {
  const gx = Math.min(camera.imageWidthPx - 1, Math.max(0, Math.floor(px)));
  const gy = Math.min(camera.imageHeightPx - 1, Math.max(0, Math.floor(py)));
  const ts = camera.dataTileGrid.tileSizePx;
  const col = Math.min(camera.dataTileGrid.cols - 1, Math.floor(gx / ts));
  const row = Math.min(camera.dataTileGrid.rows - 1, Math.floor(gy / ts));
  const tile = tiles.find((t) => t.col === col && t.row === row)!;
  const lx = gx - col * ts;
  const ly = gy - row * ts;
  const o = (ly * tile.width + lx) * 4;
  return [tile.data[o]!, tile.data[o + 1]!, tile.data[o + 2]!, tile.data[o + 3]!];
}

describe("Shinko pilot Step 1 & Step 2 acceptance against real generated PNG tiles", () => {
  const camera = JSON.parse(readFileSync(join(RELEASE_DIR, "camera.json"), "utf8")) as CameraManifest;
  const qa = JSON.parse(readFileSync(join(RELEASE_DIR, "qa-report.json"), "utf8")) as QaReport;
  const synthetic = JSON.parse(
    readFileSync(join(RELEASE_DIR, "fixtures", "synthetic-bayside-blue.json"), "utf8"),
  ) as VehicleSnapshot;

  const depthTiles = [0, 1].flatMap((row) =>
    [0, 1].map((col) => {
      const decoded = decodePngRgba(
        readFileSync(join(RELEASE_DIR, "depth", `tile_${col}_${row}.png`)),
      );
      return { col, row, ...decoded };
    }),
  );

  const roadElevTiles = [0, 1].flatMap((row) =>
    [0, 1].map((col) => {
      const decoded = decodePngRgba(
        readFileSync(join(RELEASE_DIR, "road-elevation", `ground-road_tile_${col}_${row}.png`)),
      );
      return { col, row, ...decoded };
    }),
  );

  it("passes Step 1: >=6 GCPs within 8 px, clean seams, and zero invented buildings in water", () => {
    expect(qa.passed).toBe(true);
    expect(qa.gcpChecks.length).toBeGreaterThanOrEqual(6);
    expect(qa.maxGcpDisplacementPx).toBeLessThanOrEqual(8);
    expect(qa.waterIntegrity.inventedBuildingPixels).toBe(0);
    expect(qa.waterIntegrity.voidPixels).toBe(0);
    expect(qa.seamChecks.every((s) => s.passed)).toBe(true);

    // Confirm Red Brick Warehouse No. 2 genuinely spans across the vertical working-tile boundary (1920..2048)
    const nwGcp = qa.gcpChecks.find((c) => c.id === "gcp-rb2-nw")!;
    const seGcp = qa.gcpChecks.find((c) => c.id === "gcp-rb2-se")!;
    expect(nwGcp.expectedPx).toBeGreaterThan(2048);
    expect(seGcp.expectedPx).toBeLessThan(1920);
  });

  it("passes Step 2: synthetic bus transitions visible -> occluded -> visible under Circle Walk & behind Red Brick #2", () => {
    const keyframes = synthetic.keyframes!["syn-bayside-blue-01"]!;
    const checkOccludedAtTime = (timeSec: number): boolean => {
      const sample = interpolateTrackSample(keyframes, timeSec);
      // Sample the bus center-roof point (+3.2m above road surface)
      const img = wgs84ToImage(camera, sample.lon, sample.lat, sample.roadElevationM + 3.2);
      const rgba = sampleTilePng(depthTiles, camera, img.px, img.py);
      const sceneDepthM = decodeDepthFromRgba(rgba[0], rgba[1], camera.nearM, camera.farM);
      return img.depthM > sceneDepthM + 0.14;
    };

    // t=0: Approaching Circle Walk -> visible
    expect(checkOccludedAtTime(0)).toBe(false);
    // t=6: Directly beneath Circle Walk NW ring deck -> occluded
    expect(checkOccludedAtTime(6)).toBe(true);
    // t=10: Inside Circle Walk open central courtyard -> visible
    expect(checkOccludedAtTime(10)).toBe(false);
    // t=14: Directly beneath Circle Walk SE ring deck -> occluded
    expect(checkOccludedAtTime(14)).toBe(true);
    // t=20: Exited Circle Walk -> visible
    expect(checkOccludedAtTime(20)).toBe(false);
    // t=46: Behind Red Brick Warehouse No. 2 corner -> occluded
    expect(checkOccludedAtTime(46)).toBe(true);
    // t=56: Emerged past Red Brick Warehouse -> visible
    expect(checkOccludedAtTime(56)).toBe(false);
  });

  it("keeps ground-road elevation separated from overhead pedestrian bridge and preserves visibility for a point ON the deck", () => {
    const landmarksFile = JSON.parse(readFileSync(join(RELEASE_DIR, "landmarks.json"), "utf8")) as {
      deckTestPoint: { lon: number; lat: number; elevationM: number; deckId: string };
    };
    const deckPt = landmarksFile.deckTestPoint;
    const deckImg = wgs84ToImage(camera, deckPt.lon, deckPt.lat, deckPt.elevationM + 0.15);
    const depthRgba = sampleTilePng(depthTiles, camera, deckImg.px, deckImg.py);
    const sceneDepthM = decodeDepthFromRgba(depthRgba[0], depthRgba[1], camera.nearM, camera.farM);
    // Point on top of Circle Walk (+6.9m) must NOT be occluded by the deck itself
    expect(deckImg.depthM <= sceneDepthM + 0.35).toBe(true);

    // Meanwhile, ground-road elevation tile under Circle Walk center (t=10s) reports ~2.0..2.2m, never 6.9m!
    const cwRoadKf = synthetic.keyframes!["syn-bayside-blue-01"]![2]!;
    const roadImg = wgs84ToImage(camera, cwRoadKf.lon, cwRoadKf.lat, cwRoadKf.roadElevationM);
    const roadRgba = sampleTilePng(roadElevTiles, camera, roadImg.px, roadImg.py);
    const groundElev = decodeElevationFromRgba(roadRgba[0], roadRgba[1], roadRgba[2], 0, 100);
    expect(groundElev).not.toBeNull();
    expect(groundElev!).toBeLessThan(2.5);
  });
});
