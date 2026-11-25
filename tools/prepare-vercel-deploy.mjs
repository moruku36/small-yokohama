import { spawnSync } from "node:child_process";
import {
  cpSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT_DIR = resolve(__dirname, "..");
const RELEASE_ID = "full-yokohama-v1";
const SRC_RELEASE_DIR = join(ROOT_DIR, "viewer", "public", "releases", RELEASE_ID);
const VIEWER_DIST_DIR = join(ROOT_DIR, "viewer", "dist");
const DEPLOY_DIR = join(ROOT_DIR, "deploy-vercel");
const DST_RELEASES_DIR = join(DEPLOY_DIR, "releases");
const DST_RELEASE_DIR = join(DST_RELEASES_DIR, RELEASE_ID);

function countFilesAndBytes(dir) {
  let files = 0;
  let bytes = 0;
  const exts = new Map();
  const walk = (cur) => {
    for (const entry of readdirSync(cur, { withFileTypes: true })) {
      const full = join(cur, entry.name);
      if (entry.isDirectory()) {
        walk(full);
      } else if (entry.isFile()) {
        files++;
        bytes += statSync(full).size;
        const dot = entry.name.lastIndexOf(".");
        const ext = dot >= 0 ? entry.name.slice(dot).toLowerCase() : "";
        exts.set(ext, (exts.get(ext) ?? 0) + 1);
      }
    }
  };
  walk(dir);
  return { files, bytes, exts };
}

function convertDziPngDirToJpeg(jobs) {
  const jobsJson = JSON.stringify(jobs);
  const psScript = `
$ErrorActionPreference = "Stop"
Add-Type -AssemblyName System.Drawing
$jpegCodec = [System.Drawing.Imaging.ImageCodecInfo]::GetImageEncoders() | Where-Object { $_.MimeType -eq "image/jpeg" } | Select-Object -First 1
if (-not $jpegCodec) { throw "JPEG codec unavailable" }

$jobs = @'
${jobsJson}
'@ | ConvertFrom-Json

foreach ($job in $jobs) {
  $srcRoot = [string]$job.srcDir
  $dstRoot = [string]$job.dstDir
  $quality = [long]$job.quality

  $ep = New-Object System.Drawing.Imaging.EncoderParameters(1)
  $ep.Param[0] = New-Object System.Drawing.Imaging.EncoderParameter([System.Drawing.Imaging.Encoder]::Quality, $quality)

  $pngs = Get-ChildItem -LiteralPath $srcRoot -Recurse -File -Filter "*.png"
  foreach ($png in $pngs) {
    $rel = $png.FullName.Substring($srcRoot.Length).TrimStart('\\', '/')
    $dstRel = [System.IO.Path]::ChangeExtension($rel, ".jpg")
    $dstPath = Join-Path $dstRoot $dstRel
    $dstParent = Split-Path -Parent $dstPath
    if (-not (Test-Path -LiteralPath $dstParent)) {
      [System.IO.Directory]::CreateDirectory($dstParent) | Out-Null
    }
    $bmp = $null
    try {
      $bmp = New-Object System.Drawing.Bitmap($png.FullName)
      $bmp.Save($dstPath, $jpegCodec, $ep)
    } finally {
      if ($bmp -ne $null) { $bmp.Dispose() }
    }
  }
  $ep.Dispose()
}
`;

  const encoded = Buffer.from(psScript, "utf16le").toString("base64");
  const res = spawnSync(
    "powershell.exe",
    ["-NoProfile", "-NonInteractive", "-EncodedCommand", encoded],
    { cwd: ROOT_DIR, stdio: "inherit" },
  );
  if (res.status !== 0) {
    throw new Error(`PowerShell JPEG conversion failed with exit code ${res.status}`);
  }
}

function main() {
  const releaseManifestPath = join(SRC_RELEASE_DIR, "release.json");
  if (!existsSync(releaseManifestPath)) {
    throw new Error(
      `Missing ${releaseManifestPath}. Run "npm run build:full" before preparing the Vercel deploy bundle.`,
    );
  }

  console.log("[prepare-vercel] Building @small-yokohama/viewer...");
  const npmBin = process.platform === "win32" ? "npm.cmd" : "npm";
  const buildRes = spawnSync(npmBin, ["--workspace", "@small-yokohama/viewer", "run", "build"], {
    cwd: ROOT_DIR,
    stdio: "inherit",
    shell: process.platform === "win32",
  });
  if (buildRes.status !== 0) {
    throw new Error(`Viewer build failed with exit code ${buildRes.status}`);
  }

  console.log("[prepare-vercel] Recreating deploy-vercel/...");
  rmSync(DEPLOY_DIR, { recursive: true, force: true });
  mkdirSync(DST_RELEASE_DIR, { recursive: true });

  // Copy only built SPA entry, icons, manifest, and bundled JS/CSS assets (never copy viewer/dist/releases/)
  cpSync(join(VIEWER_DIST_DIR, "index.html"), join(DEPLOY_DIR, "index.html"));
  cpSync(join(VIEWER_DIST_DIR, "assets"), join(DEPLOY_DIR, "assets"), { recursive: true });
  for (const staticFile of [
    "favicon.ico",
    "favicon.svg",
    "favicon-32x32.png",
    "apple-touch-icon.png",
    "icon-192.png",
    "icon-512.png",
    "site.webmanifest",
  ]) {
    const src = join(VIEWER_DIST_DIR, staticFile);
    if (!existsSync(src)) {
      throw new Error(`Missing built static asset ${src}`);
    }
    cpSync(src, join(DEPLOY_DIR, staticFile));
  }

  // Write releases/current.json pointing to full-yokohama-v1
  const pointer = {
    releaseId: RELEASE_ID,
    manifestPath: `./${RELEASE_ID}/release.json`,
    updatedAt: new Date().toISOString(),
  };
  writeFileSync(join(DST_RELEASES_DIR, "current.json"), JSON.stringify(pointer, null, 2));

  // Copy manifests, fixtures, and strictly lossless PNG data layers verbatim
  for (const name of ["release.json", "features.json", "landmarks.json", "qa-report.json"]) {
    cpSync(join(SRC_RELEASE_DIR, name), join(DST_RELEASE_DIR, name));
  }
  for (const dirName of ["fixtures", "depth", "surface-id", "road-elevation"]) {
    cpSync(join(SRC_RELEASE_DIR, dirName), join(DST_RELEASE_DIR, dirName), { recursive: true });
  }

  // Update camera.json (dzi.format -> "jpeg") and DZI XML manifests (Format="jpg")
  const camera = JSON.parse(readFileSync(join(SRC_RELEASE_DIR, "camera.json"), "utf8"));
  camera.dzi.format = "jpeg";
  writeFileSync(join(DST_RELEASE_DIR, "camera.json"), JSON.stringify(camera, null, 2));

  for (const dziName of ["illustrated.dzi", "plain.dzi"]) {
    const xml = readFileSync(join(SRC_RELEASE_DIR, dziName), "utf8");
    const updated = xml.replace(/Format="png"/g, 'Format="jpg"');
    if (!updated.includes('Format="jpg"')) {
      throw new Error(`Failed to rewrite Format="jpg" in ${dziName}`);
    }
    writeFileSync(join(DST_RELEASE_DIR, dziName), updated, "utf8");
  }

  console.log("[prepare-vercel] Converting DZI pyramids PNG -> JPEG (quality 92/82)...");
  convertDziPngDirToJpeg([
    {
      srcDir: join(SRC_RELEASE_DIR, "illustrated_files"),
      dstDir: join(DST_RELEASE_DIR, "illustrated_files"),
      quality: 92,
    },
    {
      srcDir: join(SRC_RELEASE_DIR, "plain_files"),
      dstDir: join(DST_RELEASE_DIR, "plain_files"),
      quality: 82,
    },
  ]);

  const vercelJson = {
    $schema: "https://openapi.vercel.sh/vercel.json",
    framework: null,
    buildCommand: null,
    installCommand: null,
    outputDirectory: ".",
    cleanUrls: true,
    headers: [
      {
        source: "/assets/(.*)",
        headers: [{ key: "Cache-Control", value: "public, max-age=31536000, immutable" }],
      },
      {
        source:
          "/releases/full-yokohama-v1/(illustrated_files|plain_files|depth|surface-id|road-elevation)/(.*)",
        headers: [{ key: "Cache-Control", value: "public, max-age=31536000, immutable" }],
      },
      {
        source: "/releases/current.json",
        headers: [{ key: "Cache-Control", value: "no-cache" }],
      },
    ],
  };
  writeFileSync(join(DEPLOY_DIR, "vercel.json"), JSON.stringify(vercelJson, null, 2));

  // Verify expected file counts and total size (< 95 MB)
  const illusStats = countFilesAndBytes(join(DST_RELEASE_DIR, "illustrated_files"));
  const plainStats = countFilesAndBytes(join(DST_RELEASE_DIR, "plain_files"));
  const depthStats = countFilesAndBytes(join(DST_RELEASE_DIR, "depth"));
  const idStats = countFilesAndBytes(join(DST_RELEASE_DIR, "surface-id"));
  const roadStats = countFilesAndBytes(join(DST_RELEASE_DIR, "road-elevation"));
  const totalStats = countFilesAndBytes(DEPLOY_DIR);

  if (illusStats.files !== 512 || illusStats.exts.get(".jpg") !== 512) {
    throw new Error(`Expected 512 .jpg files in illustrated_files, got ${illusStats.files}`);
  }
  if (plainStats.files !== 512 || plainStats.exts.get(".jpg") !== 512) {
    throw new Error(`Expected 512 .jpg files in plain_files, got ${plainStats.files}`);
  }
  for (const [label, st] of [
    ["depth", depthStats],
    ["surface-id", idStats],
    ["road-elevation", roadStats],
  ]) {
    if (st.files !== 24 || st.exts.get(".png") !== 24) {
      throw new Error(`Expected 24 .png files in ${label}, got ${st.files}`);
    }
  }

  const totalMb = totalStats.bytes / (1024 * 1024);
  if (totalMb >= 95) {
    throw new Error(`deploy-vercel size ${totalMb.toFixed(2)} MB exceeds 95 MB budget!`);
  }

  console.log(
    `[prepare-vercel] READY deploy-vercel/: ${totalStats.files} files, ${totalMb.toFixed(2)} MB total` +
      ` (illustrated=${(illusStats.bytes / (1024 * 1024)).toFixed(2)} MB, plain=${(plainStats.bytes / (1024 * 1024)).toFixed(2)} MB)`,
  );
}

main();
