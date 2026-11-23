# Development Guide · 開発手順

This repository implements the architecture specified in [docs/design.md](docs/design.md) and [docs/technology.md](docs/technology.md).

## Workspace Layout

- `schemas/` — Shared JSON Schemas (`camera`, `release`, `vehicle-snapshot`, `qa-report`) enforced across TypeScript and Python.
- `packages/core/` (`@small-yokohama/core`) — EPSG:6677 projection (`easting, northing`), orthographic 45° camera transforms, 16-bit depth/ID codecs, freshness policy, Yokohama solar lighting, and the documented Shinko pilot scene.
- `tools/pilot-builder/` (`@small-yokohama/pilot-builder`) — Zero-dependency builder generating the 2×2 Shinko pilot working tiles (`2048 px`, `128 px` overlap), DP seam cuts, `plain` & `illustrated` DZI pyramids, lossless `2×2` depth/feature-id/road-elevation PNG tiles, Step 1 QA report, and Step 2/3 fixtures.
- `viewer/` (`@small-yokohama/viewer`) — TypeScript + Vite + OpenSeadragon + WebGL2 viewer with per-fragment depth occlusion (`TEXTURE_2D_ARRAY`), bilingual UI, landmark drawer, shareable URLs, and feed resilience states.
- `pipeline/` — Python package (`small_yokohama_pipeline`) for FY2024 PLATEAU CityGML (`nusamai`), OSM coastline clipping (`ogr2ogr`), headless Blender rendering (`bpy`), DP seam cutting, and `vips dzsave`.
- `collector/` — Python package (`small_yokohama_collector`) for GTFS-JP static matching (`Asia/Tokyo`, after-midnight, calendar exceptions) and ODPT GTFS-RT `VehiclePosition` collection.

## TypeScript & Viewer Commands (Node.js)

```sh
npm install
npm run build:pilot   # Generate Shinko pilot DZI, depth tiles, QA report, and fixtures
npm run typecheck     # Typecheck core, pilot-builder, and viewer
npm test              # Run Vitest unit & real depth-tile Step 1/2 acceptance tests
npm run dev           # Launch Vite dev server on http://localhost:5173
npm run build         # Production static build in viewer/dist/
```

*(On Windows PowerShell with script execution restricted, invoke `npm.cmd` and `npx.cmd`.)*

## Python Pipeline & Collector (Python >= 3.11)

```sh
pip install -e "./pipeline[vips,dev]"
pip install -e "./collector[dev]"
pytest pipeline/tests collector/tests
```
