import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, "..", "..", "..");
const OUT_DIR = join(REPO_ROOT, "data", "gsi-aerial");
const TILES_DIR = join(OUT_DIR, "tiles");

export interface GsiAerialBbox {
  minLon: number;
  minLat: number;
  maxLon: number;
  maxLat: number;
}

const ZOOM = 18;
const DEFAULT_SHINKO_BBOX: GsiAerialBbox = {
  minLon: 139.6285,
  minLat: 35.4410,
  maxLon: 139.6515,
  maxLat: 35.4605,
};

function lonLatToTile(lon: number, lat: number, z: number): { tx: number; ty: number } {
  const n = 2 ** z;
  const tx = Math.floor(((lon + 180) / 360) * n);
  const latRad = (lat * Math.PI) / 180;
  const ty = Math.floor(
    ((1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2) * n,
  );
  return { tx, ty };
}

export async function fetchAndStitchGsiAerial(
  bbox: GsiAerialBbox,
  outBasename = "shinko-z18",
): Promise<{
  pngPath: string;
  metaPath: string;
  width: number;
  height: number;
  downloaded: number;
  cached: number;
}> {
  mkdirSync(TILES_DIR, { recursive: true });
  const outPng = join(OUT_DIR, `${outBasename}.png`);
  const outMeta = join(OUT_DIR, `${outBasename}.json`);

  const tl = lonLatToTile(bbox.minLon, bbox.maxLat, ZOOM);
  const br = lonLatToTile(bbox.maxLon, bbox.minLat, ZOOM);
  const jobs: Array<{ tx: number; ty: number }> = [];

  for (let ty = tl.ty; ty <= br.ty; ty++) {
    for (let tx = tl.tx; tx <= br.tx; tx++) {
      jobs.push({ tx, ty });
    }
  }

  console.log(
    `[fetchGsiAerial] Fetching ${jobs.length} tiles for ${outBasename} (z=${ZOOM}, x=${tl.tx}..${br.tx}, y=${tl.ty}..${br.ty})...`,
  );

  const concurrency = 8;
  let downloaded = 0;
  let cached = 0;
  for (let i = 0; i < jobs.length; i += concurrency) {
    const batch = jobs.slice(i, i + concurrency);
    await Promise.all(
      batch.map(async ({ tx, ty }) => {
        const dst = join(TILES_DIR, `${tx}_${ty}.jpg`);
        if (existsSync(dst)) {
          cached++;
          return;
        }
        const url = `https://cyberjapandata.gsi.go.jp/xyz/seamlessphoto/${ZOOM}/${tx}/${ty}.jpg`;
        const res = await fetch(url, {
          headers: { "User-Agent": "SmallYokohamaDev/0.1 (https://github.com/moruku36/small-yokohama)" },
        });
        if (!res.ok) {
          throw new Error(`Failed to fetch GSI tile ${url}: HTTP ${res.status}`);
        }
        writeFileSync(dst, Buffer.from(await res.arrayBuffer()));
        downloaded++;
      }),
    );
  }

  const cols = br.tx - tl.tx + 1;
  const rows = br.ty - tl.ty + 1;
  const width = cols * 256;
  const height = rows * 256;

  if (process.platform === "win32") {
    // Stitch cached JPG tiles cleanly into RGB PNG using Windows System.Drawing
    const psScript = `
Add-Type -AssemblyName System.Drawing
$bmp = New-Object System.Drawing.Bitmap(${width}, ${height}, [System.Drawing.Imaging.PixelFormat]::Format24bppRgb)
$g = [System.Drawing.Graphics]::FromImage($bmp)
for ($ty = ${tl.ty}; $ty -le ${br.ty}; $ty++) {
  for ($tx = ${tl.tx}; $tx -le ${br.tx}; $tx++) {
    $f = "${TILES_DIR.replaceAll("\\", "/")}/$($tx)_$($ty).jpg"
    if (Test-Path $f) {
      $tile = New-Object System.Drawing.Bitmap($f)
      $g.DrawImage($tile, ($tx - ${tl.tx}) * 256, ($ty - ${tl.ty}) * 256, 256, 256)
      $tile.Dispose()
    }
  }
}
$g.Dispose()
$bmp.Save("${outPng.replaceAll("\\", "/")}", [System.Drawing.Imaging.ImageFormat]::Png)
$bmp.Dispose()
`;
    execFileSync("powershell.exe", ["-NoProfile", "-Command", psScript], { stdio: "inherit" });
  } else {
    // Cross-platform stitching via Python + Pillow on macOS / Linux
    const pyScript = `
import os
from PIL import Image
canvas = Image.new("RGB", (${width}, ${height}))
for ty in range(${tl.ty}, ${br.ty} + 1):
    for tx in range(${tl.tx}, ${br.tx} + 1):
        p = os.path.join(${JSON.stringify(TILES_DIR)}, f"{tx}_{ty}.jpg")
        if os.path.exists(p):
            with Image.open(p) as im:
                canvas.paste(im.convert("RGB"), ((tx - ${tl.tx}) * 256, (ty - ${tl.ty}) * 256))
canvas.save(${JSON.stringify(outPng)}, format="PNG")
`;
    execFileSync("python3", ["-c", pyScript], { stdio: "inherit" });
  }

  const meta = {
    zoom: ZOOM,
    minTx: tl.tx,
    maxTx: br.tx,
    minTy: tl.ty,
    maxTy: br.ty,
    tileSize: 256,
    width,
    height,
    retrievedAt: new Date().toISOString(),
    source: "https://cyberjapandata.gsi.go.jp/xyz/seamlessphoto/{z}/{x}/{y}.jpg",
    attribution: "国土地理院 (GSI Japan) 地理院タイル（シームレス写真）",
  };
  writeFileSync(outMeta, JSON.stringify(meta, null, 2), "utf8");
  console.log(
    `[fetchGsiAerial] Saved ${outPng} (${width}x${height}) | downloaded=${downloaded}, cached=${cached}`,
  );
  return { pngPath: outPng, metaPath: outMeta, width, height, downloaded, cached };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  fetchAndStitchGsiAerial(DEFAULT_SHINKO_BBOX, "shinko-z18").catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
