import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  SHINKO_FEATURES,
  buildShinkoPilotScene,
  type ReleaseManifest,
  type ReleasePointer,
} from "@small-yokohama/core";
import { applyDrawnTileOverride, exportBaseTilePng } from "./drawnTiles.js";
import { writeDownsampledPreviewPng, writeDziPyramid, writeLosslessDataTiles } from "./dzi.js";
import { buildPilotFixtures } from "./fixtures.js";
import { buildShinkoOsmScene } from "./osmSceneBuilder.js";
import { runPilotQa } from "./qa.js";
import {
  buildShadowMap,
  loadGsiAerialMosaic,
  renderWorkingTile,
  type RenderedTileBuffers,
} from "./rasterizer.js";
import { stitchWorkingTiles } from "./seam.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, "..", "..", "..");
const OSM_DATA_PATH = join(REPO_ROOT, "data", "shinko-osm.json");
const TILE_RENDERS_DIR = join(REPO_ROOT, "data", "tile-renders");
const DRAWN_TILES_DIR = join(REPO_ROOT, "data", "drawn-tiles");
const GSI_AERIAL_DIR = join(REPO_ROOT, "data", "gsi-aerial");
const RELEASES_ROOT = join(REPO_ROOT, "viewer", "public", "releases");
const RELEASE_ID = "pilot-shinko-v1";
const RELEASE_DIR = join(RELEASES_ROOT, RELEASE_ID);

function main(): void {
  const t0 = performance.now();
  const hasOsm = existsSync(OSM_DATA_PATH);
  console.log(`[pilot-builder] Building Shinko pilot release: ${RELEASE_ID} (source=${hasOsm ? "OpenStreetMap ODbL" : "documented-proxy"})`);

  const scene = hasOsm ? buildShinkoOsmScene(OSM_DATA_PATH) : buildShinkoPilotScene();
  const { camera, triangles } = scene;
  const aerial = loadGsiAerialMosaic(GSI_AERIAL_DIR);
  const shadowStart = performance.now();
  const shadowMap = buildShadowMap(triangles);
  console.log(
    `[pilot-builder] Scene triangles: ${triangles.length}, shadowMap=${shadowMap.size}x${shadowMap.size} (${(performance.now() - shadowStart).toFixed(0)} ms), aerial=${aerial ? `${aerial.width}x${aerial.height}` : "none"}, output: ${camera.imageWidthPx}x${camera.imageHeightPx}`,
  );

  // Optional dev shortcut: `--tile col,row` renders just 1 working tile for fast iteration
  const tileArgIdx = process.argv.indexOf("--tile");
  if (tileArgIdx !== -1 && process.argv[tileArgIdx + 1]) {
    const [colStr, rowStr] = process.argv[tileArgIdx + 1]!.split(",");
    const col = Number(colStr);
    const row = Number(rowStr);
    const single = renderWorkingTile(camera, triangles, col, row, shadowMap, aerial);
    const basePath = exportBaseTilePng(TILE_RENDERS_DIR, single);
    console.log(`[pilot-builder] Rendered single tile (${col},${row}) (${single.width}x${single.height}) -> ${basePath}`);
    return;
  }

  // Step 1: Render 2x2 overlapping working tiles (2048x2048 each, 128px overlap)
  const workingTiles: RenderedTileBuffers[] = [];
  let drawnCount = 0;
  for (let row = 0; row < camera.workingGrid.rows; row++) {
    for (let col = 0; col < camera.workingGrid.cols; col++) {
      const tileStart = performance.now();
      const tile = renderWorkingTile(camera, triangles, col, row, shadowMap, aerial);
      exportBaseTilePng(TILE_RENDERS_DIR, tile);
      const override = applyDrawnTileOverride(DRAWN_TILES_DIR, tile);
      if (override.applied) drawnCount++;
      workingTiles.push(tile);
      console.log(
        `[pilot-builder] Rendered working tile (${col},${row}) origin=(${tile.originPxX},${tile.originPxY}) in ${(performance.now() - tileStart).toFixed(0)} ms${override.applied ? " [drawn]" : ""}`,
      );
    }
  }

  // Step 2: Stitch overlap seams via DP minimum color disagreement
  const stitched = stitchWorkingTiles(camera, workingTiles);

  // Step 3: Emit DZI color pyramids (plain & illustrated) and lossless 2x2 data tiles
  mkdirSync(RELEASE_DIR, { recursive: true });
  const plainDziBytes = writeDziPyramid(
    RELEASE_DIR,
    "plain",
    stitched.width,
    stitched.height,
    stitched.plainRgba,
    camera.dzi,
  );
  const illustratedDziBytes = writeDziPyramid(
    RELEASE_DIR,
    "illustrated",
    stitched.width,
    stitched.height,
    stitched.illustratedRgba,
    camera.dzi,
  );
  writeDownsampledPreviewPng(
    join(RELEASE_DIR, "preview-illustrated.png"),
    stitched.width,
    stitched.height,
    stitched.illustratedRgba,
    1024,
  );
  writeDownsampledPreviewPng(
    join(RELEASE_DIR, "preview-plain.png"),
    stitched.width,
    stitched.height,
    stitched.plainRgba,
    1024,
  );

  const depthBytes = writeLosslessDataTiles(
    join(RELEASE_DIR, "depth"),
    "",
    stitched.width,
    stitched.height,
    stitched.depthRgba,
    camera.dataTileGrid,
  );
  const surfaceIdBytes = writeLosslessDataTiles(
    join(RELEASE_DIR, "surface-id"),
    "",
    stitched.width,
    stitched.height,
    stitched.surfaceIdRgba,
    camera.dataTileGrid,
  );
  const roadElevBytes = writeLosslessDataTiles(
    join(RELEASE_DIR, "road-elevation"),
    "ground-road",
    stitched.width,
    stitched.height,
    stitched.roadElevRgba,
    camera.dataTileGrid,
  );

  const renderMs = Number((performance.now() - t0).toFixed(1));
  const totalOutputBytes =
    plainDziBytes + illustratedDziBytes + depthBytes + surfaceIdBytes + roadElevBytes;

  // Step 4: Run automated QA acceptance checks
  const qaReport = runPilotQa(
    RELEASE_ID,
    scene,
    stitched,
    stitched.seamChecks,
    {
      renderMs,
      tileCount: workingTiles.length,
      totalOutputBytes,
      depthBytes,
      illustratedDziBytes,
      plainDziBytes,
    },
    8.0,
  );

  // Step 5: Write manifests, features, landmarks/POIs, QA report, and fixtures
  writeFileSync(join(RELEASE_DIR, "camera.json"), JSON.stringify(camera, null, 2));
  writeFileSync(join(RELEASE_DIR, "features.json"), JSON.stringify(scene.features ?? SHINKO_FEATURES, null, 2));
  writeFileSync(
    join(RELEASE_DIR, "landmarks.json"),
    JSON.stringify(
      {
        landmarks: scene.landmarks,
        pois: scene.pois ?? [],
        gcps: scene.gcps,
        deckTestPoint: scene.deckTestPoint,
      },
      null,
      2,
    ),
  );
  writeFileSync(join(RELEASE_DIR, "qa-report.json"), JSON.stringify(qaReport, null, 2));

  const fixturesDir = join(RELEASE_DIR, "fixtures");
  mkdirSync(fixturesDir, { recursive: true });
  const fixtures = buildPilotFixtures(scene);
  for (const [filename, snapshot] of Object.entries(fixtures)) {
    writeFileSync(join(fixturesDir, filename), JSON.stringify(snapshot, null, 2));
  }

  const releaseManifest: ReleaseManifest = {
    schemaVersion: "1.0.0",
    releaseId: RELEASE_ID,
    createdAt: new Date().toISOString(),
    sceneSource: "documented-proxy",
    sceneNotice: {
      ja: hasOsm
        ? drawnCount > 0
          ? `新港〜みなとみらいパイロット（${drawnCount}/4 タイル Small SF 風イラスト仕上げ済）：OpenStreetMap 実測の海岸線・建物・道路・POI (ODbL 1.0) を EPSG:6677 で立体描画しています。`
          : "新港〜みなとみらいパイロット：OpenStreetMap 実測の海岸線・建物・道路・POI (ODbL 1.0) を EPSG:6677 で立体描画しています。"
        : "新港パイロット（赤レンガ倉庫・新港サークルウォーク）：PLATEAU FY2024 導入前の検証用ドキュメント明示プロキシ形状を使用しています。",
      en: hasOsm
        ? drawnCount > 0
          ? `Shinko–Minato Mirai Pilot (${drawnCount}/4 Hero Tile illustrated in Small SF style): rendered in EPSG:6677 from real OpenStreetMap coastlines, footprints, streets & POIs (ODbL 1.0).`
          : "Shinko–Minato Mirai Pilot: rendered in EPSG:6677 from real OpenStreetMap coastlines, building footprints, streets & POIs (ODbL 1.0)."
        : "Shinko Pilot (Red Brick Warehouse & Circle Walk): using documented proxy 3D geometry in EPSG:6677 pending FY2024 PLATEAU CityGML ingestion.",
    },
    cameraPath: "camera.json",
    variants: {
      plain: { dziPath: "plain.dzi" },
      illustrated: { dziPath: "illustrated.dzi" },
    },
    layers: {
      depth: {
        tilePattern: "depth/tile_{col}_{row}.png",
        encoding: "rgba8-rg16-depth-b-surfaceKind",
        nearM: camera.nearM,
        farM: camera.farM,
      },
      surfaceId: {
        tilePattern: "surface-id/tile_{col}_{row}.png",
        encoding: "rgba8-rgb24-featureId",
      },
      roadElevation: {
        decks: {
          "ground-road": {
            tilePattern: "road-elevation/ground-road_tile_{col}_{row}.png",
            encoding: "rgba8-rg16-elevation",
            minM: 0,
            maxM: 100,
          },
        },
      },
      waterMask: {
        encoding: "depth.b == 1 (SURFACE_KIND.WATER)",
        surfaceKindValue: 1,
      },
    },
    featuresPath: "features.json",
    landmarksPath: "landmarks.json",
    qaReportPath: "qa-report.json",
    credits: [
      {
        id: "small-yokohama-code",
        publisher: "Small Yokohama Contributors",
        dataset: "Small Yokohama Pilot Scene, Renderer & Viewer",
        version: RELEASE_ID,
        retrievedAt: "2026-11-24",
        license: "MIT",
        redistribution: "Permitted under MIT License",
        attributionText: "Small Yokohama (MIT)",
        modifications: "Original documented proxy 3D meshes and illustrated DZI render for Shinko pilot.",
        url: "https://github.com/moruku36/small-yokohama",
      },
      {
        id: "plateau-yokohama-target",
        publisher: "MLIT / City of Yokohama (Target Upstream)",
        dataset: "Project PLATEAU 3D City Model Yokohama FY2024 (Integration Ready)",
        version: "FY2024 (Pending ingestion in pipeline/)",
        retrievedAt: "2026-11-24",
        license: "PLATEAU Site Policy (CC BY 4.0 compatible)",
        redistribution: "Attribution required when FY2024 CityGML tiles are built via pipeline/.",
        attributionText: "MLIT Project PLATEAU (Yokohama FY2024 target schema)",
        modifications: "Pilot currently uses documented proxy geometry calibrated to EPSG:6677.",
        url: "https://www.geospatial.jp/ckan/dataset/plateau-14100-yokohama-shi-2024",
      },
      {
        id: "osm-contributors",
        publisher: "OpenStreetMap Contributors",
        dataset: "OSM Coastline & Waterfront Reference",
        version: "2026-11",
        retrievedAt: "2026-11-24",
        license: "ODbL 1.0",
        redistribution: "Open Database License attribution required",
        attributionText: "© OpenStreetMap contributors (ODbL)",
        modifications: "Used for coastline, building footprints, multipolygons, roads, parks & POIs.",
        url: "https://osmdata.openstreetmap.de/data/land-polygons.html",
      },
      {
        id: "gsi-japan-seamlessphoto",
        publisher: "Geospatial Information Authority of Japan (国土地理院)",
        dataset: "GSI Seamless Photo (地理院タイル シームレス写真 z=18)",
        version: "2026-11",
        retrievedAt: "2026-11-24",
        license: "GSI Terms of Use (出典明記で自由利用可)",
        redistribution: "Attribution required: 出典 国土地理院（シームレス写真）",
        attributionText: "国土地理院（シームレス写真）",
        modifications: "Orthorectified onto 3D ground parcels, plazas, parking lots & flat rooftops.",
        url: "https://maps.gsi.go.jp/development/ichiran.html",
      },
      {
        id: "odpt-yokohama-bus",
        publisher: "Transportation Bureau, City of Yokohama / ODPT",
        dataset: "Yokohama Municipal Bus GTFS-JP & GTFS-RT VehiclePosition",
        version: "2026-11-01 (Fixture mode active without token)",
        retrievedAt: "2026-11-24",
        license: "ODPT Basic & Specific Terms",
        redistribution: "Token kept strictly server-side in collector/; viewer uses labeled fixtures or normalized snapshot.",
        attributionText: "Yokohama Municipal Bus / ODPT (Synthetic & Scheduled Fixtures in Pilot)",
        modifications: "Normalized into public snapshot schema with explicit mode & observation timestamp.",
        url: "https://developer.odpt.org/terms",
      },
    ],
  };

  writeFileSync(join(RELEASE_DIR, "release.json"), JSON.stringify(releaseManifest, null, 2));

  // Atomic-style release pointer update
  const pointer: ReleasePointer = {
    releaseId: RELEASE_ID,
    manifestPath: `./${RELEASE_ID}/release.json`,
    updatedAt: new Date().toISOString(),
  };
  writeFileSync(join(RELEASES_ROOT, "current.json"), JSON.stringify(pointer, null, 2));

  console.log(
    `[pilot-builder] QA Passed: ${qaReport.passed} | GCPs: ${qaReport.gcpChecks.length} | maxDisp=${qaReport.maxGcpDisplacementPx} px | waterInventedBuildings=${qaReport.waterIntegrity.inventedBuildingPixels} | elapsed=${renderMs} ms`,
  );

  if (!qaReport.passed) {
    console.error("[pilot-builder] QA checks failed! See qa-report.json for details.");
    process.exit(1);
  }
}

main();
