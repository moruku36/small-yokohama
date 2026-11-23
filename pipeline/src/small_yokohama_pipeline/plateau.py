"""PLATEAU FY2024 CityGML (`nusamai`) and OSM coastline (`ogr2ogr`) preparation."""

from __future__ import annotations

from dataclasses import asdict, dataclass
import hashlib
import json
from pathlib import Path
import shutil
import subprocess
from typing import Sequence


@dataclass(frozen=True, slots=True)
class SourceAssetRecord:
    dataset: str
    version: str
    file_path: str
    sha256: str
    retrieved_at: str
    license: str
    notes: str = ""


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as fh:
        for chunk in iter(lambda: fh.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def load_study_bounds(geojson_path: Path, feature_id: str = "pilot") -> tuple[float, float, float, float]:
    """Read bounding box `(min_lon, min_lat, max_lon, max_lat)` from `scope/waterfront.geojson`."""
    fc = json.loads(geojson_path.read_text(encoding="utf-8"))
    for feat in fc.get("features", []):
        if feat.get("id") == feature_id:
            ring = feat["geometry"]["coordinates"][0]
            lons = [pt[0] for pt in ring]
            lats = [pt[1] for pt in ring]
            return (min(lons), min(lats), max(lons), max(lats))
    raise KeyError(f"Feature '{feature_id}' not found in {geojson_path}")


def expand_bbox(
    bbox: tuple[float, float, float, float],
    margin_deg_lon: float = 0.002,
    margin_deg_lat: float = 0.002,
) -> tuple[float, float, float, float]:
    """Expand study bbox to preserve tall building overhangs and tile overlap margins."""
    return (
        bbox[0] - margin_deg_lon,
        bbox[1] - margin_deg_lat,
        bbox[2] + margin_deg_lon,
        bbox[3] + margin_deg_lat,
    )


def jis_standard_mesh3_code(lon: float, lat: float) -> str:
    """Compute Japanese Standard 3rd-order mesh code (~1 km) for PLATEAU CityGML file selection."""
    lat1 = int(math_floor(lat * 1.5))
    lon1 = int(math_floor(lon - 100.0))
    rem_lat1 = lat * 1.5 - lat1
    rem_lon1 = (lon - 100.0) - lon1

    lat2 = int(math_floor(rem_lat1 * 8.0))
    lon2 = int(math_floor(rem_lon1 * 8.0))
    rem_lat2 = rem_lat1 * 8.0 - lat2
    rem_lon2 = rem_lon1 * 8.0 - lon2

    lat3 = int(math_floor(rem_lat2 * 10.0))
    lon3 = int(math_floor(rem_lon2 * 10.0))
    return f"{lat1:02d}{lon1:02d}{lat2}{lon2}{lat3}{lon3}"


def math_floor(val: float) -> int:
    return int(val // 1)


def select_intersecting_mesh_codes(
    bbox: tuple[float, float, float, float],
    step_lon: float = 0.005,
    step_lat: float = 0.004,
) -> list[str]:
    min_lon, min_lat, max_lon, max_lat = bbox
    codes: set[str] = set()
    lat = min_lat
    while lat <= max_lat + 1e-9:
        lon = min_lon
        while lon <= max_lon + 1e-9:
            codes.add(jis_standard_mesh3_code(lon, lat))
            lon += step_lon
        lat += step_lat
    return sorted(codes)


def convert_plateau_citygml_to_gltf(
    citygml_files: Sequence[Path],
    output_dir: Path,
    nusamai_bin: str = "nusamai",
    epsg: int = 6677,
    dry_run: bool = False,
) -> list[str]:
    """Run PLATEAU GIS Converter (`nusamai`) to export selected udx/{bldg,tran,dem,brid} to glTF."""
    if not dry_run and shutil.which(nusamai_bin) is None:
        raise FileNotFoundError(
            f"'{nusamai_bin}' executable not found. Install PLATEAU GIS Converter CLI (MIERUNE/plateau-gis-converter) or use WSL2."
        )
    output_dir.mkdir(parents=True, exist_ok=True)
    cmd = [
        nusamai_bin,
        *[str(p) for p in citygml_files],
        "--sink",
        "gltf",
        "--output",
        str(output_dir),
        "--epsg",
        str(epsg),
        "--schema",
        "true",
    ]
    if not dry_run:
        subprocess.run(cmd, check=True)
    return cmd


def clip_osm_land_polygons(
    osm_shp: Path,
    study_bbox: tuple[float, float, float, float],
    output_geojson: Path,
    ogr2ogr_bin: str = "ogr2ogr",
    dry_run: bool = False,
) -> list[str]:
    """Clip and dissolve OSM split land polygons to EPSG:6677 via GDAL `ogr2ogr`."""
    if not dry_run and shutil.which(ogr2ogr_bin) is None:
        raise FileNotFoundError(f"'{ogr2ogr_bin}' not found. Install GDAL CLI.")
    output_geojson.parent.mkdir(parents=True, exist_ok=True)
    min_lon, min_lat, max_lon, max_lat = study_bbox
    cmd = [
        ogr2ogr_bin,
        "-f",
        "GeoJSON",
        "-t_srs",
        "EPSG:6677",
        "-spat",
        str(min_lon),
        str(min_lat),
        str(max_lon),
        str(max_lat),
        "-dialect",
        "SQLite",
        "-sql",
        "SELECT ST_Union(geometry) AS geometry FROM land_polygons",
        str(output_geojson),
        str(osm_shp),
    ]
    if not dry_run:
        subprocess.run(cmd, check=True)
    return cmd


def write_source_register(records: Sequence[SourceAssetRecord], out_path: Path) -> None:
    out_path.parent.mkdir(parents=True, exist_ok=True)
    payload = [asdict(r) for r in records]
    out_path.write_text(json.dumps(payload, indent=2), encoding="utf-8")
