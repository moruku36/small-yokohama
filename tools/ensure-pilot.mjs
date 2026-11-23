import { existsSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const rootDir = resolve(__dirname, "..");
const currentManifest = resolve(rootDir, "viewer", "public", "releases", "current.json");

if (!existsSync(currentManifest)) {
  console.log("[ensure-pilot] Pilot assets not found; building Shinko pilot...");
  const npmBin = process.platform === "win32" ? "npm.cmd" : "npm";
  const result = spawnSync(
    npmBin,
    ["--workspace", "@small-yokohama/pilot-builder", "run", "build:pilot"],
    {
      cwd: rootDir,
      stdio: "inherit",
      shell: process.platform === "win32",
    },
  );
  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}
