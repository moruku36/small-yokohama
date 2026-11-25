import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  SURFACE_KIND,
  buildShinkoPilotScene,
  createShinkoPilotCamera,
  encodeDepthRgba,
  encodeElevationRgba,
  imageToLocalOnPlane,
  localToImage,
  localToWgs84,
  type CameraManifest,
} from "@small-yokohama/core";
import { applyDrawnTileOverride, exportBaseTilePng } from "./drawnTiles.js";
import { fetchAndStitchGsiAerial, type GsiAerialBbox } from "./fetchGsiAerial.js";
import { buildShinkoOsmScene } from "./osmSceneBuilder.js";
import {
  buildShadowMap,
  loadGsiAerialMosaic,
  lonLatToAerialPx,
  renderWorkingTile,
  sampleAerialRgb,
  type GsiAerialMosaic,
  type RenderedTileBuffers,
} from "./rasterizer.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, "..", "..", "..");
const OSM_DATA_PATH = join(REPO_ROOT, "data", "shinko-osm.json");
const TILE_RENDERS_DIR = join(REPO_ROOT, "data", "tile-renders");
const DRAWN_TILES_DIR = join(REPO_ROOT, "data", "drawn-tiles");
const GSI_AERIAL_DIR = join(REPO_ROOT, "data", "gsi-aerial");

const TEAM_BLOCKS: Record<string, ReadonlyArray<readonly [number, number]>> = {
  pilot: [
    [0, 0],
    [1, 0],
    [0, 1],
    [1, 1],
  ],
  "phase-a-1": [
    [-2, 0],
    [-1, 0],
    [-2, 1],
    [-1, 1],
  ],
  "phase-a-2": [
    [2, 0],
    [2, 1],
    [3, 0],
    [3, 1],
  ],
  "phase-a-3": [
    [4, 0],
    [4, 1],
    [5, 0],
    [5, 1],
  ],
  "phase-b-1": [
    [-2, -1],
    [-1, -1],
    [0, -1],
    [1, -1],
  ],
  "phase-b-2": [
    [2, -1],
    [3, -1],
    [4, -1],
  ],
};

export function computeTileAerialBbox(camera: CameraManifest, col: number, row: number): GsiAerialBbox {
  const { tileSizePx, overlapPx } = camera.workingGrid;
  const stridePx = tileSizePx - overlapPx;
  const originX = col * stridePx;
  const originY = row * stridePx;
  const corners: ReadonlyArray<readonly [number, number]> = [
    [originX, originY],
    [originX + tileSizePx, originY],
    [originX, originY + tileSizePx],
    [originX + tileSizePx, originY + tileSizePx],
  ];

  let minLon = Infinity;
  let maxLon = -Infinity;
  let minLat = Infinity;
  let maxLat = -Infinity;
  for (const [px, py] of corners) {
    const loc = imageToLocalOnPlane(camera, px, py, 2.0);
    const wgs = localToWgs84(camera, loc);
    minLon = Math.min(minLon, wgs.lon);
    maxLon = Math.max(maxLon, wgs.lon);
    minLat = Math.min(minLat, wgs.lat);
    maxLat = Math.max(maxLat, wgs.lat);
  }

  const marginDeg = 0.0012;
  return {
    minLon: minLon - marginDeg,
    minLat: minLat - marginDeg,
    maxLon: maxLon + marginDeg,
    maxLat: maxLat + marginDeg,
  };
}

function clampByte(v: number): number {
  return v < 0 ? 0 : v > 255 ? 255 : Math.round(v);
}

/**
 * Render an orthographic 2048x2048 aerial base tile outside the 2x2 Shinko 3D core
 * using the exact pilot camera affine projection and sunlit Ligne-Claire palette tone lift.
 */
export function renderAerialOnlyTile(
  camera: CameraManifest,
  col: number,
  row: number,
  aerial: GsiAerialMosaic,
): RenderedTileBuffers {
  const { tileSizePx, overlapPx } = camera.workingGrid;
  const stridePx = tileSizePx - overlapPx;
  const originPxX = col * stridePx;
  const originPxY = row * stridePx;
  const width = tileSizePx;
  const height = tileSizePx;
  const nPixels = width * height;

  const loc00 = imageToLocalOnPlane(camera, originPxX, originPxY, 2.0);
  const locX0 = imageToLocalOnPlane(camera, originPxX + width, originPxY, 2.0);
  const loc0Y = imageToLocalOnPlane(camera, originPxX, originPxY + height, 2.0);
  const p00 = localToWgs84(camera, loc00);
  const pX0 = localToWgs84(camera, locX0);
  const p0Y = localToWgs84(camera, loc0Y);
  const d00 = localToImage(camera, loc00).depthM;
  const dX0 = localToImage(camera, locX0).depthM;
  const d0Y = localToImage(camera, loc0Y).depthM;
  const dDepthDpx = (dX0 - d00) / width;
  const dDepthDpy = (d0Y - d00) / height;
  const groundElevEnc = encodeElevationRgba(2.0, 0, 100, true);
  const [u0, v0] = lonLatToAerialPx(aerial, p00.lon, p00.lat);
  const [ux, vx] = lonLatToAerialPx(aerial, pX0.lon, pX0.lat);
  const [uy, vy] = lonLatToAerialPx(aerial, p0Y.lon, p0Y.lat);
  const duDpx = (ux - u0) / width;
  const dvDpx = (vx - v0) / width;
  const duDpy = (uy - u0) / height;
  const dvDpy = (vy - v0) / height;

  const plainRgba = new Uint8Array(nPixels * 4);
  const illustratedRgba = new Uint8Array(nPixels * 4);
  const depthRgba = new Uint8Array(nPixels * 4);
  const surfaceIdRgba = new Uint8Array(nPixels * 4);
  const roadElevRgba = new Uint8Array(nPixels * 4);
  const depthMeters = new Float32Array(nPixels);
  const featureIds = new Uint32Array(nPixels);
  const surfaceKinds = new Uint8Array(nPixels);

  // Match rasterizer.ts sunlit ground blending (20% warm sand base + 80% lifted GSI aerial)
  const groundR = 228 * 0.2;
  const groundG = 221 * 0.2;
  const groundB = 206 * 0.2;

  for (let py = 0; py < height; py++) {
    const sy = py + 0.5;
    const rowU = u0 + sy * duDpy;
    const rowV = v0 + sy * dvDpy;
    const rowDepth = d00 + sy * dDepthDpy;
    const rowOff = py * width;
    for (let px = 0; px < width; px++) {
      const sx = px + 0.5;
      const au = rowU + sx * duDpx;
      const av = rowV + sx * dvDpx;
      const [ar, ag, ab] = sampleAerialRgb(aerial, au, av);

      const liftR = Math.min(255, ar * 1.14 + 12);
      const liftG = Math.min(255, ag * 1.12 + 10);
      const liftB = Math.min(255, ab * 1.08 + 6);

      const idx = rowOff + px;
      const o = idx * 4;
      plainRgba[o] = clampByte(ar);
      plainRgba[o + 1] = clampByte(ag);
      plainRgba[o + 2] = clampByte(ab);
      plainRgba[o + 3] = 255;

      illustratedRgba[o] = clampByte((groundR + liftR * 0.8) * 1.035);
      illustratedRgba[o + 1] = clampByte((groundG + liftG * 0.8) * 1.0);
      illustratedRgba[o + 2] = clampByte((groundB + liftB * 0.8) * 0.913);
      illustratedRgba[o + 3] = 255;

      const depthM = rowDepth + sx * dDepthDpx;
      depthMeters[idx] = depthM;
      surfaceKinds[idx] = SURFACE_KIND.GROUND;
      const encDepth = encodeDepthRgba(depthM, camera.nearM, camera.farM, SURFACE_KIND.GROUND);
      depthRgba[o] = encDepth[0];
      depthRgba[o + 1] = encDepth[1];
      depthRgba[o + 2] = encDepth[2];
      depthRgba[o + 3] = 255;
      surfaceIdRgba[o + 3] = 255;
      roadElevRgba[o] = groundElevEnc[0];
      roadElevRgba[o + 1] = groundElevEnc[1];
      roadElevRgba[o + 2] = groundElevEnc[2];
      roadElevRgba[o + 3] = 255;
    }
  }

  return {
    col,
    row,
    originPxX,
    originPxY,
    width,
    height,
    plainRgba,
    illustratedRgba,
    depthRgba,
    surfaceIdRgba,
    roadElevRgba,
    depthMeters,
    featureIds,
    surfaceKinds,
    hasDrawnOverride: false,
  };
}

function parseTileArgs(argv: readonly string[]): Array<[number, number]> {
  const targets: Array<[number, number]> = [];
  const seen = new Set<string>();
  const add = (col: number, row: number) => {
    if (!Number.isInteger(col) || !Number.isInteger(row)) {
      throw new Error(`Invalid tile coordinates: (${col}, ${row})`);
    }
    const key = `${col},${row}`;
    if (!seen.has(key)) {
      seen.add(key);
      targets.push([col, row]);
    }
  };

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!;
    if (arg === "--tile" && argv[i + 1]) {
      const [cStr, rStr] = argv[++i]!.split(",");
      add(Number(cStr), Number(rStr));
    } else if (arg === "--block" && argv[i + 1]) {
      const name = argv[++i]!;
      const block = TEAM_BLOCKS[name];
      if (!block) {
        throw new Error(
          `Unknown block "${name}". Available blocks: ${Object.keys(TEAM_BLOCKS).join(", ")}`,
        );
      }
      for (const [c, r] of block) add(c, r);
    } else if (/^-?\d+,-?\d+$/.test(arg)) {
      const [cStr, rStr] = arg.split(",");
      add(Number(cStr), Number(rStr));
    } else if (TEAM_BLOCKS[arg]) {
      for (const [c, r] of TEAM_BLOCKS[arg]!) add(c, r);
    }
  }

  return targets;
}

function printUsage(): void {
  console.log(`Usage:
  npm run render:tile -- --tile <col>,<row> [--tile <col>,<row> ...]
  npm run render:tile -- --block <${Object.keys(TEAM_BLOCKS).join("|")}>

Examples:
  npm run render:tile -- --tile 2,0
  npm run render:tile -- --block phase-a-2`);
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  if (args.includes("--help") || args.includes("-h")) {
    printUsage();
    return;
  }

  const targets = parseTileArgs(args);
  if (targets.length === 0) {
    printUsage();
    process.exit(1);
  }

  const camera = createShinkoPilotCamera();
  let pilotScene: ReturnType<typeof buildShinkoOsmScene> | null = null;
  let pilotShadow: ReturnType<typeof buildShadowMap> | null = null;

  for (const [col, row] of targets) {
    const t0 = performance.now();
    const bbox = computeTileAerialBbox(camera, col, row);
    const aerialBasename = `tile_${col}_${row}-z18`;
    await fetchAndStitchGsiAerial(bbox, aerialBasename);
    const aerial = loadGsiAerialMosaic(GSI_AERIAL_DIR, aerialBasename);
    if (!aerial) {
      throw new Error(`Failed to load aerial mosaic ${aerialBasename}`);
    }

    let tile: RenderedTileBuffers;
    if (col >= 0 && col <= 1 && row >= 0 && row <= 1) {
      if (!pilotScene) {
        pilotScene = existsSync(OSM_DATA_PATH)
          ? buildShinkoOsmScene(OSM_DATA_PATH)
          : buildShinkoPilotScene();
        pilotShadow = buildShadowMap(pilotScene.triangles);
      }
      tile = renderWorkingTile(
        pilotScene.camera,
        pilotScene.triangles,
        col,
        row,
        pilotShadow!,
        aerial,
      );
    } else {
      tile = renderAerialOnlyTile(camera, col, row, aerial);
    }

    const basePath = exportBaseTilePng(TILE_RENDERS_DIR, tile);
    const override = applyDrawnTileOverride(DRAWN_TILES_DIR, tile);
    console.log(
      `[render:tile] tile (${col},${row}) origin=(${tile.originPxX},${tile.originPxY}) -> ${basePath} (${(performance.now() - t0).toFixed(0)} ms)${override.applied ? ` | drawn shift=(${override.bestDx},${override.bestDy}) px edgeCorr=${override.edgeCorr}` : ""}`,
    );
  }
}

const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
