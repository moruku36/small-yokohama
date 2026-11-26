import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import { describe, expect, it } from "vitest";
import {
  SURFACE_KIND,
  createFullYokohamaCamera,
  decodeDepthFromRgba,
  decodeFeatureIdFromRgba,
  wgs84ToImage,
  type Landmark,
  type PoiRecord,
  type ReleaseManifest,
  type SceneFeatureRecord,
} from "@small-yokohama/core";
import {
  resolveFeatureById,
  resolveLandmarkForFeatureId,
  type CompactBuildingsBundle,
} from "../data/releaseLoader.js";
import { formatBuildingType } from "../i18n.js";
import { describePick } from "../ui/HoverTip.js";

const JA_REGEX = /[\u3040-\u30ff\u3400-\u9fff]/;

function decodePng(buf: Buffer) {
  let pos = 8;
  let w = 0;
  let h = 0;
  let ct = 0;
  const idat: Buffer[] = [];
  while (pos < buf.length) {
    const len = buf.readUInt32BE(pos);
    const type = buf.subarray(pos + 4, pos + 8).toString("ascii");
    const data = buf.subarray(pos + 8, pos + 8 + len);
    if (type === "IHDR") {
      w = data.readUInt32BE(0);
      h = data.readUInt32BE(4);
      ct = data[9]!;
    } else if (type === "IDAT") {
      idat.push(data);
    } else if (type === "IEND") {
      break;
    }
    pos += 12 + len;
  }
  const raw = zlib.inflateSync(Buffer.concat(idat));
  const bpp = ct === 6 ? 4 : 3;
  const stride = w * bpp;
  const out = new Uint8Array(w * h * bpp);
  for (let y = 0; y < h; y++) {
    const f = raw[y * (stride + 1)]!;
    const so = y * (stride + 1) + 1;
    const doff = y * stride;
    for (let x = 0; x < stride; x++) {
      let v = raw[so + x]!;
      const a = x >= bpp ? out[doff + x - bpp]! : 0;
      const b = y > 0 ? out[doff - stride + x]! : 0;
      const c = x >= bpp && y > 0 ? out[doff - stride + x - bpp]! : 0;
      if (f === 1) v = (v + a) & 255;
      else if (f === 2) v = (v + b) & 255;
      else if (f === 3) v = (v + ((a + b) >> 1)) & 255;
      else if (f === 4) {
        const p = a + b - c;
        const pa = Math.abs(p - a);
        const pb = Math.abs(p - b);
        const pc = Math.abs(p - c);
        v = (v + (pa <= pb && pa <= pc ? a : pb <= pc ? b : c)) & 255;
      }
      out[doff + x] = v;
    }
  }
  return { w, h, bpp, data: out };
}

describe("City-wide 3D depth, water mask, and 32k+ building inspection", () => {
  const releaseDir = path.resolve(__dirname, "../../public/releases/full-yokohama-v1");
  const cam = createFullYokohamaCamera();
  const release = JSON.parse(
    fs.readFileSync(path.join(releaseDir, "release.json"), "utf8"),
  ) as ReleaseManifest;
  const buildings = JSON.parse(
    fs.readFileSync(path.join(releaseDir, "buildings.json"), "utf8"),
  ) as CompactBuildingsBundle;
  const features = JSON.parse(
    fs.readFileSync(path.join(releaseDir, "features.json"), "utf8"),
  ) as SceneFeatureRecord[];
  const landmarksPayload = JSON.parse(
    fs.readFileSync(path.join(releaseDir, "landmarks.json"), "utf8"),
  ) as { landmarks: Landmark[]; pois: PoiRecord[] };

  const featureById = new Map<number, SceneFeatureRecord>(
    features.map((f) => [f.featureId, f]),
  );

  const { cols, rows, tileSizePx, scale } = cam.dataTileGrid;
  const dScale = scale ?? 0.5;
  const depthTiles = new Map<string, ReturnType<typeof decodePng>>();
  const surfaceIdTiles = new Map<string, ReturnType<typeof decodePng>>();
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      depthTiles.set(
        `${c}_${r}`,
        decodePng(fs.readFileSync(path.join(releaseDir, "depth", `tile_${c}_${r}.png`))),
      );
      surfaceIdTiles.set(
        `${c}_${r}`,
        decodePng(fs.readFileSync(path.join(releaseDir, "surface-id", `tile_${c}_${r}.png`))),
      );
    }
  }

  const sampleAtImg = (px: number, py: number) => {
    const sx = Math.floor(px * dScale);
    const sy = Math.floor(py * dScale);
    const c = Math.floor(sx / tileSizePx);
    const r = Math.floor(sy / tileSizePx);
    const dt = depthTiles.get(`${c}_${r}`)!;
    const st = surfaceIdTiles.get(`${c}_${r}`)!;
    const lx = sx - c * tileSizePx;
    const ly = sy - r * tileSizePx;
    const dOff = (ly * dt.w + lx) * dt.bpp;
    const sOff = (ly * st.w + lx) * st.bpp;
    return {
      depthM: decodeDepthFromRgba(dt.data[dOff]!, dt.data[dOff + 1]!, cam.nearM, cam.farM),
      surfaceKind: dt.data[dOff + 2]!,
      featureId: decodeFeatureIdFromRgba(st.data[sOff]!, st.data[sOff + 1]!, st.data[sOff + 2]!),
    };
  };

  it("includes compact buildings.json with >= 25,000 buildings and zero JA leaks in EN", () => {
    expect(release.buildingsPath).toBe("buildings.json");
    expect(buildings.count).toBeGreaterThanOrEqual(25_000);
    expect(buildings.records.length).toBe(buildings.count);
    for (let i = 0; i < buildings.records.length; i++) {
      const nameEn = buildings.records[i]![8];
      if (nameEn) {
        expect(JA_REGEX.test(nameEn), `building[${i}] nameEn=${nameEn}`).toBe(false);
      }
    }
  });

  it("populates 3D buildings across >= 20/24 tiles and > 2M building pixels", () => {
    let tilesWithBuildings = 0;
    let totalBldgPixels = 0;
    for (const dt of depthTiles.values()) {
      let hasBldg = false;
      const count = dt.w * dt.h;
      for (let i = 0; i < count; i++) {
        if (dt.data[i * dt.bpp + 2] === SURFACE_KIND.BUILDING) {
          totalBldgPixels++;
          hasBldg = true;
        }
      }
      if (hasBldg) tilesWithBuildings++;
    }
    expect(tilesWithBuildings).toBeGreaterThanOrEqual(20);
    expect(totalBldgPixels).toBeGreaterThan(2_000_000);
  });

  it("supports non-Shinko building picking, 3D Landmark Tower occlusion, and city-wide water depth", () => {
    const bundleLike = {
      featureById,
      buildings,
      landmarks: landmarksPayload.landmarks,
      pois: landmarksPayload.pois,
    };

    const sogoPt = wgs84ToImage(cam, 139.6249, 35.4653, 25);
    const sogoSample = sampleAtImg(sogoPt.px, sogoPt.py);
    expect(sogoSample.surfaceKind).toBe(SURFACE_KIND.BUILDING);
    expect(sogoSample.featureId).toBeGreaterThanOrEqual(buildings.idOffset);
    expect(resolveFeatureById(bundleLike, sogoSample.featureId)?.heightM).toBeGreaterThan(5);

    const stadiumPt = wgs84ToImage(cam, 139.6401, 35.4435, 18);
    const stadiumSample = sampleAtImg(stadiumPt.px, stadiumPt.py);
    expect(stadiumSample.surfaceKind).toBe(SURFACE_KIND.BUILDING);
    expect(stadiumSample.featureId).toBeGreaterThanOrEqual(buildings.idOffset);

    const landmarkTopPt = wgs84ToImage(cam, 139.63148, 35.4546, 150);
    const landmarkTopSample = sampleAtImg(landmarkTopPt.px, landmarkTopPt.py);
    expect(landmarkTopSample.surfaceKind).toBe(SURFACE_KIND.BUILDING);
    expect(landmarkTopSample.featureId).toBeGreaterThanOrEqual(buildings.idOffset);
    const lmFeat = resolveFeatureById(bundleLike, landmarkTopSample.featureId);
    expect(lmFeat?.heightM).toBeGreaterThan(200);

    // Ground-level car immediately SW (behind) Landmark Tower is occluded by the tower
    const behindTowerPt = wgs84ToImage(cam, 139.6309, 35.4541, 3.5);
    const behindSample = sampleAtImg(behindTowerPt.px, behindTowerPt.py);
    expect(behindTowerPt.depthM > behindSample.depthM + 0.14).toBe(true);

    // Ground-level point on open road NE (in front) of Landmark Tower is NOT occluded
    const inFrontPt = wgs84ToImage(cam, 139.632964, 35.455201, 3.5);
    const inFrontSample = sampleAtImg(inFrontPt.px, inFrontPt.py);
    expect(inFrontPt.depthM <= inFrontSample.depthM + 0.14).toBe(true);

    // Non-Shinko harbor & canal water must be SURFACE_KIND.WATER at ~0 m elevation
    for (const [lon, lat] of [
      [139.653, 35.448],
      [139.6335, 35.453],
    ] as const) {
      const wPt = wgs84ToImage(cam, lon, lat, 0);
      const wSample = sampleAtImg(wPt.px, wPt.py);
      expect(wSample.surfaceKind).toBe(SURFACE_KIND.WATER);
    }
  });

  it("formats building types cleanly and prevents fid=2 false landmark matching", () => {
    expect(formatBuildingType("office", "ja")).toBe("オフィスビル");
    expect(formatBuildingType("office", "en")).toBe("Office Building");
    expect(JA_REGEX.test(formatBuildingType("place_of_worship", "en"))).toBe(false);
    expect(JA_REGEX.test(formatBuildingType("custom_shed", "en"))).toBe(false);

    const tipNamedJa = describePick(
      {
        kind: "feature",
        feature: {
          nameJa: "横浜ランドマークタワー",
          nameEn: "Yokohama Landmark Tower",
          surfaceKind: SURFACE_KIND.BUILDING,
          buildingType: "commercial",
          heightM: 295.8,
          levels: 70,
          yearBuilt: "1993",
        } as SceneFeatureRecord,
        lon: 139.6315,
        lat: 35.4546,
      },
      "ja",
    );
    expect(tipNamedJa.title).toBe("横浜ランドマークタワー");
    expect(tipNamedJa.sub).toBe("商業ビル · 296 m · 70階 · 1993");

    const tipNamedEn = describePick(
      {
        kind: "feature",
        feature: {
          nameJa: "横浜ランドマークタワー",
          nameEn: "Yokohama Landmark Tower",
          surfaceKind: SURFACE_KIND.BUILDING,
          buildingType: "commercial",
          heightM: 295.8,
          levels: 70,
          yearBuilt: "1993",
        } as SceneFeatureRecord,
        lon: 139.6315,
        lat: 35.4546,
      },
      "en",
    );
    expect(tipNamedEn.title).toBe("Yokohama Landmark Tower");
    expect(tipNamedEn.sub).toBe("Commercial Building · 296 m · 70F · 1993");
    expect(JA_REGEX.test(tipNamedEn.title + tipNamedEn.sub)).toBe(false);

    expect(
      resolveLandmarkForFeatureId(
        { landmarks: landmarksPayload.landmarks, buildings },
        2,
      ),
    ).toBeNull();
  });
});
