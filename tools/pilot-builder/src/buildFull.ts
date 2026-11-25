import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  SURFACE_KIND,
  createFullYokohamaCamera,
  createShinkoPilotCamera,
  encodeDepthRgba,
  encodeElevationRgba,
  imageToLocalOnPlane,
  localToImage,
  localToWgs84,
  wgs84ToImage,
  type CameraManifest,
  type Landmark,
  type PoiRecord,
  type ReleaseManifest,
  type ReleasePointer,
  type ShinkoSceneBundle,
} from "@small-yokohama/core";
import { applyDrawnTileOverride } from "./drawnTiles.js";
import { writeDownsampledPreviewPng, writeDziPyramid, writeLosslessDataTiles } from "./dzi.js";
import { buildPilotFixtures } from "./fixtures.js";
import { buildShinkoOsmScene } from "./osmSceneBuilder.js";
import { encodePngRgba } from "./png.js";
import { runPilotQa } from "./qa.js";
import {
  buildShadowMap,
  loadGsiAerialMosaic,
  renderWorkingTile,
  type RenderedTileBuffers,
} from "./rasterizer.js";
import { renderAerialOnlyTile } from "./renderTile.js";
import {
  computeGridSeamPlan,
  stitchGridRgbaLayer,
  type GridTileEntry,
  type StitchedPilotBuffers,
} from "./seam.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, "..", "..", "..");
const OSM_DATA_PATH = join(REPO_ROOT, "data", "shinko-osm.json");
const GSI_AERIAL_DIR = join(REPO_ROOT, "data", "gsi-aerial");
const DRAWN_TILES_DIR = join(REPO_ROOT, "data", "drawn-tiles");
const DOCS_IMAGES_DIR = join(REPO_ROOT, "docs", "images");

const RELEASE_ID = "full-yokohama-v1";
const RELEASES_ROOT = join(REPO_ROOT, "viewer", "public", "releases");
const RELEASE_DIR = join(RELEASES_ROOT, RELEASE_ID);
const CURRENT_PTR_PATH = join(RELEASES_ROOT, "current.json");

function isCoreShinkoTile(col: number, row: number): boolean {
  return col >= 0 && col <= 1 && row >= 0 && row <= 1;
}

/**
 * Downsample discrete RGBA8 data buffers (16-bit split depth, 24-bit feature ID, elevation)
 * 2x by nearest-neighbor sampling so bit-packed integer fields are never corrupted by interpolation.
 */
function downsample2xNearestRgba(
  src: Uint8Array,
  srcW: number,
  srcH: number,
): { width: number; height: number; data: Uint8Array } {
  const dstW = Math.floor(srcW / 2);
  const dstH = Math.floor(srcH / 2);
  const dst = new Uint8Array(dstW * dstH * 4);
  for (let y = 0; y < dstH; y++) {
    const sy = y * 2;
    const dstRow = y * dstW * 4;
    const srcRow = sy * srcW * 4;
    for (let x = 0; x < dstW; x++) {
      const s = srcRow + x * 2 * 4;
      const d = dstRow + x * 4;
      dst[d] = src[s]!;
      dst[d + 1] = src[s + 1]!;
      dst[d + 2] = src[s + 2]!;
      dst[d + 3] = src[s + 3]!;
    }
  }
  return { width: dstW, height: dstH, data: dst };
}

function createOutOfScopeCornerTile(
  pilotCamera: CameraManifest,
  col: number,
  row: number,
  westTileIllus: Uint8Array,
  westTilePlain: Uint8Array,
  southTileIllus: Uint8Array,
  southTilePlain: Uint8Array,
): {
  illus: Uint8Array;
  plain: Uint8Array;
  halfDepth: Uint8Array;
  halfId: Uint8Array;
  halfRoad: Uint8Array;
} {
  const { tileSizePx, overlapPx } = pilotCamera.workingGrid;
  const stridePx = tileSizePx - overlapPx;
  const nPixels = tileSizePx * tileSizePx;
  const illus = new Uint8Array(nPixels * 4);
  const plain = new Uint8Array(nPixels * 4);
  const depthRgba = new Uint8Array(nPixels * 4);
  const idRgba = new Uint8Array(nPixels * 4);
  const roadRgba = new Uint8Array(nPixels * 4);

  const originPxX = col * stridePx;
  const originPxY = row * stridePx;
  const loc00 = imageToLocalOnPlane(pilotCamera, originPxX, originPxY, 2.0);
  const locX0 = imageToLocalOnPlane(pilotCamera, originPxX + tileSizePx, originPxY, 2.0);
  const loc0Y = imageToLocalOnPlane(pilotCamera, originPxX, originPxY + tileSizePx, 2.0);
  const d00 = localToImage(pilotCamera, loc00).depthM;
  const dX0 = localToImage(pilotCamera, locX0).depthM;
  const d0Y = localToImage(pilotCamera, loc0Y).depthM;
  const dDepthDpx = (dX0 - d00) / tileSizePx;
  const dDepthDpy = (d0Y - d00) / tileSizePx;
  const groundElevEnc = encodeElevationRgba(2.0, 0, 100, true);

  // Cream parchment margin matching Small Yokohama warm paper border;
  // fade strictly within the real 128 px neighbor overlaps (zero clamped edge streaks)
  const paperIllus = [235, 227, 213] as const;
  const paperPlain = [226, 224, 218] as const;
  const fadeStartPx = 12;
  const fadeEndPx = overlapPx - 4;
  const smooth = (t: number) => {
    const c = Math.max(0, Math.min(1, t));
    return c * c * (3 - 2 * c);
  };

  for (let py = 0; py < tileSizePx; py++) {
    const sy = py + 0.5;
    const rowDepth = d00 + sy * dDepthDpy;
    const pyInSouth = py - stridePx;
    const wSouth =
      pyInSouth >= 0
        ? smooth((pyInSouth - (overlapPx - fadeEndPx)) / (fadeEndPx - fadeStartPx))
        : 0;
    const southSampleY = Math.min(overlapPx - 1, Math.max(0, pyInSouth));

    for (let px = 0; px < tileSizePx; px++) {
      const idx = py * tileSizePx + px;
      const o = idx * 4;

      const wWest =
        px < overlapPx
          ? 1 - smooth((px - fadeStartPx) / (fadeEndPx - fadeStartPx))
          : 0;
      const westSampleX = Math.min(tileSizePx - 1, stridePx + px);

      const blendEdge = (
        westBuf: Uint8Array,
        southBuf: Uint8Array,
        paper: readonly [number, number, number],
      ): [number, number, number] => {
        if (wWest <= 0 && wSouth <= 0) {
          return [paper[0], paper[1], paper[2]];
        }
        const wo = (py * tileSizePx + westSampleX) * 4;
        const so = (southSampleY * tileSizePx + px) * 4;
        const total = wWest + wSouth;
        let er = paper[0];
        let eg = paper[1];
        let eb = paper[2];
        if (total > 0) {
          er = (westBuf[wo]! * wWest + southBuf[so]! * wSouth) / total;
          eg = (westBuf[wo + 1]! * wWest + southBuf[so + 1]! * wSouth) / total;
          eb = (westBuf[wo + 2]! * wWest + southBuf[so + 2]! * wSouth) / total;
        }
        const wEdge = Math.min(1, Math.max(wWest, wSouth));
        return [
          Math.round(paper[0] * (1 - wEdge) + er * wEdge),
          Math.round(paper[1] * (1 - wEdge) + eg * wEdge),
          Math.round(paper[2] * (1 - wEdge) + eb * wEdge),
        ];
      };

      const [ir, ig, ib] = blendEdge(westTileIllus, southTileIllus, paperIllus);
      illus[o] = ir;
      illus[o + 1] = ig;
      illus[o + 2] = ib;
      illus[o + 3] = 255;

      const [pr, pg, pb] = blendEdge(westTilePlain, southTilePlain, paperPlain);
      plain[o] = pr;
      plain[o + 1] = pg;
      plain[o + 2] = pb;
      plain[o + 3] = 255;

      const depthM = rowDepth + (px + 0.5) * dDepthDpx;
      const encDepth = encodeDepthRgba(depthM, pilotCamera.nearM, pilotCamera.farM, SURFACE_KIND.GROUND);
      depthRgba[o] = encDepth[0];
      depthRgba[o + 1] = encDepth[1];
      depthRgba[o + 2] = encDepth[2];
      depthRgba[o + 3] = 255;
      idRgba[o + 3] = 255;
      roadRgba[o] = groundElevEnc[0];
      roadRgba[o + 1] = groundElevEnc[1];
      roadRgba[o + 2] = groundElevEnc[2];
      roadRgba[o + 3] = 255;
    }
  }

  return {
    illus,
    plain,
    halfDepth: downsample2xNearestRgba(depthRgba, tileSizePx, tileSizePx).data,
    halfId: downsample2xNearestRgba(idRgba, tileSizePx, tileSizePx).data,
    halfRoad: downsample2xNearestRgba(roadRgba, tileSizePx, tileSizePx).data,
  };
}

function cropRgbaRect(
  src: Uint8Array,
  srcW: number,
  srcH: number,
  x0: number,
  y0: number,
  w: number,
  h: number,
): Uint8Array {
  const cx0 = Math.max(0, Math.min(srcW - w, x0));
  const cy0 = Math.max(0, Math.min(srcH - h, y0));
  const out = new Uint8Array(w * h * 4);
  for (let y = 0; y < h; y++) {
    const s = ((cy0 + y) * srcW + cx0) * 4;
    out.set(src.subarray(s, s + w * 4), y * w * 4);
  }
  return out;
}

const FULL_YOKOHAMA_CURATED_LANDMARKS: ReadonlyArray<{
  id: string;
  nameJa: string;
  nameEn: string;
  category: Landmark["category"];
  lon: number;
  lat: number;
  elevationM: number;
  descriptionJa: string;
  descriptionEn: string;
  heightM?: number;
}> = [
  {
    id: "lm-yokohama-station",
    nameJa: "横浜駅（東口・そごう・スカイビル）",
    nameEn: "Yokohama Station East (Sogo & Sky Bldg)",
    category: "landmark",
    lon: 139.6238,
    lat: 35.4658,
    elevationM: 28,
    descriptionJa: "横浜最大のターミナル駅とそごう横浜店・横浜スカイビル。",
    descriptionEn: "Major rail hub anchored by Sogo Yokohama and Yokohama Sky Building.",
  },
  {
    id: "lm-bay-quarter",
    nameJa: "横浜ベイクォーター・ポートサイド",
    nameEn: "Yokohama Bay Quarter & Portside",
    category: "pier",
    lon: 139.6266,
    lat: 35.4666,
    elevationM: 18,
    descriptionJa: "帷子川河口のボードウォークと船着場を擁する複合商業施設。",
    descriptionEn: "Waterfront dining complex and sea-bass pier at the Katabira River mouth.",
  },
  {
    id: "lm-nissan-hq",
    nameJa: "日産自動車グローバル本社",
    nameEn: "Nissan Global Headquarters",
    category: "landmark",
    lon: 139.6267,
    lat: 35.4614,
    elevationM: 42,
    descriptionJa: "新高島エリアと横浜駅東口を歩行者デッキで結ぶ水辺の本社ビル。",
    descriptionEn: "Canalfront headquarters linking Yokohama Station East to Minato Mirai.",
  },
  {
    id: "lm-landmark-tower",
    nameJa: "横浜ランドマークタワー・日本丸",
    nameEn: "Yokohama Landmark Tower & Nippon Maru",
    category: "landmark",
    lon: 139.6316,
    lat: 35.4549,
    elevationM: 60,
    descriptionJa: "296mの横浜のシンボルタワーと帆船日本丸記念公園。",
    descriptionEn: "296 m Yokohama icon overlooking Nippon Maru Memorial Park.",
  },
  {
    id: "lm-pacifico",
    nameJa: "パシフィコ横浜・臨港パーク",
    nameEn: "Pacifico Yokohama & Rinko Park",
    category: "landmark",
    lon: 139.6362,
    lat: 35.4579,
    elevationM: 32,
    descriptionJa: "ヨットの帆を模したホテルと海辺の大芝生が広がるコンベンション拠点。",
    descriptionEn: "Sail-shaped waterfront hotel, convention halls, and Rinko Park lawn.",
  },
  {
    id: "lm-cosmo-world",
    nameJa: "よこはまコスモワールド（大観覧車）",
    nameEn: "Yokohama Cosmo World & Clock 21",
    category: "landmark",
    lon: 139.6368,
    lat: 35.4552,
    elevationM: 45,
    descriptionJa: "大観覧車コスモクロック21が目印の都市型遊園地。",
    descriptionEn: "Canal-straddling amusement park crowned by Cosmo Clock 21 Ferris wheel.",
  },
  {
    id: "lm-redbrick-2",
    nameJa: "横浜赤レンガ倉庫（1号館・2号館）",
    nameEn: "Yokohama Red Brick Warehouse",
    category: "landmark",
    lon: 139.6429,
    lat: 35.4526,
    elevationM: 18,
    descriptionJa: "明治末〜大正初期の保税倉庫を再生した新港ふ頭の歴史的象徴。",
    descriptionEn: "Restored early-20th-century brick warehouses overlooking Yokohama Harbor.",
  },
  {
    id: "lm-circle-walk",
    nameJa: "新港サークルウォーク・ハンマーヘッド入口",
    nameEn: "Shinko Circle Walk",
    category: "bridge",
    lon: 139.6394,
    lat: 35.4531,
    elevationM: 7,
    descriptionJa: "国際大通りを跨ぐ円形ペデストリアンデッキ。",
    descriptionEn: "Circular elevated pedestrian deck spanning Kokusai-Odori Avenue.",
  },
  {
    id: "lm-hammerhead",
    nameJa: "横浜ハンマーヘッド・50tクレーン",
    nameEn: "Yokohama Hammerhead & Crane",
    category: "pier",
    lon: 139.6442,
    lat: 35.4556,
    elevationM: 12,
    descriptionJa: "客船ターミナルと歴史的ハンマーヘッドクレーンを擁する新港9号岸壁。",
    descriptionEn: "Cruise terminal and preserved 50-ton hammerhead crane at Shinko Pier.",
  },
  {
    id: "lm-osanbashi",
    nameJa: "横浜港大さん橋国際客船ターミナル",
    nameEn: "Osanbashi International Passenger Terminal",
    category: "pier",
    lon: 139.6481,
    lat: 35.4519,
    elevationM: 10,
    descriptionJa: "くじらのせなかと呼ばれる木製屋上デッキが特徴の国際客船埠頭。",
    descriptionEn: "Sculpted timber rooftop pier projecting into Yokohama Harbor.",
  },
  {
    id: "lm-yamashita-park",
    nameJa: "山下公園・日本郵船氷川丸",
    nameEn: "Yamashita Park & NYK Hikawa Maru",
    category: "park",
    lon: 139.6502,
    lat: 35.4461,
    elevationM: 6,
    descriptionJa: "関内〜元町海沿いに広がる歴史的海浜公園と係留船氷川丸。",
    descriptionEn: "Iconic harborfront promenade park and moored museum liner Hikawa Maru.",
  },
  {
    id: "lm-chinatown",
    nameJa: "横浜中華街・横浜マリンタワー",
    nameEn: "Yokohama Chinatown & Marine Tower",
    category: "landmark",
    lon: 139.6458,
    lat: 35.4429,
    elevationM: 14,
    descriptionJa: "善隣門・関帝廟・牌楼が連なる日本最大の中華街。",
    descriptionEn: "Japan's largest Chinatown framed by ceremonial pailou gates.",
  },
  {
    id: "lm-kannai-stadium",
    nameJa: "横浜公園・横浜スタジアム（関内）",
    nameEn: "Yokohama Stadium & Kannai",
    category: "landmark",
    lon: 139.6401,
    lat: 35.4434,
    elevationM: 22,
    descriptionJa: "関内駅前・横浜公園に建つ円形スタジアムと歴史的官庁街。",
    descriptionEn: "Iconic baseball stadium and historic Kannai civic avenue.",
  },
  {
    id: "lm-noge",
    nameJa: "野毛・日ノ出町・都橋商店街",
    nameEn: "Noge, Hinodecho & Ooka River",
    category: "landmark",
    lon: 139.6295,
    lat: 35.4488,
    elevationM: 12,
    descriptionJa: "大岡川沿いの湾曲した都橋商店街と野毛の路地街区・野毛山緑地。",
    descriptionEn: "Curved riverfront Miyakobashi arcade along Ooka River and Noge lanes.",
  },
  {
    id: "lm-motomachi-yamate",
    nameJa: "元町商店街・港の見える丘公園・山手",
    nameEn: "Motomachi, Harbor View Park & Yamate Bluff",
    category: "park",
    lon: 139.6508,
    lat: 35.4395,
    elevationM: 26,
    descriptionJa: "中村川を挟む元町ショッピングストリートと緑豊かな山手の洋館街。",
    descriptionEn: "Historic Motomachi shopping avenue rising toward Yamate Bluff gardens.",
  },
];

async function main(): Promise<void> {
  const tStart = performance.now();
  const pilotCamera = createShinkoPilotCamera();
  const fullCamera = createFullYokohamaCamera();
  const fullW = fullCamera.imageWidthPx;
  const fullH = fullCamera.imageHeightPx;
  const halfW = Math.floor(fullW * (fullCamera.dataTileGrid.scale ?? 0.5));
  const halfH = Math.floor(fullH * (fullCamera.dataTileGrid.scale ?? 0.5));

  console.log(
    `[full-builder] Building ${RELEASE_ID}: ${fullW}x${fullH} px (data ${halfW}x${halfH} px)`,
  );

  // 1. Build 3D Shinko core scene & shadow map
  const pilotScene = buildShinkoOsmScene(OSM_DATA_PATH);
  const shadowMap = buildShadowMap(pilotScene.triangles, 2048, 1100);
  const shinkoAerial = loadGsiAerialMosaic(GSI_AERIAL_DIR, "shinko-z18");

  // 2. Render & align all 23 active tiles (plus placeholder for 5,-1), immediately downsampling data layers to 0.5x
  const { cols, rows, tileSizePx, overlapPx } = fullCamera.workingGrid;
  const colOffset = fullCamera.workingGrid.colOffset ?? 0;
  const rowOffset = fullCamera.workingGrid.rowOffset ?? 0;

  const illusTiles: GridTileEntry[] = [];
  const plainTiles: GridTileEntry[] = [];
  const halfDepthTiles: GridTileEntry[] = [];
  const halfIdTiles: GridTileEntry[] = [];
  const halfRoadTiles: GridTileEntry[] = [];

  let westCornerIllus: Uint8Array | null = null;
  let westCornerPlain: Uint8Array | null = null;
  let southCornerIllus: Uint8Array | null = null;
  let southCornerPlain: Uint8Array | null = null;

  for (let rIdx = 0; rIdx < rows; rIdx++) {
    const row = rowOffset + rIdx;
    for (let cIdx = 0; cIdx < cols; cIdx++) {
      const col = colOffset + cIdx;
      if (col === 5 && row === -1) {
        continue;
      }

      const tTile0 = performance.now();
      let tile: RenderedTileBuffers;
      if (isCoreShinkoTile(col, row)) {
        tile = renderWorkingTile(
          pilotCamera,
          pilotScene.triangles,
          col,
          row,
          shadowMap,
          shinkoAerial,
        );
      } else {
        const mosaicName = `tile_${col}_${row}-z18`;
        const aerial = loadGsiAerialMosaic(GSI_AERIAL_DIR, mosaicName);
        if (!aerial) {
          throw new Error(`Missing GSI aerial mosaic ${mosaicName} in ${GSI_AERIAL_DIR}`);
        }
        tile = renderAerialOnlyTile(pilotCamera, col, row, aerial);
      }

      const ov = applyDrawnTileOverride(DRAWN_TILES_DIR, tile);
      if (!ov.applied) {
        throw new Error(`Expected drawn tile override for active tile (${col}, ${row})`);
      }

      illusTiles.push({
        col,
        row,
        hasDrawnOverride: true,
        rgba: tile.illustratedRgba,
      });
      plainTiles.push({
        col,
        row,
        hasDrawnOverride: false,
        rgba: tile.plainRgba,
      });
      halfDepthTiles.push({
        col,
        row,
        hasDrawnOverride: true,
        rgba: downsample2xNearestRgba(tile.depthRgba, tileSizePx, tileSizePx).data,
      });
      halfIdTiles.push({
        col,
        row,
        hasDrawnOverride: true,
        rgba: downsample2xNearestRgba(tile.surfaceIdRgba, tileSizePx, tileSizePx).data,
      });
      halfRoadTiles.push({
        col,
        row,
        hasDrawnOverride: true,
        rgba: downsample2xNearestRgba(tile.roadElevRgba, tileSizePx, tileSizePx).data,
      });

      if (col === 4 && row === -1) {
        westCornerIllus = tile.illustratedRgba;
        westCornerPlain = tile.plainRgba;
      } else if (col === 5 && row === 0) {
        southCornerIllus = tile.illustratedRgba;
        southCornerPlain = tile.plainRgba;
      }

      console.log(
        `[full-builder] tile (${col},${row}) [${illusTiles.length}/23] shift=(${ov.bestDx},${ov.bestDy})px corr=${ov.edgeCorr} (${(performance.now() - tTile0).toFixed(0)} ms)`,
      );
    }
  }

  // Synthesize soft parchment transition tile for out-of-scope slot (5,-1)
  if (!westCornerIllus || !westCornerPlain || !southCornerIllus || !southCornerPlain) {
    throw new Error("Expected neighbor tiles (4,-1) and (5,0) for corner vignette");
  }
  const corner = createOutOfScopeCornerTile(
    pilotCamera,
    5,
    -1,
    westCornerIllus,
    westCornerPlain,
    southCornerIllus,
    southCornerPlain,
  );
  illusTiles.push({ col: 5, row: -1, hasDrawnOverride: false, rgba: corner.illus });
  plainTiles.push({ col: 5, row: -1, hasDrawnOverride: false, rgba: corner.plain });
  halfDepthTiles.push({ col: 5, row: -1, hasDrawnOverride: false, rgba: corner.halfDepth });
  halfIdTiles.push({ col: 5, row: -1, hasDrawnOverride: false, rgba: corner.halfId });
  halfRoadTiles.push({ col: 5, row: -1, hasDrawnOverride: false, rgba: corner.halfRoad });

  // 3. Compute DP seam plan across all 24 grid slots (27 vertical + 2 horizontal joins)
  const tSeam0 = performance.now();
  const plan = computeGridSeamPlan(fullCamera, illusTiles);
  for (const s of plan.seamChecks) {
    console.log(
      `[full-builder] seam ${s.seamId}: meanDiff=${s.meanColorDiff} maxDiff=${s.maxColorDiff} pass=${s.passed}`,
    );
    if (!s.passed) {
      throw new Error(`Seam check failed: ${s.seamId} meanColorDiff=${s.meanColorDiff}`);
    }
  }
  console.log(`[full-builder] DP seam plan computed in ${(performance.now() - tSeam0).toFixed(0)} ms`);

  // Prepare output directory
  rmSync(RELEASE_DIR, { recursive: true, force: true });
  mkdirSync(RELEASE_DIR, { recursive: true });
  mkdirSync(DOCS_IMAGES_DIR, { recursive: true });

  // 4a. Stitch illustrated color layer -> previews -> illustrated DZI -> free full-res buffers
  console.log("[full-builder] Stitching illustrated 15488x5888 canvas...");
  let stitchedIllus: Uint8Array | null = stitchGridRgbaLayer(plan, illusTiles, 14);
  illusTiles.length = 0;

  writeDownsampledPreviewPng(
    join(DOCS_IMAGES_DIR, "full-yokohama-23tiles-preview.png"),
    fullW,
    fullH,
    stitchedIllus,
    2400,
  );
  const seamCrops: ReadonlyArray<{ name: string; x: number; y: number; w: number; h: number }> = [
    { name: "full-seam-yokohama-station.png", x: 10984, y: 3454, w: 1200, h: 900 },
    { name: "full-seam-minatomirai.png", x: 7144, y: 1534, w: 1200, h: 900 },
    { name: "full-seam-yamashita-chinatown.png", x: 3304, y: 1534, w: 1200, h: 900 },
    { name: "full-seam-kannai-noge.png", x: 5224, y: 1534, w: 1200, h: 900 },
  ];
  for (const crop of seamCrops) {
    const buf = cropRgbaRect(stitchedIllus, fullW, fullH, crop.x, crop.y, crop.w, crop.h);
    writeFileSync(join(DOCS_IMAGES_DIR, crop.name), encodePngRgba(crop.w, crop.h, buf));
  }

  console.log("[full-builder] Writing illustrated.dzi pyramid (512px tiles)...");
  const illustratedDziBytes = writeDziPyramid(
    RELEASE_DIR,
    "illustrated",
    fullW,
    fullH,
    stitchedIllus,
    fullCamera.dzi,
  );
  stitchedIllus = null;

  // 4b. Stitch plain reference layer -> plain DZI -> free plain buffers
  console.log("[full-builder] Stitching plain reference layer & writing plain.dzi...");
  let stitchedPlain: Uint8Array | null = stitchGridRgbaLayer(plan, plainTiles, 0);
  plainTiles.length = 0;
  const plainDziBytes = writeDziPyramid(
    RELEASE_DIR,
    "plain",
    fullW,
    fullH,
    stitchedPlain,
    fullCamera.dzi,
  );
  stitchedPlain = null;

  // 5. Build half-res GridSeamPlan and stitch lossless depth / featureId / roadElevation layers
  const halfPlan = {
    cols: plan.cols,
    rows: plan.rows,
    colOffset: plan.colOffset,
    rowOffset: plan.rowOffset,
    tileSizePx: tileSizePx / 2,
    overlapPx: overlapPx / 2,
    fullWidth: halfW,
    fullHeight: halfH,
    verticalCuts: plan.verticalCuts.map((cuts) => {
      const half = new Int32Array(tileSizePx / 2);
      for (let i = 0; i < half.length; i++) half[i] = Math.floor(cuts[i * 2]! / 2);
      return half;
    }),
    horizontalCuts: plan.horizontalCuts.map((cuts) => {
      const half = new Int32Array(halfW);
      for (let i = 0; i < half.length; i++) half[i] = Math.floor(cuts[i * 2]! / 2);
      return half;
    }),
    seamChecks: plan.seamChecks,
  };

  console.log(`[full-builder] Stitching ${halfW}x${halfH} half-res lossless data layers...`);
  const depthRgba = stitchGridRgbaLayer(halfPlan, halfDepthTiles, 0);
  const surfaceIdRgba = stitchGridRgbaLayer(halfPlan, halfIdTiles, 0);
  const roadElevRgba = stitchGridRgbaLayer(halfPlan, halfRoadTiles, 0);
  halfDepthTiles.length = 0;
  halfIdTiles.length = 0;
  halfRoadTiles.length = 0;

  const depthBytes = writeLosslessDataTiles(
    join(RELEASE_DIR, "depth"),
    "",
    halfW,
    halfH,
    depthRgba,
    fullCamera.dataTileGrid,
  );
  const featureIdBytes = writeLosslessDataTiles(
    join(RELEASE_DIR, "surface-id"),
    "",
    halfW,
    halfH,
    surfaceIdRgba,
    fullCamera.dataTileGrid,
  );
  const roadElevBytes = writeLosslessDataTiles(
    join(RELEASE_DIR, "road-elevation"),
    "ground-road",
    halfW,
    halfH,
    roadElevRgba,
    fullCamera.dataTileGrid,
  );

  // 6. Merge full-Yokohama curated landmarks + Shinko scene metadata & fixtures
  const curatedLandmarks: Landmark[] = FULL_YOKOHAMA_CURATED_LANDMARKS.map((item) => {
    const pt = wgs84ToImage(fullCamera, item.lon, item.lat, item.elevationM);
    if (pt.px < 0 || pt.px >= fullW || pt.py < 0 || pt.py >= fullH) {
      throw new Error(`Landmark ${item.id} projected outside canvas: (${pt.px}, ${pt.py})`);
    }
    return {
      id: item.id,
      featureId: 2,
      nameJa: item.nameJa,
      nameEn: item.nameEn,
      category: item.category,
      lon: item.lon,
      lat: item.lat,
      elevationM: item.elevationM,
      descriptionJa: item.descriptionJa,
      descriptionEn: item.descriptionEn,
      sourceKind: "osm-odbl",
      tier: 1,
      googleMapsUrl: `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${item.nameJa} 横浜`)}`,
    };
  });

  const existingIds = new Set(curatedLandmarks.map((l) => l.id));
  const mergedLandmarks = [
    ...curatedLandmarks,
    ...pilotScene.landmarks.filter((l) => !existingIds.has(l.id)),
  ];

  const existingPois = pilotScene.pois ?? [];
  const existingPoiIds = new Set(existingPois.map((p) => p.id));
  const extraPois: PoiRecord[] = curatedLandmarks
    .filter((l) => !existingPoiIds.has(l.id))
    .map((l) => ({
      id: l.id,
      osmId: 0,
      nameJa: l.nameJa,
      nameEn: l.nameEn,
      category: l.category,
      tier: 1,
      lon: l.lon,
      lat: l.lat,
      elevationM: l.elevationM,
      descriptionJa: l.descriptionJa,
      descriptionEn: l.descriptionEn,
      googleMapsUrl: l.googleMapsUrl ?? "",
    }));
  const mergedPois: PoiRecord[] = [...extraPois, ...existingPois];

  const fullScene: ShinkoSceneBundle = {
    ...pilotScene,
    camera: fullCamera,
    landmarks: mergedLandmarks,
    pois: mergedPois,
  };

  // 7. Run automated QA against half-res data buffers & full camera
  const stitchedForQa: StitchedPilotBuffers = {
    width: fullW,
    height: fullH,
    dataWidth: halfW,
    dataHeight: halfH,
    dataScale: 0.5,
    plainRgba: new Uint8Array(0),
    illustratedRgba: new Uint8Array(0),
    depthRgba,
    surfaceIdRgba,
    roadElevRgba,
    seamChecks: plan.seamChecks,
  };

  const renderMs = Math.round(performance.now() - tStart);
  const totalOutputBytes =
    illustratedDziBytes + plainDziBytes + depthBytes + featureIdBytes + roadElevBytes;

  const qaReport = runPilotQa(RELEASE_ID, fullScene, stitchedForQa, plan.seamChecks, {
    renderMs,
    tileCount: 23,
    totalOutputBytes,
    depthBytes,
    illustratedDziBytes,
    plainDziBytes,
  });

  if (!qaReport.passed) {
    writeFileSync(join(RELEASE_DIR, "qa-report.json"), JSON.stringify(qaReport, null, 2));
    throw new Error(`Full-Yokohama QA failed! See ${join(RELEASE_DIR, "qa-report.json")}`);
  }

  // 8. Emit manifests, features, landmarks, fixtures & current.json
  const releaseJson: ReleaseManifest = {
    schemaVersion: "1.0.0",
    releaseId: RELEASE_ID,
    createdAt: new Date().toISOString(),
    sceneSource: "documented-proxy",
    sceneNotice: {
      ja: "横浜臨海部 全23/23タイル（15,488×5,888px）Ligne-Claire & ウォームガッシュイラスト地図：横浜駅〜みなとみらい〜新港〜大さん橋〜山下公園〜中華街〜関内〜野毛〜山手をシームレス接合。",
      en: "Full Yokohama Waterfront (23/23 tiles, 15,488×5,888 px) in Ligne-Claire gouache: seamlessly stitched from Yokohama Station & Minato Mirai to Osanbashi, Yamashita Park, Chinatown, Kannai, Noge & Yamate.",
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
        nearM: fullCamera.nearM,
        farM: fullCamera.farM,
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
        surfaceKindValue: SURFACE_KIND.WATER,
      },
    },
    featuresPath: "features.json",
    landmarksPath: "landmarks.json",
    qaReportPath: "qa-report.json",
    credits: [
      {
        id: "small-yokohama-code",
        publisher: "Small Yokohama Contributors",
        dataset: "Small Yokohama 23-Tile Illustrated Map, Pipeline & Viewer",
        version: RELEASE_ID,
        retrievedAt: "2026-11-25",
        license: "MIT",
        redistribution: "Permitted under MIT License",
        attributionText: "Small Yokohama (MIT)",
        modifications:
          "Stitched 23/23 illustrated tiles across 8x3 working grid (15,488x5,888 px) with core EPSG:6677 3D Shinko relief.",
        url: "https://github.com/moruku36/small-yokohama",
      },
      ...(pilotScene.osmAttribution
        ? [
            {
              id: "osm-contributors",
              publisher: "OpenStreetMap Contributors",
              dataset: "OSM Coastline, Buildings, Roads & POIs",
              version: "2026-11",
              retrievedAt: "2026-11-24",
              license: "ODbL 1.0",
              redistribution: "Open Database License attribution required",
              attributionText: "© OpenStreetMap contributors (ODbL)",
              modifications: "Used for coastline, building footprints, roads, parks & POIs.",
              url: "https://osmdata.openstreetmap.de/data/land-polygons.html",
            },
          ]
        : []),
      {
        id: "gsi-japan-seamlessphoto",
        publisher: "Geospatial Information Authority of Japan (国土地理院)",
        dataset: "GSI Seamless Photo (地理院タイル シームレス写真 z=18)",
        version: "2026-11",
        retrievedAt: "2026-11-24",
        license: "GSI Terms of Use (出典明記で自由利用可)",
        redistribution: "Attribution required: 出典 国土地理院（シームレス写真）",
        attributionText: "国土地理院（シームレス写真）",
        modifications: "Orthorectified aerial reference under all 23 illustrated map tiles.",
        url: "https://maps.gsi.go.jp/development/ichiran.html",
      },
      {
        id: "odpt-yokohama-bus",
        publisher: "Transportation Bureau, City of Yokohama / ODPT",
        dataset: "Yokohama Municipal Bus GTFS-JP & GTFS-RT VehiclePosition",
        version: "2026-11",
        retrievedAt: "2026-11-24",
        license: "ODPT Public Data License / CC BY 4.0",
        redistribution: "Synthetic schedule replay modeled along Bayside Blue route.",
        attributionText: "横浜市交通局 / ODPT",
        modifications: "Deterministic loop schedule mapped in local EPSG:6677 meters.",
        url: "https://www.odpt.org/",
      },
    ],
  };

  writeFileSync(join(RELEASE_DIR, "camera.json"), JSON.stringify(fullCamera, null, 2));
  writeFileSync(join(RELEASE_DIR, "release.json"), JSON.stringify(releaseJson, null, 2));
  writeFileSync(
    join(RELEASE_DIR, "features.json"),
    JSON.stringify(pilotScene.features ?? [], null, 2),
  );
  writeFileSync(
    join(RELEASE_DIR, "landmarks.json"),
    JSON.stringify(
      {
        landmarks: mergedLandmarks,
        pois: mergedPois,
        gcps: pilotScene.gcps,
        deckTestPoint: pilotScene.deckTestPoint,
      },
      null,
      2,
    ),
  );
  writeFileSync(join(RELEASE_DIR, "qa-report.json"), JSON.stringify(qaReport, null, 2));

  const fixtures = buildPilotFixtures(fullScene);
  const fixturesDir = join(RELEASE_DIR, "fixtures");
  mkdirSync(fixturesDir, { recursive: true });
  for (const [name, payload] of Object.entries(fixtures)) {
    writeFileSync(join(fixturesDir, name), JSON.stringify(payload, null, 2));
  }

  const pointer: ReleasePointer = {
    releaseId: RELEASE_ID,
    manifestPath: `./${RELEASE_ID}/release.json`,
    updatedAt: new Date().toISOString(),
  };
  writeFileSync(CURRENT_PTR_PATH, JSON.stringify(pointer, null, 2));

  console.log(
    `[full-builder] DONE ${RELEASE_ID}: maxGcpDisp=${qaReport.maxGcpDisplacementPx} px | seams=${qaReport.seamChecks.length} all passed | voidPixels=${qaReport.waterIntegrity.voidPixels} | ${(totalOutputBytes / (1024 * 1024)).toFixed(1)} MB (${(renderMs / 1000).toFixed(1)} s)`,
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
