# Small Yokohama Offline Pipeline (`pipeline/`)

Python package preparing FY2024 Yokohama PLATEAU CityGML meshes, OpenStreetMap coastlines, headless Blender orthographic renders, DP overlap seam cutting, and libvips DZI image pyramids.

## Prerequisites

- Python >= 3.11 (`pip install -e ".[vips,dev]"`)
- [PLATEAU GIS Converter (`nusamai`)](https://github.com/MIERUNE/plateau-gis-converter/releases) (runs natively on Linux or inside WSL2 on Windows)
- [GDAL](https://gdal.org/) (`ogr2ogr` for OSM land polygon clipping)
- [Blender](https://www.blender.org/) (`blender --background --python ...`)
- [libvips](https://www.libvips.org/) (`vips dzsave`)

## Modules

- `crs.py`: Normalized EPSG:6677 (`easting, northing`) projection wrapper over `pyproj` (with identical Kawase GRS80 fallback).
- `camera.py`: Generates and loads `schemas/camera.schema.json` matching `packages/core/src/camera.ts`.
- `plateau.py`: Reads `scope/waterfront.geojson`, selects intersecting 3rd-order CityGML meshes, runs `nusamai` and `ogr2ogr`, and records SHA-256 source registers.
- `blender_render.py`: Configures Blender's orthographic 45° SW-looking camera across the 2×2 working tile grid (`2048 px`, `128 px` overlap).
- `seam_and_dzi.py`: Minimum-L1 DP seam cutting, `vips dzsave` pyramid export, and lossless non-interpolated data tile splitting.
- `qa.py`: Step 1 acceptance verification (`>= 6` GCPs `<= 8 px`, seam diffs, zero invented buildings in harbor water) and pilot cost log generator.
